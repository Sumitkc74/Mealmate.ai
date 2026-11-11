import { syncRecipesToRag } from '../services/ragSync';
import type { FilterQuery, SortOrder } from 'mongoose';
import { Recipe, type IRecipe } from '../models/Recipe';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import { User } from '../models/User';
import { generateRecipeWithRetry, saveGeneratedRecipe } from '../services/chatActions';
import { verifyRecipe, assertRecipeSafe, estimateNutrition } from '../services/recipeVerifier';
import type {
  CreateRecipeInput,
  UpdateRecipeInput,
  ListRecipesQuery,
  GenerateRecipeInput,
  BulkCreateRecipeInput,
  VerifyRecipeInput,
  EstimateNutritionSchemaInput,
} from '../validators/recipeSchemas';

export const listRecipes = asyncHandler(async (req, res) => {
    const { q, cuisine, tag, maxPrepTime, difficulty, page, limit, sort } =
      req.query as unknown as ListRecipesQuery;

    const filter: FilterQuery<IRecipe> = {};
    if (cuisine) filter.cuisine = cuisine;
    if (tag) filter.tags = tag;
    if (typeof maxPrepTime === 'number') filter.prepTime = { $lte: maxPrepTime };
    if (difficulty) filter.difficulty = difficulty;

    let sortSpec: Record<string, SortOrder> | { score: { $meta: 'textScore' } } = { createdAt: -1 };
    let projection: Record<string, unknown> | undefined;

    if (q) {
      filter.$text = { $search: q };
      // Default to relevance ranking whenever the user supplied a query
      if (sort === 'relevance' || sort === 'recent') {
        projection = { score: { $meta: 'textScore' } };
        sortSpec = { score: { $meta: 'textScore' } };
      }
    }

    if (sort === 'fastest') sortSpec = { prepTime: 1, cookTime: 1 };

    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      Recipe.find(filter, projection).sort(sortSpec as never).skip(skip).limit(limit).lean(),
      Recipe.countDocuments(filter),
    ]);

    res.json({
      success: true,
      page,
      limit,
      total,
      pages: Math.ceil(total / limit) || 1,
      items,
    });
  });

export const getRecipe = asyncHandler<{ id: string }>(async (req, res) => {
  const recipe = await Recipe.findById(req.params.id);
  if (!recipe) throw AppError.notFound('Recipe not found');
  res.json({ success: true, recipe });
});

export const createRecipe = asyncHandler<unknown, unknown, CreateRecipeInput>(
  async (req, res) => {
    if (!req.user) throw AppError.unauthorized();
    await assertRecipeSafe(req.body);
    const recipe = await Recipe.create({ ...req.body, createdBy: req.user.sub });
    res.status(201).json({ success: true, recipe });
  }
);

export const bulkCreateRecipes = asyncHandler<unknown, unknown, BulkCreateRecipeInput>(
  async (req, res) => {
    if (!req.user) throw AppError.unauthorized();
    const { recipes } = req.body;
    if (!Array.isArray(recipes) || recipes.length === 0) {
      throw AppError.badRequest('No recipes provided for bulk import');
    }

    for (const r of recipes) {
      await assertRecipeSafe(r);
    }

    const createdRecipes = [];
    for (const r of recipes) {
      const doc = await Recipe.create({
        ...r,
        source: 'user',
        createdBy: req.user.sub,
      });
      createdRecipes.push(doc);
    }

    res.status(201).json({
      success: true,
      count: createdRecipes.length,
      recipes: createdRecipes,
    });
  }
);

/**
 * AI-driven recipe generation endpoint.
 *
 * Used by the planner's recipe picker (and any future "create with AI"
 * UI). The flow is:
 *   1. Call the Python AI service via `generateRecipeWithRetry` (which
 *      transparently retries once with a simplified query if the model
 *      chokes on a compound request like "X and Y").
 *   2. Persist the recipe via the same `saveGeneratedRecipe` helper used
 *      by the chat-driven add-to-plan flow, so the result is a real
 *      MongoDB document with `source: 'ai-generated'`.
 *   3. Honour the user's stored dietary preferences + allergies unless
 *      the caller overrides them.
 */
