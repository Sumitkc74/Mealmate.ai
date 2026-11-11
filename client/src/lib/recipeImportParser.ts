import * as XLSX from 'xlsx';

export interface ParsedIngredient {
  name: string;
  quantity?: number;
  unit?: string;
}

export interface ParsedNutrition {
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  sodium?: number;
}

export interface ParsedRecipe {
  title: string;
  description?: string;
  cuisine?: string;
  difficulty: 'easy' | 'medium' | 'hard';
  prepTime: number;
  cookTime: number;
  servings: number;
  ingredients: ParsedIngredient[];
  instructions: string[];
  tags: string[];
  nutrition?: ParsedNutrition;
}

export interface RecipeImportRowResult {
  rowNumber: number;
  rawTitle: string;
  recipe: ParsedRecipe | null;
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface RecipeImportParseResult {
  totalRows: number;
  validCount: number;
  errorCount: number;
  results: RecipeImportRowResult[];
}

/** Parse common fractions (e.g. "1/2", "1 1/2", "0.5") into decimal */
function parseFractionOrNumber(str: string): number | undefined {
  if (!str) return undefined;
  const clean = str.trim();
  if (clean.includes(' ')) {
    const [whole, frac] = clean.split(' ');
    const wholeNum = parseFloat(whole || '0');
    if (frac && frac.includes('/')) {
      const [num, den] = frac.split('/');
      const fracNum = (parseFloat(num || '0') / parseFloat(den || '1')) || 0;
      return wholeNum + fracNum;
    }
  } else if (clean.includes('/')) {
    const [num, den] = clean.split('/');
    const val = (parseFloat(num || '0') / parseFloat(den || '1'));
    return isNaN(val) ? undefined : val;
  }
  const val = parseFloat(clean);
  return isNaN(val) ? undefined : val;
}

const COMMON_UNITS = new Set([
  'cup', 'cups', 'tbsp', 'tablespoon', 'tablespoons', 'tsp', 'teaspoon', 'teaspoons',
  'g', 'gram', 'grams', 'kg', 'kilogram', 'kilograms', 'oz', 'ounce', 'ounces',
  'lb', 'lbs', 'pound', 'pounds', 'ml', 'milliliter', 'l', 'liter', 'liters',
  'clove', 'cloves', 'slice', 'slices', 'piece', 'pieces', 'pcs', 'pinch', 'can', 'cans',
  'bunch', 'sprig', 'sprigs', 'packet', 'stalk', 'stalks', 'head'
]);

/** Parse an ingredient string into { name, quantity, unit } */
export function parseIngredientString(raw: string): ParsedIngredient | null {
  const clean = raw.trim();
  if (!clean) return null;

  // Pattern: "2 cups all-purpose flour" or "1/2 tsp salt" or "3 eggs" or "olive oil"
  const match = clean.match(/^([\d\s/.,]+)?\s*([a-zA-Z]+)?\s+(.+)$/);
  if (match) {
    const rawQty = match[1]?.trim();
    const rawUnitOrWord = match[2]?.trim().toLowerCase();
    const rest = match[3]?.trim();

    const qty = rawQty ? parseFractionOrNumber(rawQty) : undefined;

    if (rawUnitOrWord && COMMON_UNITS.has(rawUnitOrWord)) {
      return {
        name: rest || clean,
        quantity: qty,
        unit: rawUnitOrWord,
      };
    } else if (rawUnitOrWord && !COMMON_UNITS.has(rawUnitOrWord) && qty !== undefined) {
      // e.g. "3 large eggs" -> qty 3, name: "large eggs"
      return {
        name: `${rawUnitOrWord} ${rest}`.trim(),
        quantity: qty,
      };
    }
  }

  // Fallback: check if starts with a number
  const numMatch = clean.match(/^([\d\s/.,]+)\s+(.+)$/);
  if (numMatch) {
    const qty = parseFractionOrNumber(numMatch[1]?.trim() || '');
    return {
      name: numMatch[2]?.trim() || clean,
      quantity: qty,
    };
  }

  return { name: clean };
}

/** Parse instructions string split by newlines, semicolons, or numbered steps */
export function parseInstructionsString(raw: string): string[] {
  if (!raw) return [];
  const clean = String(raw).trim();

  // If contains numbered steps: e.g. "1. Step one 2. Step two" or "Step 1: ... Step 2: ..."
  if (/(?:^|\s)(?:\d+\.|\bstep\s*\d+:?)/i.test(clean)) {
    const steps = clean
      .split(/(?:^|\s)(?:\d+\.|\bstep\s*\d+:?)\s*/i)
      .map((s) => s.trim())
      .filter(Boolean);
    if (steps.length > 0) return steps;
  }

  // If contains newlines
  if (clean.includes('\n')) {
    const lines = clean
      .split('\n')
      .map((s) => s.replace(/^\d+[\s.)-]+\s*/, '').trim())
      .filter(Boolean);
    if (lines.length > 0) return lines;
  }

