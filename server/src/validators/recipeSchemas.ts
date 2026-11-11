import { z } from 'zod';

const ingredientSchema = z.object({
  name: z.string().trim().min(1).max(100),
  quantity: z.number().nonnegative().optional(),
  unit: z.string().trim().max(20).optional(),
});

const nutritionSchema = z
  .object({
    calories: z.number().nonnegative().optional(),
    protein: z.number().nonnegative().optional(),
    carbs: z.number().nonnegative().optional(),
    fat: z.number().nonnegative().optional(),
    fiber: z.number().nonnegative().optional(),
    sugar: z.number().nonnegative().optional(),
    sodium: z.number().nonnegative().optional(),
  })
  .optional();

export const createRecipeSchema = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).optional(),
  ingredients: z.array(ingredientSchema).min(1),
  instructions: z.array(z.string().trim().min(1)).min(1),
  cuisine: z.string().trim().max(50).optional(),
  tags: z.array(z.string().trim().max(40)).default([]),
  prepTime: z.number().int().nonnegative().max(1440),
  cookTime: z.number().int().nonnegative().max(1440),
  servings: z.number().int().positive().max(100),
  nutrition: nutritionSchema,
  imageUrl: z.string().url().optional(),
  source: z.string().trim().max(200).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
});

export const bulkCreateRecipeSchema = z.object({
  recipes: z.array(createRecipeSchema).min(1).max(100),
});

export type BulkCreateRecipeInput = z.infer<typeof bulkCreateRecipeSchema>;

export const updateRecipeSchema = createRecipeSchema.partial();

export const listRecipesQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  cuisine: z.string().trim().toLowerCase().optional(),
  tag: z.string().trim().toLowerCase().optional(),
  maxPrepTime: z.coerce.number().int().nonnegative().optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sort: z.enum(['recent', 'fastest', 'relevance']).default('recent'),
});

export const recipeIdParamSchema = z.object({
  id: z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid recipe id'),
});

/**
 * Body for the AI-driven recipe generation endpoint. Used from the planner
 * picker ("Generate with AI" button) when the user types a dish that isn't
 * in their library.
 */
export const generateRecipeSchema = z.object({
  query: z.string().trim().min(2).max(200),
  dietaryPreferences: z.array(z.string().trim().toLowerCase().max(40)).max(20).optional(),
  allergies: z.array(z.string().trim().toLowerCase().max(40)).max(20).optional(),
  save: z.boolean().optional(),
});

export const verifyRecipeSchema = z.object({
  title: z.string().trim().max(200),
  description: z.string().trim().max(2000).optional(),
  cuisine: z.string().trim().max(50).optional(),
  ingredients: z.array(ingredientSchema).default([]),
  instructions: z.array(z.string().trim()).default([]),
  prepTime: z.number().int().nonnegative().optional(),
  cookTime: z.number().int().nonnegative().optional(),
  servings: z.number().int().positive().optional(),
});

export const estimateNutritionSchema = z.object({
  title: z.string().trim().max(200).optional(),
  ingredients: z.array(ingredientSchema).min(1),
  servings: z.number().int().positive().max(100).default(2),
});

export type CreateRecipeInput = z.infer<typeof createRecipeSchema>;
export type UpdateRecipeInput = z.infer<typeof updateRecipeSchema>;
export type ListRecipesQuery = z.infer<typeof listRecipesQuerySchema>;
export type GenerateRecipeInput = z.infer<typeof generateRecipeSchema>;
export type VerifyRecipeInput = z.infer<typeof verifyRecipeSchema>;
export type EstimateNutritionSchemaInput = z.infer<typeof estimateNutritionSchema>;

