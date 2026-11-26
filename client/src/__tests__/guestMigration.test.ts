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

const mockedGet = api.get as unknown as ReturnType<typeof vi.fn>;
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
    // The session check at the start of a migration succeeds.
    mockedGet.mockResolvedValue({ data: { user: testUser } });
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

  it('does not post a plan with a null slot when its recipe upload fails, and keeps the plan and its recipes for retry', async () => {
    const s = useGuestStore.getState();
    const failing = s.addRecipe(soupInput);
    const ok = s.addRecipe({ ...soupInput, title: 'Second Soup' });
    const keptPlan = s.createMealPlan('2026-11-23');
    s.assignSlot(keptPlan.id, 'Monday', 'lunch', failing);
    s.assignSlot(keptPlan.id, 'Monday', 'dinner', ok);
    // A second plan that only references the recipe that migrated.
    const goodPlan = s.createMealPlan('2026-11-30');
    s.assignSlot(goodPlan.id, 'Monday', 'dinner', ok);
    mockedPost.mockImplementation(async (url: string, body: unknown) => {
      if (url === '/recipes') {
        if ((body as { title: string }).title === 'Guest Soup') {
          throw new Error('gatekeeper rejected');
        }
        return { data: { recipe: { id: 'server-recipe-2' } } };
      }
      if (url === '/mealplans') {
        return { data: { plan: { id: 'server-plan-9' } } };
      }
      throw new Error(`unexpected POST ${url}`);
    });

    const result = await migrateGuestData();

    // Only the plan whose recipes all migrated is posted — never a plan
    // with a null slot for the failed upload.
    const planCalls = mockedPost.mock.calls.filter((c) => c[0] === '/mealplans');
    expect(planCalls).toHaveLength(1);
    const posted = planCalls[0]?.[1] as {
      weekStartDate: string;
      days: Array<{ day: string; lunch: unknown; dinner: unknown }>;
    };
    expect(posted.weekStartDate).toBe('2026-11-30');
    expect(posted.days.find((d) => d.day === 'Monday')?.dinner).toBe('server-recipe-2');
    expect(result).toEqual(
      expect.objectContaining({
        recipesMigrated: 1,
        recipesFailed: 1,
        plansMigrated: 1,
        plansFailed: 1,
      })
    );
    // The kept plan stays, and so do BOTH of its recipes — including the
    // one that migrated, because deleting it would leave the kept plan
    // referencing a guest recipe id that no longer exists.
    expect(useGuestStore.getState().mealPlans.map((p) => p.id)).toEqual([keptPlan.id]);
    expect(useGuestStore.getState().recipes.map((r) => r.title).sort()).toEqual([
      'Guest Soup',
      'Second Soup',
    ]);
    void goodPlan;
  });

  it('reuses a kept recipe\'s server id on retry instead of uploading it again', async () => {
    const s = useGuestStore.getState();
    const failing = s.addRecipe(soupInput);
    const ok = s.addRecipe({ ...soupInput, title: 'Second Soup' });
    const keptPlan = s.createMealPlan('2026-11-23');
    s.assignSlot(keptPlan.id, 'Monday', 'lunch', failing);
    s.assignSlot(keptPlan.id, 'Monday', 'dinner', ok);
    // First run: the failing recipe blocks the plan, but the other recipe
    // migrates — and the plan keeps both recipes for retry.
    mockedPost.mockImplementation(async (url: string, body: unknown) => {
      if (url === '/recipes') {
        if ((body as { title: string }).title === 'Guest Soup') {
          throw new Error('gatekeeper rejected');
        }
        return { data: { recipe: { id: 'server-recipe-2' } } };
      }
      if (url === '/mealplans') {
        return { data: { plan: { id: 'server-plan-9' } } };
      }
      throw new Error(`unexpected POST ${url}`);
    });

    const first = await migrateGuestData();
    expect(first.recipesMigrated).toBe(1);
    expect(first.recipesFailed).toBe(1);
    expect(first.plansMigrated).toBe(0);
    // The migrated recipe's server id is persisted, not just held in
    // memory, while the recipe itself stays for the retry.
    expect(useGuestStore.getState().recipes.map((r) => r.title).sort()).toEqual([
      'Guest Soup',
      'Second Soup',
    ]);
    expect(useGuestStore.getState().migratedRecipeIds[ok.id]).toBe('server-recipe-2');
    const stored = JSON.parse(localStorage.getItem('mealmate.guest') ?? '{}') as {
      state?: { migratedRecipeIds?: Record<string, string> };
    };
    expect(stored.state?.migratedRecipeIds?.[ok.id]).toBe('server-recipe-2');

    // Retry: the failing recipe now succeeds, and the already-migrated
    // recipe must NOT be uploaded a second time.
    mockedPost.mockClear();
    mockedPost.mockImplementation(async (url: string) => {
      if (url === '/recipes') {
        return { data: { recipe: { id: 'server-recipe-1' } } };
      }
      if (url === '/mealplans') {
        return { data: { plan: { id: 'server-plan-10' } } };
      }
      throw new Error(`unexpected POST ${url}`);
    });

    const second = await migrateGuestData();
    const recipeCalls = mockedPost.mock.calls.filter((c) => c[0] === '/recipes');
    expect(recipeCalls).toHaveLength(1);
    expect((recipeCalls[0]?.[1] as { title: string }).title).toBe('Guest Soup');
    expect(second).toEqual(
      expect.objectContaining({ recipesMigrated: 2, recipesFailed: 0, plansMigrated: 1 })
    );
    // The kept plan posts with the ORIGINAL server id for the reused
    // recipe — no second server copy exists to point at.
    const planCalls = mockedPost.mock.calls.filter((c) => c[0] === '/mealplans');
    expect(planCalls).toHaveLength(1);
    const posted = planCalls[0]?.[1] as {
      weekStartDate: string;
      days: Array<{ day: string; lunch: unknown; dinner: unknown }>;
    };
    expect(posted.weekStartDate).toBe('2026-11-23');
    expect(posted.days.find((d) => d.day === 'Monday')?.lunch).toBe('server-recipe-1');
    expect(posted.days.find((d) => d.day === 'Monday')?.dinner).toBe('server-recipe-2');
    // Both recipes are gone now, and their mappings go with them.
    expect(useGuestStore.getState().recipes).toEqual([]);
    expect(useGuestStore.getState().mealPlans).toEqual([]);
    expect(useGuestStore.getState().migratedRecipeIds[ok.id]).toBeUndefined();
    expect(useGuestStore.getState().migratedRecipeIds[failing.id]).toBeUndefined();
  });

  it('recovers a leftover grocery list on the next run via the durably stored server plan id', async () => {
    const { plan } = seedGuestData();
    mockedPost.mockImplementation(async (url: string) => {
      if (url === '/recipes') {
        return { data: { recipe: { id: 'server-recipe-1' } } };
      }
      if (url === '/mealplans') {
        return { data: { plan: { id: 'server-plan-1' } } };
      }
      if (url === '/grocery/generate') {
        throw new Error('grocery service down');
      }
      throw new Error(`unexpected POST ${url}`);
    });
    mockedPatch.mockResolvedValue({
      data: { user: { ...testUser, pantry: [...testUser.pantry, { ingredient: 'Onion' }] } },
    });

    const first = await migrateGuestData();
    expect(first.listsFailed).toBe(1);
    expect(first.listsRegenerated).toBe(0);
    expect(first.plansMigrated).toBe(1);
    // The plan is gone but its list stays — and the server plan id is
    // persisted, not just held in memory.
    expect(useGuestStore.getState().mealPlans).toEqual([]);
    expect(useGuestStore.getState().groceryLists).toHaveLength(1);
    expect(useGuestStore.getState().migratedPlanIds[plan.id]).toBe('server-plan-1');
    const stored = JSON.parse(localStorage.getItem('mealmate.guest') ?? '{}') as {
      state?: { migratedPlanIds?: Record<string, string> };
    };
    expect(stored.state?.migratedPlanIds?.[plan.id]).toBe('server-plan-1');

    // Next run: the plan is long gone, but the leftover list still links
    // to its server plan through the durable map.
    mockedPost.mockImplementation(async (url: string) => {
      if (url === '/grocery/generate') {
        return { data: { list: { id: 'server-list-1' } } };
      }
      throw new Error(`unexpected POST ${url}`);
    });
    const second = await migrateGuestData();
    expect(mockedPost).toHaveBeenCalledWith('/grocery/generate', {
      mealPlanId: 'server-plan-1',
      usePantry: true,
    });
    expect(second.listsRegenerated).toBe(1);
    expect(second.listsFailed).toBe(0);
    expect(useGuestStore.getState().groceryLists).toEqual([]);
    // No list needs the mapping any more, so it is dropped.
    expect(useGuestStore.getState().migratedPlanIds[plan.id]).toBeUndefined();
  });

  it('does nothing when there is no guest data', async () => {
    const result = await migrateGuestData();
    expect(mockedPost).not.toHaveBeenCalled();
    expect(mockedPatch).not.toHaveBeenCalled();
    expect(result.recipesMigrated).toBe(0);
    expect(result.plansMigrated).toBe(0);
  });

  it('keeps a failed recipe and removes only the one that migrated', async () => {
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
    // The failed recipe stays in the browser so a later sign-in can retry
    // it; only the migrated one is removed.
    const remaining = useGuestStore.getState().recipes;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.title).toBe('Guest Soup');
  });

  it('does nothing and keeps all guest data when the session check fails', async () => {
    mockedGet.mockRejectedValue({ response: { status: 401 } });
    seedGuestData();

    const result = await migrateGuestData();
    expect(mockedPost).not.toHaveBeenCalled();
    expect(mockedPatch).not.toHaveBeenCalled();
    expect(result.recipesMigrated).toBe(0);
    expect(result.plansMigrated).toBe(0);
    // Nothing was wiped: the guest can sign in again and retry.
    expect(useGuestStore.getState().recipes).toHaveLength(1);
    expect(useGuestStore.getState().mealPlans).toHaveLength(1);
    expect(useGuestStore.getState().pantry).toHaveLength(2);
    expect(useGuestStore.getState().groceryLists).toHaveLength(1);
  });

  it('keeps everything when every migration call fails', async () => {
    seedGuestData();
    mockedPost.mockRejectedValue(new Error('server down'));
    mockedPatch.mockRejectedValue(new Error('server down'));

    const result = await migrateGuestData();
    expect(result.recipesFailed).toBe(1);
    expect(result.plansFailed).toBe(1);
    expect(result.listsFailed).toBe(1);
    expect(useGuestStore.getState().recipes).toHaveLength(1);
    expect(useGuestStore.getState().mealPlans).toHaveLength(1);
    expect(useGuestStore.getState().pantry).toHaveLength(2);
    expect(useGuestStore.getState().groceryLists).toHaveLength(1);
  });

  it('does nothing when no user is signed in', async () => {
    useAuthStore.setState({ user: null });
    seedGuestData();
    const result = await migrateGuestData();
    expect(mockedPost).not.toHaveBeenCalled();
    expect(result.recipesMigrated).toBe(0);
    expect(useGuestStore.getState().recipes).toHaveLength(1);
  });

  it('merges guest allergies into the account allergies (union, no duplicates) and clears them', async () => {
    const accountUser: User = { ...testUser, allergies: ['dairy', 'gluten'] };
    useAuthStore.setState({ user: accountUser });
    mockedGet.mockResolvedValue({ data: { user: accountUser } });
    seedGuestData();
    const guest = useGuestStore.getState();
    guest.addTag('allergies', 'dairy');
    guest.addTag('allergies', 'peanuts');
    // Stateful mock: the server applies each PATCH to the current user
    // and returns it, so the allergy and pantry PATCHes do not clobber
    // each other the way a fixed response would.
    let serverUser: User = { ...accountUser };
    mockedPost.mockImplementation(async (url: string) => {
      if (url === '/recipes') return { data: { recipe: { id: 'server-recipe-1' } } };
      if (url === '/mealplans') return { data: { plan: { id: 'server-plan-1' } } };
      if (url === '/grocery/generate') return { data: { list: { id: 'server-list-1' } } };
      throw new Error(`unexpected POST ${url}`);
    });
    mockedPatch.mockImplementation(async (_url: string, body: Record<string, unknown>) => {
      serverUser = { ...serverUser, ...body } as User;
      return { data: { user: serverUser } };
    });

    await migrateGuestData();

    // 'dairy' was already on the account (no duplicate); 'gluten' is
    // preserved; 'peanuts' is added.
    expect(mockedPatch).toHaveBeenCalledWith('/auth/me', {
      allergies: ['dairy', 'gluten', 'peanuts'],
    });
    expect(useGuestStore.getState().allergies).toEqual([]);
    expect(useAuthStore.getState().user?.allergies).toEqual(['dairy', 'gluten', 'peanuts']);
  });

  it('migrates allergies even when they are the only guest data', async () => {
    const guest = useGuestStore.getState();
    guest.addTag('allergies', 'dairy');
    let serverUser: User = { ...testUser };
    mockedPatch.mockImplementation(async (_url: string, body: Record<string, unknown>) => {
      serverUser = { ...serverUser, ...body } as User;
      return { data: { user: serverUser } };
    });

    await migrateGuestData();

    expect(mockedPatch).toHaveBeenCalledWith('/auth/me', { allergies: ['dairy'] });
    expect(mockedPost).not.toHaveBeenCalled();
    expect(useGuestStore.getState().allergies).toEqual([]);
    expect(useAuthStore.getState().user?.allergies).toEqual(['dairy']);
  });

  it('keeps guest allergies for retry when the allergy PATCH fails', async () => {
    const guest = useGuestStore.getState();
    guest.addTag('allergies', 'dairy');
    guest.addTag('allergies', 'peanuts');
    mockedPatch.mockRejectedValue(new Error('server down'));

    await migrateGuestData();

    expect(mockedPatch).toHaveBeenCalledWith('/auth/me', {
      allergies: ['dairy', 'peanuts'],
    });
    // The PATCH failed, so the guest allergies stay for a later sign-in.
    expect(useGuestStore.getState().allergies).toEqual(['dairy', 'peanuts']);
    // The account user is untouched.
    expect(useAuthStore.getState().user?.allergies).toEqual([]);
  });

  it('makes no allergy API call when the guest has no allergies', async () => {
    seedGuestData();
    mockedPost.mockImplementation(async (url: string) => {
      if (url === '/recipes') return { data: { recipe: { id: 'server-recipe-1' } } };
      if (url === '/mealplans') return { data: { plan: { id: 'server-plan-1' } } };
      if (url === '/grocery/generate') return { data: { list: { id: 'server-list-1' } } };
      throw new Error(`unexpected POST ${url}`);
    });
    mockedPatch.mockResolvedValue({
      data: { user: { ...testUser, pantry: [...testUser.pantry, { ingredient: 'Onion' }] } },
    });

    await migrateGuestData();

    // The pantry PATCH still happens, but no call carries an allergies field.
    expect(mockedPatch).toHaveBeenCalled();
    for (const call of mockedPatch.mock.calls) {
      expect(call[1]).not.toHaveProperty('allergies');
    }
    expect(useGuestStore.getState().allergies).toEqual([]);
  });
});
