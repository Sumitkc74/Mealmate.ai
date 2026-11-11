import { describe, it, expect } from 'vitest';
import {
  formatQuantity,
  scaleQuantity,
  scaleRecipe,
  extractInstructionTimers,
} from '@/lib/recipeScaler';
import type { Recipe } from '@/types';

describe('recipeScaler utility', () => {
  describe('formatQuantity', () => {
    it('formats whole numbers cleanly', () => {
      expect(formatQuantity(2)).toBe('2');
      expect(formatQuantity(1)).toBe('1');
    });

    it('formats common culinary fractions', () => {
      expect(formatQuantity(0.5)).toBe('1/2');
      expect(formatQuantity(0.25)).toBe('1/4');
      expect(formatQuantity(0.33)).toBe('1/3');
      expect(formatQuantity(0.75)).toBe('3/4');
      expect(formatQuantity(1.5)).toBe('1 1/2');
      expect(formatQuantity(2.25)).toBe('2 1/4');
    });

    it('handles empty or invalid values gracefully', () => {
      expect(formatQuantity(null)).toBe('');
      expect(formatQuantity(undefined)).toBe('');
      expect(formatQuantity(0)).toBe('');
    });
  });

  describe('scaleQuantity & scaleRecipe', () => {
    it('scales quantities proportionally', () => {
      expect(scaleQuantity(2, 2, 4)).toBe(4);
      expect(scaleQuantity(1, 4, 2)).toBe(0.5);
    });

    it('scales full recipe object', () => {
      const mockRecipe: Recipe = {
        id: 'r1',
        slug: 'soup',
        title: 'Soup',
        tags: [],
        servings: 2,
        ingredients: [
          { name: 'Water', quantity: 2, unit: 'cups' },
          { name: 'Salt', unit: 'pinch' },
        ],
        instructions: ['Boil'],
        prepTime: 5,
        cookTime: 10,
        difficulty: 'easy',
      };

      const scaled = scaleRecipe(mockRecipe, 4);
      expect(scaled.servings).toBe(4);
      expect(scaled.ingredients[0]?.quantity).toBe(4);
      expect(scaled.ingredients[1]?.quantity).toBeUndefined();
    });
  });

  describe('extractInstructionTimers', () => {
    it('detects minutes, hours, and seconds from step text', () => {
      const step1 = 'Bake in preheated oven for 25 minutes until golden.';
      const timers1 = extractInstructionTimers(step1);
      expect(timers1).toHaveLength(1);
      expect(timers1[0]?.seconds).toBe(1500); // 25 * 60
      expect(timers1[0]?.label).toBe('25 minutes');

      const step2 = 'Simmer on low for 1.5 hours, then rest for 10 mins.';
      const timers2 = extractInstructionTimers(step2);
      expect(timers2).toHaveLength(2);
      expect(timers2[0]?.seconds).toBe(5400); // 1.5 * 3600
      expect(timers2[1]?.seconds).toBe(600); // 10 * 60
    });

    it('returns empty array when no duration is mentioned', () => {
      expect(extractInstructionTimers('Stir well and serve hot.')).toHaveLength(0);
    });
  });
});

