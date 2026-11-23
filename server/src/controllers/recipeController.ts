import { syncRecipesToRag } from '../services/ragSync';
import type { FilterQuery, SortOrder } from 'mongoose';
import { Types } from 'mongoose';
import { Recipe, COMMUNITY_OWNER_ID, type IRecipe } from '../models/Recipe';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import { User } from '../models/User';
import { generateRecipeWithRetry, saveGeneratedRecipe } from '../services/chatActions';
import { verifyRecipe, assertRecipeSafe, estimateNutrition, applyVerificationTag } from '../services/recipeVerifier';
import type { VerifyRecipeResponse } from '../services/aiClient';
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
  if (!Types.ObjectId.isValid(req.params.id)) {
    throw AppError.notFound('Recipe not found');
  }
  const recipe = await Recipe.findById(req.params.id);
  if (!recipe) throw AppError.notFound('Recipe not found');
  res.json({ success: true, recipe });
});

export const createRecipe = asyncHandler<unknown, unknown, CreateRecipeInput>(
  async (req, res) => {
    if (!req.user) throw AppError.unauthorized();
    const verification = await assertRecipeSafe(req.body);
    const recipe = await Recipe.create({
      ...req.body,
      tags: applyVerificationTag(req.body.tags, verification.verdict),
      source: 'user',
      aiReviewPending: verification.aiUnavailable === true,
      createdBy: req.user.sub,
    });
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

    const verifications: VerifyRecipeResponse[] = [];
    for (const r of recipes) {
      verifications.push(await assertRecipeSafe(r));
    }

    const createdRecipes = [];
    let i = 0;
    for (const r of recipes) {
      const verification = verifications[i];
      i++;
      const doc = await Recipe.create({
        ...r,
        tags: applyVerificationTag(r.tags, verification?.verdict),
        source: 'user',
        aiReviewPending: verification?.aiUnavailable === true,
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

    // Community recipes (createdBy is the community owner) may be edited by
    // any signed-in user; editing transfers ownership to the editor.
    // Deny by default: a recipe with no createdBy is NOT editable by anyone
    // (an absent owner must never mean "open to all").
    const isCommunity =
      recipe.createdBy && String(recipe.createdBy) === String(COMMUNITY_OWNER_ID);
    const isOwner = recipe.createdBy && String(recipe.createdBy) === req.user.sub;
    if (!isCommunity && !isOwner && req.user.role !== 'admin') {
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
    const verification = await assertRecipeSafe(candidate);

    Object.assign(recipe, req.body);
    if (isCommunity) {
      recipe.createdBy = new Types.ObjectId(req.user.sub);
    }
    // The AI has now reviewed this edit (or was unavailable again): the flag
    // reflects the latest check, so a successful AI review clears it.
    recipe.aiReviewPending = verification.aiUnavailable === true;
    recipe.tags = applyVerificationTag(recipe.tags, verification.verdict);
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

  // Community recipes belong to the shared library, so any signed-in user
  // may delete one; other recipes are owner-only. Deny by default: a recipe
  // with no createdBy is NOT deletable by anyone.
  const isCommunity =
    recipe.createdBy && String(recipe.createdBy) === String(COMMUNITY_OWNER_ID);
  const isOwner = recipe.createdBy && String(recipe.createdBy) === req.user.sub;
  if (!isCommunity && !isOwner && req.user.role !== 'admin') {
    throw AppError.forbidden('You may only delete your own recipes');
  }

  await recipe.deleteOne();
  res.json({ success: true, message: 'Recipe deleted' });
  void syncRecipesToRag();
});

/**
 * Re-verify recipes whose AI check was unavailable when they were published
 * (`aiReviewPending`). Runs the full AI verification on each pending recipe.
 * A verified result clears the needs-review tag; any other verdict keeps the
 * tag, because the AI has now reviewed it and found a real issue. If the AI
 * is still unavailable, the recipes stay pending. Returns a summary.
 */
export async function reverifyPendingRecipes(): Promise<{
  checked: number;
  cleared: number;
  stillPending: number;
}> {
  const pending = await Recipe.find({ aiReviewPending: true });
  let checked = 0;
  let cleared = 0;
  for (const recipe of pending) {
    let result: VerifyRecipeResponse;
    try {
      result = await verifyRecipe({
        title: recipe.title,
        description: recipe.description,
        cuisine: recipe.cuisine,
        ingredients: (recipe.ingredients || []).map((i) => ({
          name: i.name,
          quantity: i.quantity,
          unit: i.unit,
        })),
        instructions: recipe.instructions || [],
        prepTime: recipe.prepTime,
        cookTime: recipe.cookTime,
        servings: recipe.servings,
      });
    } catch {
      // Verification itself failed (not just the AI being down) — leave this
      // one pending and move on.
      continue;
    }
    if (result.aiUnavailable) {
      // AI still down — stop here; no point retrying the rest right now.
      break;
    }
    // The AI has now reviewed it: clear the pending flag either way, and let
    // the tag reflect the latest verdict.
    recipe.aiReviewPending = false;
    recipe.tags = applyVerificationTag(recipe.tags, result.verdict);
    await recipe.save();
    checked++;
    if (result.verdict === 'verified') cleared++;
  }
  const stillPending = await Recipe.countDocuments({ aiReviewPending: true });
  return { checked, cleared, stillPending };
}

export const reverifyPendingRecipesController = asyncHandler(async (_req, res) => {
  const summary = await reverifyPendingRecipes();
  res.json({ success: true, ...summary });
});
