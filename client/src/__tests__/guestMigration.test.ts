import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { useGuestStore, newGuestId } from '@/stores/guestStore';
import { migrateGuestData } from '@/lib/guestMigration';
import type { User } from '@/types';
import type { RecipeInput } from '@/hooks/useRecipes';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

const mockedPost = api.post as unknown as ReturnType<typeof vi.fn>;
const mockedPatch = api.patch as unknown as ReturnType<typeof vi.fn>;

const soupInput: RecipeInput = {
  title: 'Guest Soup',
  description: 'A guest soup',
  cuisine: 'italian',
  tags: ['quick'],
  difficulty: 'easy',
  prepTime: 5,
  cookTime: 20,
  servings: 2,
  imageUrl: 'https://example.com/soup.jpg',
  ingredients: [{ name: 'Tomato', quantity: 3, unit: 'pcs' }],
  instructions: ['Blend.', 'Simmer.'],
  nutrition: { calories: 120 },
};

function seedGuestData() {
  const s = useGuestStore.getState();
  s.addPantryItem({ ingredient: 'tomato', quantity: '3', unit: 'pcs', category: 'produce' });
  s.addPantryItem({ ingredient: 'Onion', quantity: '1', unit: 'pcs', category: 'produce' });
  const recipe = s.addRecipe(soupInput);
  const plan = s.createMealPlan('2026-11-23');
  s.assignSlot(plan.id, 'Monday', 'lunch', recipe);
  const now = new Date().toISOString();
  s.addGroceryList({
    id: newGuestId(),
    user: 'guest',
    mealPlan: plan.id,
    items: [{ _id: 'i1', ingredient: 'milk', quantity: 1, unit: 'l', category: 'dairy', checked: false }],
    createdAt: now,
    updatedAt: now,
  });
  return { recipe, plan };
}

const testUser: User = {
  id: 'u1',
  name: 'Migrate Test',
  email: 'migrate@example.com',
  role: 'user',
  pantry: [{ ingredient: 'Tomato', quantity: '2', unit: 'pcs', category: 'produce' }],
  dietaryPreferences: [],
  allergies: [],
};

describe('migrateGuestData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useGuestStore.getState().clearAll();
    useAuthStore.setState({ user: testUser });
  });

  it('migrates pantry, recipes, plans and lists, then clears the guest store', async () => {
    const { plan } = seedGuestData();
    mockedPost.mockImplementation(async (url: string) => {
      if (url === '/recipes') {
        return { data: { recipe: { id: 'server-recipe-1' } } };
      }
      if (url === '/mealplans') {
        return { data: { plan: { id: 'server-plan-1' } } };
      }
      if (url === '/grocery/generate') {
        return { data: { list: { id: 'server-list-1' } } };
      }
      throw new Error(`unexpected POST ${url}`);
    });
    mockedPatch.mockResolvedValue({
      data: { user: { ...testUser, pantry: [...testUser.pantry, { ingredient: 'Onion' }] } },
    });

    const qc = new QueryClient();
    const result = await migrateGuestData(qc);

    // Recipe posted with its image (the server gatekeeper requires it).
    expect(mockedPost).toHaveBeenCalledWith('/recipes', expect.objectContaining({
      title: 'Guest Soup',
      imageUrl: 'https://example.com/soup.jpg',
    }));
    // Plan posted with the guest recipe id remapped to the server id.
    expect(mockedPost).toHaveBeenCalledWith(
      '/mealplans',
      expect.objectContaining({ weekStartDate: '2026-11-23' })
    );
    const planCall = mockedPost.mock.calls.find((c) => c[0] === '/mealplans');
    const monday = (planCall?.[1] as { days: Array<{ day: string; lunch: unknown }> }).days.find(
      (d) => d.day === 'Monday'
    );
    expect(monday?.lunch).toBe('server-recipe-1');
    // Pantry merged without duplicating 'tomato' (already present as 'Tomato').
    expect(mockedPatch).toHaveBeenCalledWith(
      '/auth/me',
      expect.objectContaining({
        pantry: expect.arrayContaining([
          expect.objectContaining({ ingredient: 'Tomato' }),
          expect.objectContaining({ ingredient: 'Onion' }),
        ]),
      })
    );
    const patchedPantry = (mockedPatch.mock.calls[0]?.[1] as { pantry: unknown[] }).pantry;
    expect(patchedPantry).toHaveLength(2);
    // Grocery list regenerated from the migrated plan.
    expect(mockedPost).toHaveBeenCalledWith('/grocery/generate', {
      mealPlanId: 'server-plan-1',
      usePantry: true,
    });
    expect(result).toEqual({
      pantryMerged: 1,
      recipesMigrated: 1,
      recipesFailed: 0,
      plansMigrated: 1,
      plansFailed: 0,
      listsRegenerated: 1,
      listsFailed: 0,
    });
    // Store cleared, and the auth user carries the merged pantry.
    expect(useGuestStore.getState().pantry).toEqual([]);
    expect(useGuestStore.getState().recipes).toEqual([]);
    expect(useGuestStore.getState().mealPlans).toEqual([]);
    expect(useGuestStore.getState().groceryLists).toEqual([]);
    expect(useAuthStore.getState().user?.pantry).toHaveLength(2);
    void plan;
  });

  it('does nothing when there is no guest data', async () => {
    const result = await migrateGuestData();
    expect(mockedPost).not.toHaveBeenCalled();
    expect(mockedPatch).not.toHaveBeenCalled();
    expect(result.recipesMigrated).toBe(0);
    expect(result.plansMigrated).toBe(0);
  });

  it('continues past a failed recipe and still clears the store', async () => {
    const s = useGuestStore.getState();
    s.addRecipe(soupInput);
    s.addRecipe({ ...soupInput, title: 'Second Soup' });
    mockedPost.mockImplementation(async (url: string, body: unknown) => {
      if (url === '/recipes') {
        const title = (body as { title: string }).title;
        if (title === 'Guest Soup') throw new Error('gatekeeper rejected');
        return { data: { recipe: { id: 'server-recipe-2' } } };
      }
      throw new Error(`unexpected POST ${url}`);
    });

    const result = await migrateGuestData();
    expect(result.recipesMigrated).toBe(1);
    expect(result.recipesFailed).toBe(1);
    // Even with a failure, the store is cleared so the next sign-in can't
    // re-post the same items.
    expect(useGuestStore.getState().recipes).toEqual([]);
  });

  it('does nothing when no user is signed in', async () => {
    useAuthStore.setState({ user: null });
    seedGuestData();
    const result = await migrateGuestData();
    expect(mockedPost).not.toHaveBeenCalled();
    expect(result.recipesMigrated).toBe(0);
    expect(useGuestStore.getState().recipes).toHaveLength(1);
  });
});
