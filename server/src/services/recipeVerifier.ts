/**
 * Server-side recipe verification and food safety guardrails.
 *
 * Enforces food safety, edibility, and culinary coherence on recipes
 * before they can be persisted or shared.
 */

import { AppError } from '../utils/AppError';
import { logger } from '../config/logger';
import {
  verifyRecipeWithAiService,
  estimateRecipeNutritionWithAiService,
  type VerifyRecipeInput,
  type VerifyRecipeResponse,
  type RecipeVerificationIssue,
  type EstimateNutritionInput,
  type EstimateNutritionResponse,
} from './aiClient';

// Toxic and non-food substances to reject unconditionally
const HAZARDOUS_SUBSTANCES = new Set([
  'bleach',
  'clorox',
  'detergent',
  'dish soap',
  'dishwashing liquid',
  'laundry pod',
  'tide pod',
  'ammonia',
  'drain cleaner',
  'drano',
  'lysol',
  'hand sanitizer',
  'shampoo',
  'conditioner',
  'isopropyl alcohol',
  'rubbing alcohol',
  'acetone',
  'paint thinner',
  'turpentine',
  'kerosene',
  'gasoline',
  'petrol',
  'diesel',
  'motor oil',
  'wd-40',
  'antifreeze',
  'brake fluid',
  'arsenic',
  'cyanide',
  'potassium cyanide',
  'sodium cyanide',
  'strychnine',
  'hemlock',
  'belladonna',
  'rat poison',
  'rodenticide',
  'pesticide',
  'insecticide',
  'herbicide',
  'roundup',
  'asbestos',
  'mercury',
  'cadmium',
  'lead paint',
  'broken glass',
  'glass shards',
  'lithium battery',
  'car battery',
  'battery acid',
  'hydrochloric acid',
  'sulfuric acid',
  'nitric acid',
  'caustic soda',
  'metal shavings',
  'screws',
  'nails',
  'plastic wrap melt',
  'styrofoam',
  'cement',
  'concrete',
  'fertilizer',
  'human feces',
  'feces',
  'urine',
]);

const COOKING_ACTIONS = new Set([
  'bake', 'baking', 'boil', 'boiling', 'fry', 'frying', 'saute', 'sauté',
  'roast', 'roasting', 'simmer', 'simmering', 'steam', 'steaming', 'grill',
  'grilling', 'broil', 'broiling', 'cook', 'cooking', 'stir', 'stirring',
  'mix', 'mixing', 'whisk', 'whisking', 'chop', 'chopping', 'dice', 'dicing',
  'mince', 'mincing', 'slice', 'slicing', 'peel', 'peeling', 'knead', 'kneading',
  'fold', 'folding', 'pour', 'pouring', 'season', 'seasoning', 'marinate',
  'marinating', 'heat', 'heating', 'preheat', 'preheating', 'blend', 'blending',
  'chill', 'chilling', 'freeze', 'freezing', 'rest', 'resting', 'serve', 'serving',
  'garnish', 'garnishing', 'assemble', 'assemblying', 'melt', 'melting',
  'combine', 'combining', 'toast', 'toasting', 'toss', 'tossing', 'drain', 'draining',
]);

const ALLERGEN_MAP: Record<string, string[]> = {
  dairy: ['milk', 'butter', 'cheese', 'cream', 'yogurt', 'sour cream', 'ghee', 'parmesan', 'cheddar', 'mozzarella'],
  egg: ['egg', 'eggs', 'egg yolk', 'egg white', 'mayonnaise'],
  peanut: ['peanut', 'peanuts', 'peanut butter', 'groundnut'],
  'tree nut': ['almond', 'walnut', 'cashew', 'pecan', 'pistachio', 'hazelnut', 'macadamia', 'pine nut'],
  gluten: ['flour', 'wheat', 'pasta', 'spaghetti', 'bread', 'noodle', 'barley', 'couscous', 'semolina'],
  soy: ['soy', 'tofu', 'edamame', 'tempeh', 'miso', 'tamari', 'soy sauce'],
  fish: ['salmon', 'tuna', 'cod', 'tilapia', 'trout', 'anchovy', 'sardine', 'halibut', 'snapper'],
  shellfish: ['shrimp', 'prawn', 'crab', 'lobster', 'clam', 'mussel', 'oyster', 'scallop', 'squid', 'octopus'],
  sesame: ['sesame', 'tahini', 'sesame oil'],
};