  // If contains semicolons
  if (clean.includes(';')) {
    const steps = clean
      .split(';')
      .map((s) => s.replace(/^\d+[\s.)-]+\s*/, '').trim())
      .filter(Boolean);
    if (steps.length > 0) return steps;
  }

  return [clean];
}

/** Parse an entire CSV or Excel file buffer */
export function parseRecipeSpreadsheet(buffer: ArrayBuffer): RecipeImportParseResult {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return { totalRows: 0, validCount: 0, errorCount: 0, results: [] };
  }

  const sheet = workbook.Sheets[firstSheetName];
  if (!sheet) {
    return { totalRows: 0, validCount: 0, errorCount: 0, results: [] };
  }

  // Convert to array of row arrays
  const rawRows: (string | number | undefined)[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
  });

  if (rawRows.length === 0) {
    return { totalRows: 0, validCount: 0, errorCount: 0, results: [] };
  }

  // Identify column headers from first row
  const headerRow = (rawRows[0] || []).map((h) => String(h || '').trim().toLowerCase());

  const colMap = {
    title: headerRow.findIndex((h) => h === 'title' || h === 'recipe' || h === 'name' || h === 'recipe name'),
    description: headerRow.findIndex((h) => h.includes('desc') || h.includes('summary')),
    cuisine: headerRow.findIndex((h) => h.includes('cuisine') || h === 'style'),
    difficulty: headerRow.findIndex((h) => h.includes('diff') || h === 'level'),
    prepTime: headerRow.findIndex((h) => h.includes('prep')),
    cookTime: headerRow.findIndex((h) => h.includes('cook')),
    servings: headerRow.findIndex((h) => h.includes('serv') || h.includes('yield')),
    ingredients: headerRow.findIndex((h) => h.includes('ingredient')),
    instructions: headerRow.findIndex((h) => h.includes('instruct') || h.includes('step') || h.includes('method') || h.includes('direction')),
    tags: headerRow.findIndex((h) => h.includes('tag') || h.includes('categor')),
    calories: headerRow.findIndex((h) => h.includes('calor') || h === 'kcal'),
    protein: headerRow.findIndex((h) => h.includes('protein')),
    carbs: headerRow.findIndex((h) => h.includes('carb')),
    fat: headerRow.findIndex((h) => h.includes('fat')),
  };

  const results: RecipeImportRowResult[] = [];

  // Iterate rows (skip header row index 0)
  for (let r = 1; r < rawRows.length; r++) {
    const row = rawRows[r];
    if (!row || row.every((c) => String(c || '').trim() === '')) {
      continue; // skip completely empty rows
    }

    const errors: string[] = [];
    const warnings: string[] = [];

    const getVal = (colIdx: number): string => (colIdx >= 0 && row[colIdx] !== undefined ? String(row[colIdx]).trim() : '');
    const getNum = (colIdx: number): number | undefined => {
      if (colIdx < 0) return undefined;
      const str = getVal(colIdx).replace(/[^\d.]/g, '');
      const parsed = parseFloat(str);
      return isNaN(parsed) ? undefined : parsed;
    };

    const title = getVal(colMap.title);
    if (!title) {
      errors.push('Missing recipe title');
    }

    // Ingredients
    const ingredientsRaw = getVal(colMap.ingredients);
    const rawIngList = ingredientsRaw
      ? ingredientsRaw.split(/[;\n]/).map((s) => s.trim()).filter(Boolean)
      : [];
    const ingredients: ParsedIngredient[] = rawIngList
      .map((item) => parseIngredientString(item))
      .filter((i): i is ParsedIngredient => i !== null && Boolean(i.name));

    if (ingredients.length === 0) {
      errors.push('No valid ingredients found (must have at least 1)');
    }

    // Instructions
    const instructionsRaw = getVal(colMap.instructions);
    const instructions = parseInstructionsString(instructionsRaw);
    if (instructions.length === 0) {
      errors.push('No instructions found (must have at least 1 step)');
    }

    // Difficulty
    let difficulty: 'easy' | 'medium' | 'hard' = 'medium';
    const diffRaw = getVal(colMap.difficulty).toLowerCase();
    if (diffRaw.includes('easy') || diffRaw === '1') difficulty = 'easy';
    else if (diffRaw.includes('hard') || diffRaw.includes('difficult') || diffRaw === '3') difficulty = 'hard';
    else if (diffRaw.includes('med') || diffRaw === '2') difficulty = 'medium';
    else if (diffRaw) {
      warnings.push(`Unrecognized difficulty "${diffRaw}", defaulted to "medium"`);
    }

    // Timing & Servings
    const prepTime = getNum(colMap.prepTime) ?? 15;
    const cookTime = getNum(colMap.cookTime) ?? 20;
    const servings = Math.max(1, Math.round(getNum(colMap.servings) ?? 4));

    // Tags
    const tagsRaw = getVal(colMap.tags);
    const tags = tagsRaw
      ? tagsRaw
          .split(/[,;]/)
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean)
      : [];

    // Nutrition
    const calories = getNum(colMap.calories);
    const protein = getNum(colMap.protein);
    const carbs = getNum(colMap.carbs);
    const fat = getNum(colMap.fat);

    let nutrition: ParsedNutrition | undefined = undefined;
    if (calories !== undefined || protein !== undefined || carbs !== undefined || fat !== undefined) {
      nutrition = { calories, protein, carbs, fat };
    }

    const isValid = errors.length === 0;

    const recipe: ParsedRecipe | null = isValid
      ? {
          title,
          description: getVal(colMap.description) || undefined,
          cuisine: getVal(colMap.cuisine) || undefined,
          difficulty,
          prepTime,
          cookTime,
          servings,
          ingredients,
          instructions,
          tags,
          nutrition,
        }
      : null;

    results.push({
      rowNumber: r + 1,
      rawTitle: title || `Row ${r + 1}`,
      recipe,
      isValid,
      errors,
      warnings,
    });
  }

  const validCount = results.filter((r) => r.isValid).length;
  const errorCount = results.filter((r) => !r.isValid).length;

  return {
    totalRows: results.length,
    validCount,
    errorCount,
    results,
  };
}

