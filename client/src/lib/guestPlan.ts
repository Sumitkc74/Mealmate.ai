import type {
  GroceryCategory,
  GroceryItem,
  MealPlan,
  Nutrition,
  PantryItem,
  Recipe,
  WeeklyNutrition,
} from '@/types';
import { newGuestId } from '@/stores/guestStore';
import { DAYS_OF_WEEK } from '@/lib/week';

/**
 * Client-side mirrors of the server's grocery aggregation and weekly
 * nutrition math, for guest meal plans. Guest plans never reach the
 * server, so these run entirely in the browser.
 */

const VOLUME_TO_ML: Record<string, number> = {
  ml: 1,
  l: 1000,
  liter: 1000,
  litre: 1000,
  cup: 240,
  cups: 240,
  tbsp: 15,
  tablespoon: 15,
  tsp: 5,
  teaspoon: 5,
};

const WEIGHT_TO_G: Record<string, number> = {
  g: 1,
  gram: 1,
  grams: 1,
  kg: 1000,
  kilogram: 1000,
  oz: 28.3495,
  ounce: 28.3495,
  lb: 453.592,
  pound: 453.592,
};

const CATEGORY_KEYWORDS: Array<{ category: GroceryCategory; words: string[] }> = [
  { category: 'produce', words: ['tomato', 'onion', 'garlic', 'lettuce', 'spinach', 'carrot', 'pepper', 'cucumber', 'apple', 'banana', 'lemon', 'lime', 'broccoli', 'potato', 'celery', 'mushroom', 'avocado', 'kale', 'cilantro', 'parsley', 'basil'] },
  { category: 'dairy', words: ['milk', 'cheese', 'butter', 'yogurt', 'cream', 'mozzarella', 'parmesan', 'feta', 'cheddar', 'sour cream'] },
  { category: 'meat', words: ['chicken', 'beef', 'pork', 'lamb', 'bacon', 'sausage', 'turkey', 'ham', 'steak', 'ground beef'] },
  { category: 'seafood', words: ['salmon', 'tuna', 'shrimp', 'fish', 'cod', 'tilapia', 'crab', 'lobster'] },
  { category: 'bakery', words: ['bread', 'tortilla', 'bagel', 'bun', 'baguette', 'pita', 'naan'] },
  { category: 'pantry', words: ['flour', 'sugar', 'salt', 'rice', 'pasta', 'oil', 'vinegar', 'soy sauce', 'broth', 'bean', 'lentil', 'oats', 'cereal', 'honey', 'syrup', 'spaghetti', 'noodle'] },
  { category: 'frozen', words: ['frozen', 'ice cream', 'pizza'] },
  { category: 'beverages', words: ['water', 'juice', 'coffee', 'tea', 'wine', 'beer', 'soda'] },
  { category: 'snacks', words: ['chips', 'cracker', 'cookie', 'nut', 'almond', 'cashew', 'peanut'] },
  { category: 'spices', words: ['pepper', 'cumin', 'paprika', 'oregano', 'thyme', 'cinnamon', 'turmeric', 'coriander', 'chili', 'cayenne', 'nutmeg', 'rosemary'] },
];

export function categorizeIngredient(ingredient: string): GroceryCategory {
  const name = ingredient.toLowerCase();
  for (const { category, words } of CATEGORY_KEYWORDS) {
    if (words.some((w) => name.includes(w))) return category;
  }
  return 'other';
}

function normalizeUnit(
  qty: number | undefined,
  unit: string | undefined
): { quantity: number; unit: string } | null {
  if (qty === undefined || qty <= 0) return null;
  const u = (unit ?? '').toLowerCase().trim();
  if (!u) return { quantity: qty, unit: '' };
  const volMul = VOLUME_TO_ML[u];
  if (volMul !== undefined) return { quantity: qty * volMul, unit: 'ml' };
  const wMul = WEIGHT_TO_G[u];
  if (wMul !== undefined) return { quantity: qty * wMul, unit: 'g' };
  return { quantity: qty, unit: u };
}

function recipeFromSlot(value: unknown): Recipe | null {
  if (!value || typeof value === 'string') return null;
  return value as Recipe;
}