function checkGibberish(text: string): boolean {
  const clean = text.trim().toLowerCase();
  if (!clean || clean.length < 3) return false;

  // 5+ repeated identical chars (e.g. "aaaaa")
  if (/(.)\1{4,}/.test(clean)) return true;

  const words = clean.match(/[a-z]+/g) || [];
  if (words.length === 0) return true;

  for (const word of words) {
    // 5+ consecutive consonants (e.g. "asdfghjk", "zxcvbnm")
    if (/[bcdfghjklmnpqrstvwxz]{5,}/.test(word)) return true;

    if (word.length >= 6) {
      const vowels = (word.match(/[aeiouy]/g) || []).length;
      if (vowels === 0) return true;
      if (word.length >= 8 && vowels / word.length < 0.22) return true;
    }
  }

  return false;
}

function detectAllergens(ingredients: Array<{ name: string }>): string[] {
  const found = new Set<string>();
  for (const ing of ingredients) {
    const name = (ing.name || '').toLowerCase();
    for (const [allergen, keywords] of Object.entries(ALLERGEN_MAP)) {
      if (keywords.some((kw) => new RegExp(`\\b${kw}s?\\b`, 'i').test(name))) {
        found.add(allergen);
      }
    }
  }
  return Array.from(found).sort();
}

/**
 * Fast deterministic fallback verification if AI service is offline.
 */
export function verifyRecipeDeterministic(recipe: VerifyRecipeInput): VerifyRecipeResponse {
  const issues: RecipeVerificationIssue[] = [];
  const suggestions: string[] = [];
  let score = 100;

  const title = (recipe.title || '').trim();
  if (!title) {
    issues.push({
      severity: 'error',
      category: 'completeness',
      message: 'Recipe title cannot be empty.',
      field: 'title',
    });
    score -= 50;
  } else if (checkGibberish(title)) {
    issues.push({
      severity: 'error',
      category: 'coherence',
      message: `Recipe title "${title}" appears to be gibberish or nonsensical.`,
      field: 'title',
    });
    score -= 60;
  }

  const ingredients = recipe.ingredients || [];
  if (ingredients.length === 0) {
    issues.push({
      severity: 'error',
      category: 'completeness',
      message: 'Recipe must have at least one ingredient.',
      field: 'ingredients',
    });
    score -= 40;
  } else {
    ingredients.forEach((ing, idx) => {
      const name = (ing.name || '').trim().toLowerCase();
      if (!name) return;

      for (const hazardous of HAZARDOUS_SUBSTANCES) {
        if (new RegExp(`\\b${hazardous}\\b`, 'i').test(name)) {
          issues.push({
            severity: 'error',
            category: 'safety',
            message: `Hazardous/toxic ingredient detected: "${hazardous}". This violates food safety policies.`,
            field: `ingredients[${idx}].name`,
          });
          score = 0;
        }
      }

      if (checkGibberish(name)) {
        issues.push({
          severity: 'error',
          category: 'coherence',
          message: `Ingredient "${name}" appears to be gibberish.`,
          field: `ingredients[${idx}].name`,
        });
        score -= 30;
      }
    });
  }

  const instructions = recipe.instructions || [];
  if (instructions.length === 0) {
    issues.push({
      severity: 'error',
      category: 'completeness',
      message: 'Recipe must provide at least one cooking instruction step.',
      field: 'instructions',
    });
    score -= 40;
  } else {
    const combined = instructions.join(' ').toLowerCase();
    const hasCookingAction = Array.from(COOKING_ACTIONS).some((action) =>
      new RegExp(`\\b${action}\\b`, 'i').test(combined)
    );

    if (!hasCookingAction && instructions.length > 0) {
      issues.push({
        severity: 'warning',
        category: 'instructions',
        message: 'Cooking instructions lack recognized culinary action verbs (e.g. chop, boil, bake, sauté, mix).',
        field: 'instructions',
      });
      score -= 15;
    }

    instructions.forEach((step, idx) => {
      if (checkGibberish(step)) {
        issues.push({
          severity: 'error',
          category: 'coherence',
          message: `Instruction step ${idx + 1} contains gibberish or nonsensical text.`,
          field: `instructions[${idx}]`,
        });
        score -= 30;
      }
    });
  }

  const detectedAllergens = detectAllergens(ingredients);
  if (detectedAllergens.length > 0) {
    suggestions.push(`Contains common allergens: ${detectedAllergens.join(', ')}.`);
  }

  if (ingredients.length > 0 && ingredients.length < 3) {
    suggestions.push('Consider adding herbs or seasoning (e.g., salt, pepper, olive oil) for balanced flavor.');
  }

  score = Math.max(0, Math.min(100, score));
  const hasErrors = issues.some((i) => i.severity === 'error');
  const isValid = !hasErrors && score >= 40;

  let verdict: 'verified' | 'needs_review' | 'rejected';
  let summary: string;

  if (hasErrors) {
    verdict = 'rejected';
    summary = 'Recipe rejected due to food safety violations, gibberish, or incomplete fields.';
  } else if (score < 70) {
    verdict = 'needs_review';
    summary = 'Recipe passed baseline safety checks but could be improved before sharing.';
  } else {
    verdict = 'verified';
    summary = 'Recipe verified! Safe, culinary-sound, and ready to publish.';
  }

  return {
    success: true,
    is_valid: isValid,
    score,
    verdict,
    summary,
    issues,
    detected_allergens: detectedAllergens,
    suggestions,
  };
}

