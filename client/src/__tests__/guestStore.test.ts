import { describe, it, expect, beforeEach } from 'vitest';
import {
  useGuestStore,
  newGuestId,
  isGuestId,
  isGuestRecipe,
  hasGuestData,
  emptyGuestPlan,
} from '@/stores/guestStore';
import type { RecipeInput } from '@/hooks/useRecipes';
import type { PantryItem } from '@/types';

const GUEST_KEY = 'mealmate.guest';

const tomato: PantryItem = {
  ingredient: 'Tomato',
  quantity: '3',
  unit: 'pcs',
  category: 'produce',
};

const soupInput: RecipeInput = {
  title: 'Test Tomato Soup',
  description: 'A quick soup',
  cuisine: 'italian',
  tags: ['quick'],
  difficulty: 'easy',
  prepTime: 5,
  cookTime: 20,
  servings: 2,
  imageUrl: 'https://example.com/soup.jpg',
  ingredients: [{ name: 'Tomato', quantity: 3, unit: 'pcs' }],
  instructions: ['Blend.', 'Simmer.'],
  nutrition: { calories: 120, protein: 3, carbs: 15, fat: 4 },
};

describe('guestStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useGuestStore.getState().clearAll();
  });

  it('generates stable guest ids with the guest- prefix', () => {
    const id = newGuestId();
    expect(id.startsWith('guest-')).toBe(true);
    expect(isGuestId(id)).toBe(true);
    expect(isGuestId('507f1f77bcf86cd799439011')).toBe(false);
    expect(isGuestId(undefined)).toBe(false);
    expect(isGuestRecipe({ id })).toBe(true);
    expect(isGuestRecipe({ id: '507f1f77bcf86cd799439011' })).toBe(false);
  });

  it('adds, removes and clears pantry items', () => {
    const s = useGuestStore.getState();
    s.addPantryItem(tomato);
    s.addPantryItem({ ingredient: 'Onion', quantity: '1', unit: 'pcs', category: 'produce' });
    expect(useGuestStore.getState().pantry).toHaveLength(2);
    useGuestStore.getState().removePantryItem(0);
    expect(useGuestStore.getState().pantry.map((p) => p.ingredient)).toEqual(['Onion']);
    useGuestStore.getState().clearPantry();
    expect(useGuestStore.getState().pantry).toEqual([]);
  });

  it('adds, removes and toggles preference/allergy tags (case-insensitive, deduped)', () => {
    const s = useGuestStore.getState();
    s.addTag('dietaryPreferences', 'Vegetarian');
    s.addTag('dietaryPreferences', 'vegetarian');
    s.addTag('allergies', 'Peanut');
    expect(useGuestStore.getState().dietaryPreferences).toEqual(['vegetarian']);
    expect(useGuestStore.getState().allergies).toEqual(['peanut']);
    s.toggleTag('dietaryPreferences', 'VEGETARIAN');
    expect(useGuestStore.getState().dietaryPreferences).toEqual([]);
    s.toggleTag('allergies', 'dairy');
    expect(useGuestStore.getState().allergies).toEqual(['peanut', 'dairy']);
    s.removeTag('allergies', 'Peanut');
    expect(useGuestStore.getState().allergies).toEqual(['dairy']);
  });

  it('creates plans, assigns recipes to slots, and deletes plans', () => {
    const s = useGuestStore.getState();
    const plan = s.createMealPlan('2026-11-23');
    expect(plan.id.startsWith('guest-')).toBe(true);
    expect(plan.days).toHaveLength(7);
    expect(plan.days.every((d) => d.breakfast === null)).toBe(true);

    const recipe = s.addRecipe(soupInput);
    s.assignSlot(plan.id, 'Monday', 'lunch', recipe);
    const stored = useGuestStore.getState().mealPlans[0]!;
    const lunch = stored.days.find((d) => d.day === 'Monday')?.lunch;
    expect(lunch && typeof lunch !== 'string' ? lunch.id : undefined).toBe(recipe.id);
    s.assignSlot(plan.id, 'Monday', 'lunch', null);
    expect(
      useGuestStore.getState().mealPlans[0]!.days.find((d) => d.day === 'Monday')?.lunch
    ).toBeNull();
    s.deleteMealPlan(plan.id);
    expect(useGuestStore.getState().mealPlans).toEqual([]);
  });

  it('adds recipes from input, updates them, and deletes them', () => {
    const s = useGuestStore.getState();
    const recipe = s.addRecipe(soupInput);
    expect(recipe.id.startsWith('guest-')).toBe(true);
    expect(recipe.slug).toContain('test-tomato-soup');
    expect(recipe.source).toBe('user');
    expect(recipe.createdBy).toBe('guest');
    expect(recipe.totalTime).toBe(25);

    const updated = s.updateRecipe(recipe.id, { title: 'Renamed Soup', servings: 4 });
    expect(updated?.title).toBe('Renamed Soup');
    expect(updated?.servings).toBe(4);
    expect(updated?.totalTime).toBe(25);
    expect(useGuestStore.getState().recipes[0]?.title).toBe('Renamed Soup');

    s.deleteRecipe(recipe.id);
    expect(useGuestStore.getState().recipes).toEqual([]);
  });

  it('manages grocery lists and transfers checked items to the guest pantry', () => {
    const s = useGuestStore.getState();
    const listId = newGuestId();
    const now = new Date().toISOString();
    s.addGroceryList({
      id: listId,
      user: 'guest',
      mealPlan: 'plan-1',
      items: [
        { _id: 'i1', ingredient: 'milk', quantity: 1, unit: 'l', category: 'dairy', checked: true },
        { _id: 'i2', ingredient: 'bread', quantity: 1, unit: '', category: 'bakery', checked: false },
      ],
      createdAt: now,
      updatedAt: now,
    });
    expect(useGuestStore.getState().groceryLists).toHaveLength(1);

    s.updateGroceryItem(listId, 'i2', { checked: true });
    const { count } = s.transferCheckedToPantry(listId);
    expect(count).toBe(2);
    const state = useGuestStore.getState();
    expect(state.pantry.map((p) => p.ingredient)).toEqual(['milk', 'bread']);
    // Transferred items carry a shelf-life expiry.
    expect(state.pantry[0]?.expiresAt).toBeTruthy();
    expect(state.groceryLists[0]?.items).toEqual([]);

    s.deleteGroceryList(listId);
    expect(useGuestStore.getState().groceryLists).toEqual([]);
  });

  it('persists the guest state shape to localStorage', () => {
    const s = useGuestStore.getState();
    s.addPantryItem(tomato);
    s.addRecipe(soupInput);
    const raw = localStorage.getItem(GUEST_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.state.pantry).toHaveLength(1);
    expect(parsed.state.recipes).toHaveLength(1);
    expect(parsed.state.mealPlans).toEqual([]);
    expect(parsed.state.groceryLists).toEqual([]);
    expect(parsed.state.dietaryPreferences).toEqual([]);
    expect(parsed.state.allergies).toEqual([]);
  });

  it('reports whether any guest data exists', () => {
    expect(hasGuestData(useGuestStore.getState())).toBe(false);
    useGuestStore.getState().addPantryItem(tomato);
    expect(hasGuestData(useGuestStore.getState())).toBe(true);
    useGuestStore.getState().clearAll();
    expect(hasGuestData(useGuestStore.getState())).toBe(false);
  });

  it('builds an empty plan with all seven days', () => {
    const plan = emptyGuestPlan('2026-11-23');
    expect(plan.days.map((d) => d.day)).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ]);
  });
});
