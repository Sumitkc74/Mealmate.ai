import { describe, it, expect, vi } from 'vitest';
import * as XLSX from 'xlsx';
import {
  parseIngredientString,
  parseInstructionsString,
  parseRecipeSpreadsheet,
  downloadSampleCsvTemplate,
  downloadSampleExcelTemplate,
  SAMPLE_TEMPLATE_ROWS,
} from '../lib/recipeImportParser';

describe('recipeImportParser', () => {
  describe('parseIngredientString', () => {
    it('returns null for empty or whitespace-only string', () => {
      expect(parseIngredientString('')).toBeNull();
      expect(parseIngredientString('   ')).toBeNull();
    });

    it('parses quantity and common units', () => {
      const res1 = parseIngredientString('2 cups all-purpose flour');
      expect(res1).toEqual({
        name: 'all-purpose flour',
        quantity: 2,
        unit: 'cups',
      });

      const res2 = parseIngredientString('1 tbsp olive oil');
      expect(res2).toEqual({
        name: 'olive oil',
        quantity: 1,
        unit: 'tbsp',
      });

      const res3 = parseIngredientString('200 g chicken breast');
      expect(res3).toEqual({
        name: 'chicken breast',
        quantity: 200,
        unit: 'g',
      });
    });

    it('parses fractions and mixed fractions', () => {
      const resFrac = parseIngredientString('1/2 tsp kosher salt');
      expect(resFrac).toEqual({
        name: 'kosher salt',
        quantity: 0.5,
        unit: 'tsp',
      });

      const resMixed = parseIngredientString('1 1/2 cups whole milk');
      expect(resMixed).toEqual({
        name: 'whole milk',
        quantity: 1.5,
        unit: 'cups',
      });
    });

    it('parses count without standard unit', () => {
      const res = parseIngredientString('3 large eggs');
      expect(res).toEqual({
        name: 'large eggs',
        quantity: 3,
      });
    });

    it('handles ingredients without quantity or unit', () => {
      const res = parseIngredientString('fresh parsley for garnish');
      expect(res).toEqual({
        name: 'fresh parsley for garnish',
      });
    });
  });

  describe('parseInstructionsString', () => {
    it('returns empty array for empty string', () => {
      expect(parseInstructionsString('')).toEqual([]);
    });

    it('parses numbered steps on a single line or multiple lines', () => {
      const steps = parseInstructionsString(
        '1. Boil water in a large pot. 2. Add pasta and cook for 9 mins. 3. Drain and toss with olive oil.'
      );
      expect(steps).toEqual([
        'Boil water in a large pot.',
        'Add pasta and cook for 9 mins.',
        'Drain and toss with olive oil.',
      ]);
    });

    it('parses "Step 1:" format', () => {
      const steps = parseInstructionsString(
        'Step 1: Preheat oven to 400F. Step 2: Season salmon with salt and pepper. Step 3: Bake for 15 minutes.'
      );
      expect(steps).toEqual([
        'Preheat oven to 400F.',
        'Season salmon with salt and pepper.',
        'Bake for 15 minutes.',
      ]);
    });

    it('parses newline-separated instructions', () => {
      const steps = parseInstructionsString(
        'Heat pan with butter\nAdd diced onions and sauté until golden\nStir in garlic'
      );
      expect(steps).toEqual([
        'Heat pan with butter',
        'Add diced onions and sauté until golden',
        'Stir in garlic',
      ]);
    });

    it('parses semicolon-separated instructions', () => {
      const steps = parseInstructionsString('Mix dry ingredients; Whisk wet ingredients; Combine and bake');
      expect(steps).toEqual([
        'Mix dry ingredients',
        'Whisk wet ingredients',
        'Combine and bake',
      ]);
    });

    it('falls back to single instruction when no delimiters are found', () => {
      const steps = parseInstructionsString('Simply toss all ingredients in a bowl.');
      expect(steps).toEqual(['Simply toss all ingredients in a bowl.']);
    });
  });

  describe('parseRecipeSpreadsheet', () => {
    it('returns empty result when spreadsheet has no sheets or rows', () => {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([]);
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

      const result = parseRecipeSpreadsheet(buf);
      expect(result.totalRows).toBe(0);
      expect(result.validCount).toBe(0);
      expect(result.errorCount).toBe(0);
      expect(result.results).toHaveLength(0);
    });

    it('parses valid spreadsheet rows into recipes', () => {
      const wb = XLSX.utils.book_new();
      const data = [
        ['Title', 'Description', 'Cuisine', 'Difficulty', 'Prep Time (mins)', 'Cook Time (mins)', 'Servings', 'Ingredients', 'Instructions', 'Tags', 'Calories', 'Protein (g)', 'Carbs (g)', 'Fat (g)'],
        [
          'Garlic Butter Salmon',
          'Tender pan-seared salmon',
          'Seafood',
          'Easy',
          10,
          15,
          2,
          '2 salmon fillets; 2 tbsp butter; 3 cloves garlic, minced; 1 tbsp lemon juice',
          '1. Heat skillet over medium heat. 2. Melt butter and sauté garlic. 3. Sear salmon 4 mins per side. 4. Drizzle lemon juice and serve.',
          'keto, gluten-free, quick',
          420,
          38,
          3,
          28,
        ],
      ];
      const ws = XLSX.utils.aoa_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, 'Recipes');
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

      const result = parseRecipeSpreadsheet(buf);
      expect(result.totalRows).toBe(1);
      expect(result.validCount).toBe(1);
      expect(result.errorCount).toBe(0);

      const row = result.results[0]!;
      expect(row.isValid).toBe(true);
      expect(row.recipe).toBeDefined();
      expect(row.recipe?.title).toBe('Garlic Butter Salmon');
      expect(row.recipe?.cuisine).toBe('Seafood');
      expect(row.recipe?.difficulty).toBe('easy');
      expect(row.recipe?.prepTime).toBe(10);
      expect(row.recipe?.cookTime).toBe(15);
      expect(row.recipe?.servings).toBe(2);
      expect(row.recipe?.ingredients.length).toBeGreaterThanOrEqual(3);
      expect(row.recipe?.instructions).toHaveLength(4);
      expect(row.recipe?.tags).toEqual(['keto', 'gluten-free', 'quick']);
      expect(row.recipe?.nutrition).toEqual({
        calories: 420,
        protein: 38,
        carbs: 3,
        fat: 28,
      });
    });

    it('captures errors for invalid rows', () => {
      const wb = XLSX.utils.book_new();
      const data = [
        ['Title', 'Ingredients', 'Instructions'],
        ['', '1 cup rice', '1. Cook rice'], // missing title
        ['Mystery Soup', '', '1. Heat water'], // missing ingredients
        ['Dry Toast', '2 slices bread', ''], // missing instructions
      ];
      const ws = XLSX.utils.aoa_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, 'Invalid');
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

      const result = parseRecipeSpreadsheet(buf);
      expect(result.totalRows).toBe(3);
      expect(result.validCount).toBe(0);
      expect(result.errorCount).toBe(3);

      expect(result.results[0]!.errors).toContain('Missing recipe title');
      expect(result.results[1]!.errors).toContain('No valid ingredients found (must have at least 1)');
      expect(result.results[2]!.errors).toContain('No instructions found (must have at least 1 step)');
    });

    it('warns on unrecognized difficulty and defaults to medium', () => {
      const wb = XLSX.utils.book_new();
      const data = [
        ['Title', 'Difficulty', 'Ingredients', 'Instructions'],
        ['Simple Snack', 'Extreme', '1 apple', '1. Eat apple'],
      ];
      const ws = XLSX.utils.aoa_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, 'Warnings');
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

      const result = parseRecipeSpreadsheet(buf);
      expect(result.validCount).toBe(1);
      expect(result.results[0]!.recipe?.difficulty).toBe('medium');
      expect(result.results[0]!.warnings[0]).toContain('Unrecognized difficulty');
    });

    it('parses the default SAMPLE_TEMPLATE_ROWS cleanly', () => {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(SAMPLE_TEMPLATE_ROWS);
      XLSX.utils.book_append_sheet(wb, ws, 'Templates');
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

      const result = parseRecipeSpreadsheet(buf);
      expect(result.totalRows).toBe(3);
      expect(result.validCount).toBe(3);
      expect(result.errorCount).toBe(0);
      expect(result.results.every((r) => r.isValid)).toBe(true);
    });
  });

  describe('Sample templates downloaders', () => {
    it('executes downloadSampleCsvTemplate without throwing in DOM environment', () => {
      const clickMock = vi.fn();
      const appendMock = vi.spyOn(document.body, 'appendChild').mockImplementation(() => null as any);
      const removeMock = vi.spyOn(document.body, 'removeChild').mockImplementation(() => null as any);
      const createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue({
        set href(_val: string) {},
        set download(_val: string) {},
        click: clickMock,
      } as any);

      // URL mocks
      const createObjectURLMock = vi.fn().mockReturnValue('blob:mock-url');
      const revokeObjectURLMock = vi.fn();
      globalThis.URL.createObjectURL = createObjectURLMock;
      globalThis.URL.revokeObjectURL = revokeObjectURLMock;

      expect(() => downloadSampleCsvTemplate()).not.toThrow();
      expect(clickMock).toHaveBeenCalled();

      appendMock.mockRestore();
      removeMock.mockRestore();
      createElementSpy.mockRestore();
    });

    it('executes downloadSampleExcelTemplate without throwing', () => {
      const clickMock = vi.fn();
      const appendMock = vi.spyOn(document.body, 'appendChild').mockImplementation(() => null as any);
      const removeMock = vi.spyOn(document.body, 'removeChild').mockImplementation(() => null as any);
      const createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue({
        set href(_val: string) {},
        set download(_val: string) {},
        click: clickMock,
      } as any);

      const createObjectURLMock = vi.fn().mockReturnValue('blob:mock-url');
      const revokeObjectURLMock = vi.fn();
      globalThis.URL.createObjectURL = createObjectURLMock;
      globalThis.URL.revokeObjectURL = revokeObjectURLMock;

      expect(() => downloadSampleExcelTemplate()).not.toThrow();
      expect(clickMock).toHaveBeenCalled();

      appendMock.mockRestore();
      removeMock.mockRestore();
      createElementSpy.mockRestore();
    });
  });
});