/**
 * Verify a recipe via the AI microservice with automatic local deterministic fallback.
 */
export async function verifyRecipe(recipe: VerifyRecipeInput): Promise<VerifyRecipeResponse> {
  // Always run local deterministic check first to catch immediate hard safety violations
  const deterministic = verifyRecipeDeterministic(recipe);
  if (!deterministic.is_valid) {
    return deterministic;
  }

  try {
    return await verifyRecipeWithAiService(recipe);
  } catch (err) {
    logger.warn({ err }, 'AI verification service unavailable, using deterministic verification');
    return deterministic;
  }
}

/**
 * Assert that a recipe meets safety requirements before persisting to DB.
 * Throws AppError.badRequest if verification fails.
 */
export async function assertRecipeSafe(recipe: VerifyRecipeInput): Promise<VerifyRecipeResponse> {
  const result = await verifyRecipe(recipe);
  if (!result.is_valid) {
    const errorDetails = result.issues
      .filter((i) => i.severity === 'error')
      .map((i) => i.message)
      .join('; ');
    throw AppError.badRequest(
      `Recipe verification failed: ${errorDetails || result.summary}`
    );
  }
  return result;
}

// ---------------------------------------------------------------------------
// Nutrition Estimation
// ---------------------------------------------------------------------------

const INGREDIENT_MACROS: Record<string, { calories: number; protein: number; carbs: number; fat: number; fiber?: number; sodium?: number }> = {
  pasta: { calories: 355, protein: 13, carbs: 71, fat: 1.5, fiber: 3.2, sodium: 6 },
  spaghetti: { calories: 355, protein: 13, carbs: 71, fat: 1.5, fiber: 3.2, sodium: 6 },
  noodle: { calories: 350, protein: 12, carbs: 70, fat: 2.0, fiber: 2.5, sodium: 15 },
  rice: { calories: 130, protein: 2.7, carbs: 28, fat: 0.3, fiber: 0.4, sodium: 1 },
  flour: { calories: 364, protein: 10, carbs: 76, fat: 1.0, fiber: 2.7, sodium: 2 },
  bread: { calories: 265, protein: 9, carbs: 49, fat: 3.2, fiber: 2.7, sodium: 490 },
  chicken: { calories: 165, protein: 31, carbs: 0, fat: 3.6, fiber: 0, sodium: 74 },
  beef: { calories: 250, protein: 26, carbs: 0, fat: 15.0, fiber: 0, sodium: 72 },
  salmon: { calories: 208, protein: 20, carbs: 0, fat: 13.0, fiber: 0, sodium: 59 },
  egg: { calories: 143, protein: 13, carbs: 0.7, fat: 9.5, fiber: 0, sodium: 142 },
  tofu: { calories: 76, protein: 8, carbs: 1.9, fat: 4.8, fiber: 0.3, sodium: 7 },
  'olive oil': { calories: 884, protein: 0, carbs: 0, fat: 100.0, fiber: 0, sodium: 2 },
  butter: { calories: 717, protein: 0.9, carbs: 0.1, fat: 81.0, fiber: 0, sodium: 11 },
  oil: { calories: 884, protein: 0, carbs: 0, fat: 100.0, fiber: 0, sodium: 0 },
  cheese: { calories: 393, protein: 25, carbs: 3.2, fat: 32.0, fiber: 0, sodium: 650 },
  parmesan: { calories: 431, protein: 38, carbs: 4.1, fat: 29.0, fiber: 0, sodium: 1529 },
  milk: { calories: 61, protein: 3.2, carbs: 4.8, fat: 3.3, fiber: 0, sodium: 43 },
  garlic: { calories: 149, protein: 6.4, carbs: 33, fat: 0.5, fiber: 2.1, sodium: 17 },
  onion: { calories: 40, protein: 1.1, carbs: 9.3, fat: 0.1, fiber: 1.7, sodium: 4 },
  tomato: { calories: 18, protein: 0.9, carbs: 3.9, fat: 0.2, fiber: 1.2, sodium: 5 },
  potato: { calories: 77, protein: 2.0, carbs: 17, fat: 0.1, fiber: 2.2, sodium: 6 },
  spinach: { calories: 23, protein: 2.9, carbs: 3.6, fat: 0.4, fiber: 2.2, sodium: 79 },
  carrot: { calories: 41, protein: 0.9, carbs: 9.6, fat: 0.2, fiber: 2.8, sodium: 69 },
  sugar: { calories: 387, protein: 0, carbs: 100, fat: 0, fiber: 0, sodium: 1 },
  beans: { calories: 127, protein: 8.7, carbs: 23, fat: 0.5, fiber: 6.4, sodium: 2 },
};