export const generateRecipe = asyncHandler<unknown, unknown, GenerateRecipeInput>(
  async (req, res) => {
    if (!req.user) throw AppError.unauthorized();
    const { query, dietaryPreferences, allergies } = req.body;

    // Pull stored prefs/allergies if the client didn't supply them.
    let dietary = dietaryPreferences;
    let allergyList = allergies;
    if (!dietary || !allergyList) {
      const user = await User.findById(req.user.sub).select('dietaryPreferences allergies').lean();
      if (!dietary) dietary = user?.dietaryPreferences ?? [];
      if (!allergyList) allergyList = user?.allergies ?? [];
    }

    const { result, usedQuery } = await generateRecipeWithRetry(query, {
      dietary_preferences: dietary,
      allergies: allergyList,
    });

    if (!result.success || !result.recipe) {
      throw AppError.badGateway(
        result.message ||
          'The AI couldn\'t generate that recipe right now. Try a more specific name.'
      );
    }

    if (req.body.save === false) {
      const draft = {
        title: result.recipe.title.trim().slice(0, 200),
        description: (result.recipe.description ?? '').slice(0, 2000),
        cuisine: result.recipe.cuisine ? String(result.recipe.cuisine).toLowerCase().trim().slice(0, 50) : undefined,
        tags: (result.recipe.tags ?? []).map((t) => String(t).toLowerCase()).slice(0, 20),
        ingredients: (result.recipe.ingredients ?? []).map((i) => ({
          name: String(i.name ?? '').toLowerCase().trim().slice(0, 100),
          quantity: typeof i.quantity === 'number' && i.quantity >= 0 ? i.quantity : undefined,
          unit: i.unit ? String(i.unit).toLowerCase().trim().slice(0, 20) : undefined,
        })),
        instructions: (result.recipe.instructions ?? []).map((s) => String(s)).filter(Boolean),
        prepTime: Math.max(0, Math.min(1440, Math.trunc(result.recipe.prep_time ?? 15))),
        cookTime: Math.max(0, Math.min(1440, Math.trunc(result.recipe.cook_time ?? 20))),
        servings: Math.max(1, Math.min(100, Math.trunc(result.recipe.servings ?? 2))),
        difficulty: result.recipe.difficulty ?? 'medium',
        nutrition: {
          calories: result.recipe.nutrition?.calories ?? undefined,
          protein: result.recipe.nutrition?.protein ?? undefined,
          carbs: result.recipe.nutrition?.carbs ?? undefined,
          fat: result.recipe.nutrition?.fat ?? undefined,
        },
        imageUrl: result.recipe.image_url ?? undefined,
        source: 'ai-generated',
      };

      res.status(200).json({
        success: true,
        recipe: draft,
        usedQuery,
        generated: true,
        saved: false,
      });
      return;
    }

    const saved = await saveGeneratedRecipe(req.user.sub, result.recipe, query);
    if (!saved) {
      throw AppError.badGateway('Generated recipe failed validation — please try a different name.');
    }

    res.status(201).json({
      success: true,
      recipe: saved,
      usedQuery,
      generated: true,
      saved: true,
    });
    void syncRecipesToRag();
  }
);

export const updateRecipe = asyncHandler<{ id: string }, unknown, UpdateRecipeInput>(
  async (req, res) => {
    if (!req.user) throw AppError.unauthorized();
    const recipe = await Recipe.findById(req.params.id);
    if (!recipe) throw AppError.notFound('Recipe not found');

    if (
      recipe.createdBy &&
      String(recipe.createdBy) !== req.user.sub &&
      req.user.role !== 'admin'
    ) {
      throw AppError.forbidden('You may only edit your own recipes');
    }

    const candidate = {
      title: req.body.title ?? recipe.title,
      description: req.body.description ?? recipe.description,
      cuisine: req.body.cuisine ?? recipe.cuisine,
      ingredients: (req.body.ingredients ?? recipe.ingredients) as Array<{ name: string; quantity?: number; unit?: string }>,
      instructions: req.body.instructions ?? recipe.instructions,
      prepTime: req.body.prepTime ?? recipe.prepTime,
      cookTime: req.body.cookTime ?? recipe.cookTime,
      servings: req.body.servings ?? recipe.servings,
    };
    await assertRecipeSafe(candidate);

    Object.assign(recipe, req.body);
    await recipe.save();
    res.json({ success: true, recipe });
    void syncRecipesToRag();
  }
);

export const verifyRecipeController = asyncHandler<unknown, unknown, VerifyRecipeInput>(
  async (req, res) => {
    const result = await verifyRecipe(req.body);
    res.json(result);
  }
);

export const estimateNutritionController = asyncHandler<unknown, unknown, EstimateNutritionSchemaInput>(
  async (req, res) => {
    const result = await estimateNutrition(req.body);
    res.json(result);
  }
);

export const deleteRecipe = asyncHandler<{ id: string }>(async (req, res) => {
  if (!req.user) throw AppError.unauthorized();
  const recipe = await Recipe.findById(req.params.id);
  if (!recipe) throw AppError.notFound('Recipe not found');

  if (
    recipe.createdBy &&
    String(recipe.createdBy) !== req.user.sub &&
    req.user.role !== 'admin'
  ) {
    throw AppError.forbidden('You may only delete your own recipes');
  }

  await recipe.deleteOne();
  res.json({ success: true, message: 'Recipe deleted' });
  void syncRecipesToRag();
});