/** Collect the recipes assigned across all slots of a plan. */
export function collectPlanRecipes(plan: MealPlan): Recipe[] {
  const recipes: Recipe[] = [];
  for (const day of plan.days) {
    for (const slot of ['breakfast', 'lunch', 'dinner'] as const) {
      const r = recipeFromSlot(day[slot]);
      if (r) recipes.push(r);
    }
  }
  return recipes;
}

/**
 * Aggregate a plan's recipe ingredients into deduplicated grocery items,
 * skipping anything already in the pantry. Mirrors the server's
 * aggregateGroceryItems (same unit normalisation and category keywords).
 */
export function aggregateGuestGrocery(
  plan: MealPlan,
  pantry: PantryItem[]
): GroceryItem[] {
  const pantrySet = new Set(pantry.map((p) => p.ingredient.toLowerCase().trim()));
  const bucket = new Map<string, GroceryItem>();

  for (const recipe of collectPlanRecipes(plan)) {
    const recipeTitle = (recipe.title ?? '').trim();
    for (const ing of recipe.ingredients) {
      const name = ing.name.toLowerCase().trim();
      if (!name) continue;
      if (pantrySet.has(name)) continue;
      const normalized = normalizeUnit(ing.quantity, ing.unit);
      const unitKey = normalized?.unit ?? '';
      const key = `${name}::${unitKey}`;
      const source = recipeTitle
        ? {
            recipe: recipe.id,
            title: recipeTitle,
            quantity: normalized?.quantity,
            unit: unitKey || undefined,
          }
        : null;
      const existing = bucket.get(key);
      if (existing) {
        if (existing.quantity !== undefined && normalized) {
          existing.quantity = Math.round((existing.quantity + normalized.quantity) * 10) / 10;
        }
        if (source) {
          existing.sources = [...(existing.sources ?? []), source];
        }
      } else {
        bucket.set(key, {
          _id: newGuestId(),
          ingredient: name,
          quantity: normalized?.quantity,
          unit: unitKey || undefined,
          category: categorizeIngredient(name),
          checked: false,
          sources: source ? [source] : [],
        });
      }
    }
  }
  return [...bucket.values()];
}

const EMPTY_NUTRITION: Required<Nutrition> = {
  calories: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  fiber: 0,
  sugar: 0,
  sodium: 0,
};

/**
 * Weekly nutrition for a guest plan, computed from the stored per-recipe
 * nutrition only (no AI estimate). A recipe's nutrition is per serving;
 * each assigned slot counts once.
 */
export function computeGuestWeeklyNutrition(plan: MealPlan): WeeklyNutrition {
  const days = DAYS_OF_WEEK.map((day) => {
    const dayDoc = plan.days.find((d) => d.day === day);
    const total: Required<Nutrition> = { ...EMPTY_NUTRITION };
    if (dayDoc) {
      for (const slot of ['breakfast', 'lunch', 'dinner'] as const) {
        const r = recipeFromSlot(dayDoc[slot]);
        const n = r?.nutrition;
        if (!n) continue;
        total.calories += n.calories ?? 0;
        total.protein += n.protein ?? 0;
        total.carbs += n.carbs ?? 0;
        total.fat += n.fat ?? 0;
        total.fiber += n.fiber ?? 0;
        total.sugar += n.sugar ?? 0;
        total.sodium += n.sodium ?? 0;
      }
    }
    return { day, nutrition: total };
  });

  const total: Required<Nutrition> = { ...EMPTY_NUTRITION };
  for (const d of days) {
    total.calories += d.nutrition.calories;
    total.protein += d.nutrition.protein;
    total.carbs += d.nutrition.carbs;
    total.fat += d.nutrition.fat;
    total.fiber += d.nutrition.fiber;
    total.sugar += d.nutrition.sugar;
    total.sodium += d.nutrition.sodium;
  }
  const average: Required<Nutrition> = {
    calories: total.calories / 7,
    protein: total.protein / 7,
    carbs: total.carbs / 7,
    fat: total.fat / 7,
    fiber: total.fiber / 7,
    sugar: total.sugar / 7,
    sodium: total.sodium / 7,
  };
  return { days, total, average };
}
