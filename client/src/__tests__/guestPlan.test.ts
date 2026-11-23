import { describe, it, expect } from 'vitest';
import {
  aggregateGuestGrocery,
  computeGuestWeeklyNutrition,
  collectPlanRecipes,
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
