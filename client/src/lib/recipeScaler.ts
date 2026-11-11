import type { Recipe } from '@/types';

/**
 * Formats a numeric quantity into a standard culinary fraction or decimal.
 * e.g. 0.5 -> "1/2", 1.25 -> "1 1/4", 2.33 -> "2 1/3", 3 -> "3"
 */
export function formatQuantity(num: number | undefined | null): string {
  if (num == null || isNaN(num) || num <= 0) return '';
  
  const whole = Math.floor(num);
  const remainder = num - whole;

  if (remainder < 0.05) return whole > 0 ? String(whole) : '';
  if (Math.abs(remainder - 0.25) < 0.07) return whole > 0 ? `${whole} 1/4` : '1/4';
  if (Math.abs(remainder - 0.33) < 0.07) return whole > 0 ? `${whole} 1/3` : '1/3';
  if (Math.abs(remainder - 0.5) < 0.07) return whole > 0 ? `${whole} 1/2` : '1/2';
  if (Math.abs(remainder - 0.67) < 0.07) return whole > 0 ? `${whole} 2/3` : '2/3';
  if (Math.abs(remainder - 0.75) < 0.07) return whole > 0 ? `${whole} 3/4` : '3/4';
  if (remainder >= 0.95) return String(whole + 1);

  // Round to 1 decimal place if not a clean culinary fraction
  return String(Math.round(num * 10) / 10);
}

/**
 * Scales an individual quantity based on serving ratio.
 */
export function scaleQuantity(
  originalQty: number | undefined | null,
  originalServings: number,
  targetServings: number
): number | undefined {
  if (originalQty == null || isNaN(originalQty)) return undefined;
  if (!originalServings || originalServings <= 0) return originalQty;
  const ratio = targetServings / originalServings;
  return originalQty * ratio;
}

/**
 * Scales a full recipe object's ingredients and servings.
 */
export function scaleRecipe(recipe: Recipe, targetServings: number): Recipe {
  const originalServings = recipe.servings || 1;
  const ratio = targetServings / originalServings;

  const scaledIngredients = recipe.ingredients.map((ing) => ({
    ...ing,
    quantity: ing.quantity != null ? ing.quantity * ratio : undefined,
  }));

  return {
    ...recipe,
    servings: targetServings,
    ingredients: scaledIngredients,
  };
}

export interface DetectedTimer {
  label: string;
  seconds: number;
  match: string;
}

/**
 * Parses cooking step text to detect durations for interactive kitchen timers.
 * Examples: "bake for 25 minutes", "simmer for 10-15 mins", "rest for 1 hour"
 */
export function extractInstructionTimers(text: string): DetectedTimer[] {
  const regex = /(\d+(?:\.\d+)?(?:\s*(?:-|to)\s*\d+(?:\.\d+)?)?)\s*(minutes?|mins?|hours?|hrs?|seconds?|secs?)\b/gi;
  const timers: DetectedTimer[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const rawSpan = match[0];
    const numPart = match[1];
    const unitPart = match[2];
    if (!rawSpan || !numPart || !unitPart) continue;

    const unitLower = unitPart.toLowerCase();
    const splitParts = numPart.split(/[-to]/);
    const firstStr = splitParts[0]?.trim();
    if (!firstStr) continue;

    const firstNum = parseFloat(firstStr);
    if (isNaN(firstNum) || firstNum <= 0) continue;

    let seconds = 0;
    if (unitLower.startsWith('hour') || unitLower.startsWith('hr')) {
      seconds = Math.round(firstNum * 3600);
    } else if (unitLower.startsWith('min')) {
      seconds = Math.round(firstNum * 60);
    } else if (unitLower.startsWith('sec')) {
      seconds = Math.round(firstNum);
    }

    if (seconds > 0) {
      timers.push({
        label: rawSpan.trim(),
        seconds,
        match: rawSpan,
      });
    }
  }

  return timers;
}

