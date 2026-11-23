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

/**
 * A user-supplied image URL. Accepts only https absolute URLs and
 * server-relative paths (the image cache serves `/static/recipe-images/...`).
 * Rejects `javascript:` / `data:` / `http:` — zod's `.url()` accepts
 * `javascript:` URLs, which would be a stored-XSS vector the moment an
 * image URL is ever rendered as a link, and a tracking-pixel / IP-logging
 * vector for every viewer while it is an <img>.
 */
const imageUrlSchema = z
  .string()
  .refine(
    (v) => {
      if (v.startsWith('/')) return !v.startsWith('//');
      try {
        return new URL(v).protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'imageUrl must be an https URL or a server-relative path' }
  )
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
  imageUrl: imageUrlSchema,
  source: z.string().trim().max(200).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
});

export const bulkCreateRecipeSchema = z.object({
  // Capped at 10: each recipe costs one Gemini verification call, so a
  // 100-recipe bulk import was a 100x quota amplifier for any free account.
  recipes: z.array(createRecipeSchema).min(1).max(10),
});

export type BulkCreateRecipeInput = z.infer<typeof bulkCreateRecipeSchema>;

// `source` is a server-assigned trust label ('user' / 'ai-generated' /
// 'seed'), not something an edit may change: omitting it here means a PATCH
// cannot forge it (the backfill used this exact path to set source 'user').
export const updateRecipeSchema = createRecipeSchema.omit({ source: true }).partial();

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

// Used for GET /:id only: a slug or old-style URL (e.g. /recipes/pho-mqa0sdys)
// is not a 24-hex ObjectId, but that is a "recipe not found", not a bad
// request — getRecipe turns a non-ObjectId into a 404 instead of a raw 400.
export const recipeIdOrSlugParamSchema = z.object({
  id: z.string().trim().min(1, 'Invalid recipe id'),
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