export const SAMPLE_TEMPLATE_ROWS = [
  [
    'Title',
    'Description',
    'Cuisine',
    'Difficulty',
    'Prep Time',
    'Cook Time',
    'Servings',
    'Ingredients',
    'Instructions',
    'Tags',
    'Calories',
    'Protein',
    'Carbs',
    'Fat',
  ],
  [
    'Classic Margherita Pizza',
    'Authentic Neapolitan pizza with fresh mozzarella and basil leaves.',
    'Italian',
    'medium',
    '20',
    '15',
    '3',
    '250 g pizza dough; 100 g tomato sauce; 150 g fresh mozzarella; 2 tbsp olive oil; 6 fresh basil leaves',
    '1. Preheat oven to 450°F (230°C).\n2. Stretch dough into a 12-inch round.\n3. Spread tomato sauce evenly and top with mozzarella.\n4. Bake for 12-15 minutes until crust is golden.\n5. Garnish with fresh basil and drizzle with olive oil.',
    'dinner, vegetarian, italian',
    '650',
    '24',
    '78',
    '26',
  ],
  [
    'Lemon Herb Grilled Chicken',
    'Juicy chicken breast marinated with fresh rosemary, thyme, garlic, and lemon.',
    'Mediterranean',
    'easy',
    '15',
    '18',
    '4',
    '600 g chicken breast; 2 tbsp olive oil; 1 lemon (juiced); 3 cloves garlic; 1 tsp dried oregano; 0.5 tsp salt',
    '1. Whisk lemon juice, olive oil, garlic, oregano, and salt in a bowl.\n2. Coat chicken breasts and marinate for 15 minutes.\n3. Preheat grill or grill pan to medium-high.\n4. Grill chicken for 6-8 minutes per side until cooked through.\n5. Rest for 5 minutes before slicing.',
    'dinner, high-protein, gluten-free, healthy',
    '320',
    '44',
    '3',
    '14',
  ],
  [
    'Berry Avocado Smoothie Bowl',
    'Creamy nutrient-dense breakfast bowl loaded with antioxidants and healthy fats.',
    'American',
    'easy',
    '10',
    '0',
    '2',
    '1 frozen banana; 150 g mixed berries; 0.5 avocado; 200 ml almond milk; 1 tbsp chia seeds',
    '1. Add banana, berries, avocado, and almond milk to a blender.\n2. Blend on high until thick and smooth.\n3. Pour into bowls and top with chia seeds, fresh berries, and granola.',
    'breakfast, vegan, quick, high-fiber',
    '280',
    '5',
    '38',
    '15',
  ],
];

export function downloadSampleCsvTemplate(): void {
  const csvContent = SAMPLE_TEMPLATE_ROWS.map((row) =>
    row
      .map((cell) => {
        const val = String(cell);
        if (val.includes(',') || val.includes('\n') || val.includes('"')) {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return val;
      })
      .join(',')
  ).join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'mealmate_recipe_import_template.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadSampleExcelTemplate(): void {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(SAMPLE_TEMPLATE_ROWS);

  // Set column widths for readability
  ws['!cols'] = [
    { wch: 28 }, // Title
    { wch: 40 }, // Description
    { wch: 14 }, // Cuisine
    { wch: 12 }, // Difficulty
    { wch: 10 }, // Prep Time
    { wch: 10 }, // Cook Time
    { wch: 10 }, // Servings
    { wch: 50 }, // Ingredients
    { wch: 50 }, // Instructions
    { wch: 30 }, // Tags
    { wch: 10 }, // Calories
    { wch: 10 }, // Protein
    { wch: 10 }, // Carbs
    { wch: 10 }, // Fat
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Recipes Template');
  const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([excelBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'mealmate_recipe_import_template.xlsx';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