function getMultiplier(quantity?: number, unit?: string, ingName = ''): number {
  const qty = typeof quantity === 'number' && quantity > 0 ? quantity : 1;
  const u = (unit || '').toLowerCase().trim();

  if (['g', 'gram', 'grams'].includes(u)) return qty / 100;
  if (['kg', 'kilogram', 'kilograms'].includes(u)) return (qty * 1000) / 100;
  if (['oz', 'ounce', 'ounces'].includes(u)) return (qty * 28.35) / 100;
  if (['lb', 'lbs', 'pound', 'pounds'].includes(u)) return (qty * 453.6) / 100;
  if (['tbsp', 'tablespoon', 'tablespoons'].includes(u)) return (qty * 14) / 100;
  if (['tsp', 'teaspoon', 'teaspoons'].includes(u)) return (qty * 5) / 100;
  if (['cup', 'cups'].includes(u)) return (qty * 200) / 100;
  if (['clove', 'cloves'].includes(u)) return (qty * 4) / 100;

  if (ingName.includes('egg')) return (qty * 50) / 100;
  if (ingName.includes('garlic')) return (qty * 4) / 100;
  if (ingName.includes('onion') || ingName.includes('tomato') || ingName.includes('potato')) return (qty * 150) / 100;

  return (qty * 100) / 100;
}

export function estimateNutritionFallback(payload: EstimateNutritionInput): EstimateNutritionResponse {
  const servings = Math.max(1, payload.servings ?? 2);
  let totalCal = 0;
  let totalPro = 0;
  let totalCarb = 0;
  let totalFat = 0;
  let totalFib = 0;
  let totalSod = 0;

  for (const ing of payload.ingredients || []) {
    const name = (ing.name || '').toLowerCase().trim();
    if (!name) continue;

    const mult = getMultiplier(ing.quantity, ing.unit, name);
    let matched = Object.entries(INGREDIENT_MACROS).find(([k]) =>
      new RegExp(`\\b${k}s?\\b`, 'i').test(name)
    )?.[1];

    if (!matched) {
      matched = { calories: 50, protein: 1.5, carbs: 8, fat: 0.5, fiber: 1.5, sodium: 20 };
    }

    totalCal += matched.calories * mult;
    totalPro += matched.protein * mult;
    totalCarb += matched.carbs * mult;
    totalFat += matched.fat * mult;
    totalFib += (matched.fiber ?? 0) * mult;
    totalSod += (matched.sodium ?? 0) * mult;
  }

  return {
    success: true,
    calories: Math.round((totalCal / servings) * 10) / 10,
    protein: Math.round((totalPro / servings) * 10) / 10,
    carbs: Math.round((totalCarb / servings) * 10) / 10,
    fat: Math.round((totalFat / servings) * 10) / 10,
    fiber: totalFib > 0 ? Math.round((totalFib / servings) * 10) / 10 : undefined,
    sodium: totalSod > 0 ? Math.round((totalSod / servings) * 10) / 10 : undefined,
    servings,
  };
}

export async function estimateNutrition(payload: EstimateNutritionInput): Promise<EstimateNutritionResponse> {
  try {
    return await estimateRecipeNutritionWithAiService(payload);
  } catch {
    return estimateNutritionFallback(payload);
  }
}

