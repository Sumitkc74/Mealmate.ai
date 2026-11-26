import { describe, it, expect } from 'vitest';
import {
  aggregateGuestGrocery,
  computeGuestWeeklyNutrition,
  collectPlanRecipes,
  filterSafeGuestRecipes,
  findGuestRecipeAllergyConflict,
} from '@/lib/guestPlan';
import { emptyGuestPlan } from '@/stores/guestStore';
import type { MealPlan, PantryItem, Recipe } from '@/types';

function makeRecipe(overrides: Partial<Recipe> & { title: string }): Recipe {
  return {
    id: `r-${overrides.title}`,
    slug: overrides.title.toLowerCase().replace(/\s+/g, '-'),
    ingredients: [],
    instructions: [],
    prepTime: 10,
    cookTime: 20,
    servings: 2,
    tags: [],
    difficulty: 'easy',
    ...overrides,
  };
}

const soup = makeRecipe({
  title: 'Tomato Soup',
  ingredients: [
    { name: 'Tomato', quantity: 500, unit: 'g' },
    { name: 'Onion', quantity: 1, unit: 'pcs' },
    { name: 'Olive Oil', quantity: 2, unit: 'tbsp' },
  ],
  nutrition: { calories: 120, protein: 3, carbs: 15, fat: 4 },
});

const pasta = makeRecipe({
  title: 'Pasta',
  ingredients: [
    { name: 'Tomato', quantity: 200, unit: 'g' },
    { name: 'Pasta', quantity: 250, unit: 'g' },
  ],
  nutrition: { calories: 400, protein: 12, carbs: 60, fat: 8 },
});

function makePlan(): MealPlan {
  const plan = emptyGuestPlan('2026-11-23');
  const monday = plan.days.find((d) => d.day === 'Monday')!;
  monday.lunch = soup;
  monday.dinner = pasta;
  const tuesday = plan.days.find((d) => d.day === 'Tuesday')!;
  tuesday.lunch = soup;
  return plan;
}

describe('guestPlan helpers', () => {
  it('collects the recipes assigned across all slots', () => {
    const recipes = collectPlanRecipes(makePlan());
    expect(recipes.map((r) => r.title)).toEqual(['Tomato Soup', 'Pasta', 'Tomato Soup']);
  });

  it('aggregates ingredients, normalises units, and skips pantry items', () => {
    const pantry: PantryItem[] = [{ ingredient: 'onion', category: 'produce' }];
    const items = aggregateGuestGrocery(makePlan(), pantry);
    const tomato = items.find((i) => i.ingredient === 'tomato');
    // 500g (Mon lunch) + 200g (Mon dinner) + 500g (Tue lunch) = 1200g.
    expect(tomato?.quantity).toBe(1200);
    expect(tomato?.unit).toBe('g');
    expect(tomato?.sources).toHaveLength(3);
    // Onion is already in the pantry, so it is skipped.
    expect(items.some((i) => i.ingredient === 'onion')).toBe(false);
    // 2 tbsp olive oil, in two slots (Mon + Tue lunch) = 4 tbsp = 60 ml.
    const oil = items.find((i) => i.ingredient === 'olive oil');
    expect(oil?.quantity).toBe(60);
    expect(oil?.unit).toBe('ml');
    expect(items.every((i) => !i.checked)).toBe(true);
  });

  it('computes weekly nutrition from stored per-recipe values only', () => {
    const nutrition = computeGuestWeeklyNutrition(makePlan());
    // Monday: soup 120 + pasta 400 = 520; Tuesday: soup 120. Total 640.
    expect(nutrition.total.calories).toBe(640);
    expect(nutrition.average.calories).toBeCloseTo(640 / 7);
    expect(nutrition.total.protein).toBe(3 + 12 + 3);
    const monday = nutrition.days.find((d) => d.day === 'Monday');
    expect(monday?.nutrition.calories).toBe(520);
    const wednesday = nutrition.days.find((d) => d.day === 'Wednesday');
    expect(wednesday?.nutrition.calories).toBe(0);
  });

  it('returns zero nutrition for an empty plan', () => {
    const nutrition = computeGuestWeeklyNutrition(emptyGuestPlan('2026-11-23'));
    expect(nutrition.total.calories).toBe(0);
    expect(nutrition.days).toHaveLength(7);
  });
});

describe('guest allergy filtering', () => {
  const pancakes = makeRecipe({
    title: 'Fluffy Pancakes',
    ingredients: [
      { name: 'flour', quantity: 200, unit: 'g' },
      { name: 'milk', quantity: 250, unit: 'ml' },
      { name: 'egg', quantity: 2, unit: 'pcs' },
      { name: 'butter', quantity: 50, unit: 'g' },
      { name: 'sugar', quantity: 30, unit: 'g' },
    ],
  });

  const stirFry = makeRecipe({
    title: 'Veggie Stir Fry',
    ingredients: [
      { name: 'rice', quantity: 200, unit: 'g' },
      { name: 'tomato', quantity: 2, unit: 'pcs' },
      { name: 'garlic', quantity: 3, unit: 'pcs' },
    ],
  });

  const coconutCurry = makeRecipe({
    title: 'Coconut Curry',
    ingredients: [
      { name: 'coconut milk', quantity: 400, unit: 'ml' },
      { name: 'rice', quantity: 200, unit: 'g' },
      { name: 'curry paste', quantity: 2, unit: 'tbsp' },
    ],
  });

  const soyMilkSmoothie = makeRecipe({
    title: 'Soy Milk Smoothie',
    ingredients: [
      { name: 'soy milk', quantity: 250, unit: 'ml' },
      { name: 'banana', quantity: 1, unit: 'pcs' },
    ],
  });

  it('excludes a milk/butter recipe for a guest dairy allergy and keeps a safe recipe', () => {
    const safe = filterSafeGuestRecipes(
      [pancakes, stirFry, coconutCurry],
      ['dairy']
    );
    expect(safe.map((r) => r.title)).toEqual(['Veggie Stir Fry', 'Coconut Curry']);
  });

  it('does NOT exclude a coconut-milk recipe for a guest dairy allergy', () => {
    const safe = filterSafeGuestRecipes([coconutCurry], ['dairy']);
    expect(safe).toEqual([coconutCurry]);
    expect(findGuestRecipeAllergyConflict(coconutCurry, ['dairy'])).toBeNull();
  });

  it('still catches soy milk for a guest soy allergy', () => {
    const safe = filterSafeGuestRecipes([soyMilkSmoothie, coconutCurry], ['soy']);
    expect(safe.map((r) => r.title)).toEqual(['Coconut Curry']);
  });

  it('names the conflicting ingredient and the saved allergy', () => {
    const conflict = findGuestRecipeAllergyConflict(pancakes, ['dairy']);
    expect(conflict).not.toBeNull();
    expect(conflict?.ingredient).toBe('milk');
    expect(conflict?.allergy).toBe('dairy');
    expect(findGuestRecipeAllergyConflict(stirFry, ['dairy'])).toBeNull();
  });

  it('returns the list unchanged when the guest saved no allergies', () => {
    const recipes = [pancakes, stirFry];
    expect(filterSafeGuestRecipes(recipes, [])).toBe(recipes);
  });
});
