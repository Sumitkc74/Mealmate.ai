import { z } from 'zod';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { protect } from '../middleware/authMiddleware';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { User } from '../models/User';
import { Recipe } from '../models/Recipe';
import {
  generateWeekPlan,
  getAssistantReply,
  getAssistantStream,
  getCapabilities,
  getKnowledgePairings,
  getKnowledgeSubstitutes,
  getRecipeFootprint,
  getRecommendations,
  getSimilarRecipes,
  listExperiments,
  agentChat,
  parsePantryImage,
  parsePantryText,
  recordInteractions,
  ragSuggest,
  ragQuery,
  type PlannerObjective,
  type RecommendStrategy,
} from '../services/aiClient';
import { applyChatActions } from '../services/chatActions';
import { logger } from '../config/logger';

const router = Router();

// Tiered rate limit on resource- and LLM-heavy AI endpoints to prevent cost spikes and compute exhaustion
const aiCostLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'AI generation quota reached. Please try again shortly.',
  },
});

const STRATEGIES = ['tfidf', 'lsa', 'collab', 'hybrid'] as const;
const OBJECTIVES = ['balanced', 'eco', 'budget', 'pantry'] as const;

const recommendSchema = z.object({
  ingredients: z.array(z.string().trim().min(1)).optional(),
  dietary_preferences: z.array(z.string().trim()).optional(),
  top_k: z.number().int().min(1).max(50).default(10),
  /** When true, fall back to the authenticated user's pantry if no ingredients provided. */
  usePantry: z.boolean().default(true),
  strategy: z.enum(STRATEGIES).default('hybrid'),
  liked_recipe_ids: z.array(z.string().trim().min(1)).max(50).optional(),
  scope: z.enum(['database', 'ai', 'all']).optional(),
});

router.post(
  '/recipes/recommend',
  protect,
  validate({ body: recommendSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw AppError.unauthorized();
    const { ingredients, dietary_preferences, top_k, usePantry, strategy, liked_recipe_ids, scope } =
      req.body as z.infer<typeof recommendSchema>;

    let ings = ingredients ?? [];
    let prefs = dietary_preferences;
    let allergies: string[] = [];

    // Single consolidated database query if user profile data is needed
    if ((ings.length === 0 && usePantry) || !prefs) {
      const user = await User.findById(req.user.sub);
      if (ings.length === 0 && usePantry) {
        ings = user?.pantry?.map((p) => p.ingredient) ?? [];
      }
      prefs = prefs ?? user?.dietaryPreferences ?? [];
      allergies = user?.allergies ?? [];
    }

    const hasPrefs = prefs && prefs.length > 0;
    const hasLikes = liked_recipe_ids && liked_recipe_ids.length > 0;

    // Fetch recipes currently present in MongoDB
    const dbFilter: Record<string, unknown> = {};
    if (allergies.length > 0) {
      dbFilter['ingredients.name'] = {
        $nin: allergies.map((a) => new RegExp(a, 'i')),
      };
    }
    const dbRecipes = await Recipe.find(dbFilter).lean();

    // ─── Scope: Database ───
    // Directly suggest recipes present in database by comparing user pantry and recipe ingredients list
    if (scope === 'database') {
      if (dbRecipes.length === 0) {
        res.json({
          success: true,
          count: 0,
          strategy: 'database',
          results: [],
        });
        return;
      }
      const topItems = rankDbRecipes(dbRecipes, ings, top_k);
      res.json({
        success: true,
        count: topItems.length,
        strategy: 'database',
        results: topItems,
      });
      return;
    }

    const dbPayload = dbRecipes.map((r) => ({
      id: r.slug || String(r._id),
      title: r.title,
      cuisine: r.cuisine ?? '',
      ingredients: (r.ingredients || []).map((i) => i.name),
      tags: r.tags ?? [],
      instructions: r.instructions ?? [],
    }));

    // If completely empty (no pantry items, no dietary preferences, no liked recipes),
    // deliver popular starter recipes from MongoDB rather than failing with 400.
    if (ings.length === 0 && !hasPrefs && !hasLikes && strategy !== 'collab') {
      if (dbRecipes.length > 0) {
        const starters = dbRecipes.slice(0, top_k);
        res.json({
          success: true,
          count: starters.length,
          strategy: 'starter',
          results: starters.map((d) => ({
            _id: String(d._id),
            recipe_id: d.slug || String(d._id),
            title: d.title,
            score: 0.85,
            matched_ingredients: [],
            reason: 'Popular recipe from your database',
            imageUrl: d.imageUrl,
            prepTime: d.prepTime,
            cookTime: d.cookTime,
            servings: d.servings,
            cuisine: d.cuisine,
            difficulty: d.difficulty,
            inDatabase: true,
          })),
        });
        return;
      }
    }

    const dbSlugs = new Set(dbRecipes.map((r) => r.slug).filter(Boolean));
    const dbIds = new Set(dbRecipes.map((r) => String(r._id)));
    const dbTitles = new Set(dbRecipes.map((r) => r.title.toLowerCase().trim()));
    const allDbExcludes = Array.from(new Set([...dbSlugs, ...dbIds]));

    try {
      // For AI generated recipes (scope: 'ai' or default), run the recommendation implemented previously:
      // Calls the AI microservice ML engine (TF-IDF + LSA + Collab hybrid)
      const result = await getRecommendations({
        ingredients: ings,
        dietary_preferences: prefs,
        allergies,
        top_k: scope === 'ai' ? Math.max(top_k + dbRecipes.length, 12) : top_k,
        strategy: strategy as RecommendStrategy,
        liked_recipe_ids,
        // When scope is 'ai', tell recommender to exclude items already present in database
        exclude_recipe_ids: scope === 'ai' && allDbExcludes.length > 0 ? allDbExcludes : undefined,
        // Only constrain to database recipes if scope is NOT 'ai'
        recipes: scope !== 'ai' && dbPayload.length > 0 ? dbPayload : undefined,
      });

      // When scope is 'ai', strictly filter out any recipe already present in the database (by slug, id, or title)
      if (scope === 'ai') {
        const newOnly = result.results
          .filter((r) => {
            if (dbSlugs.has(r.recipe_id)) return false;
            if (dbIds.has(r.recipe_id)) return false;
            if (dbTitles.has(r.title.toLowerCase().trim())) return false;
            return true;
          })
          .map((r) => ({
            ...r,
            inDatabase: false,
          }))
          .slice(0, top_k);

        res.json({
          ...result,
          count: newOnly.length,
          results: newOnly,
        });
        return;
      }

      const hydrated = await hydrateBySlug(result.results.map((r) => r.recipe_id));
      const hasDbRecipes = dbRecipes.length > 0;

      // Filter to database recipes only if scope !== 'ai' and recipes exist
      const filtered = hasDbRecipes
        ? result.results.filter((r) => hydrated.has(r.recipe_id))
        : result.results;

      const enriched = filtered.map((r) => {
        const item = hydrated.get(r.recipe_id);
        return {
          ...r,
          _id: item?._id,
          imageUrl: item?.imageUrl,
          prepTime: item?.prepTime,
          cookTime: item?.cookTime,
          servings: item?.servings,
          cuisine: item?.cuisine,
          difficulty: item?.difficulty,
          inDatabase: Boolean(item?._id),
        };
      });

      // If scope is not 'ai' and no DB matches found, fallback to database pantry comparison
      if (hasDbRecipes && enriched.length === 0) {
        const topItems = rankDbRecipes(dbRecipes, ings, top_k);
        res.json({
          success: true,
          count: topItems.length,
          strategy: 'database',
          results: topItems,
        });
        return;
      }

      res.json({ ...result, count: enriched.length, results: enriched });
    } catch {
      // Infallible fallback: If recipes exist in MongoDB, rank and return them
      // so users never see an AI outage error when database recipes are available.
      if (dbRecipes.length > 0) {
        const topItems = rankDbRecipes(dbRecipes, ings, top_k);
        res.json({
          success: true,
          count: topItems.length,
          strategy: 'database',
          results: topItems,
        });
        return;
      }
      throw new AppError('AI service unavailable', 503);
    }
  })
);

function normalizeIngredientName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[,\/()]/g, ' ')
    .replace(
      /\b(fresh|dried|chopped|diced|minced|sliced|cooked|raw|boneless|skinless|ground|cloves?|pinch|bunch|tbsp|tsp|cup|cups|oz|grams?|kg|ml|tablespoon|teaspoon|can|cans|package|packages)\b/g,
      ''
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function doesIngredientMatch(pantryItem: string, recipeItem: string): boolean {
  const pNorm = normalizeIngredientName(pantryItem);
  const rNorm = normalizeIngredientName(recipeItem);
  if (!pNorm || !rNorm) return false;

  // Exact or direct inclusion
  if (pNorm === rNorm || rNorm.includes(pNorm) || pNorm.includes(rNorm)) {
    return true;
  }

  // Plural / singular stem match (e.g., "tomatoes" and "tomato")
  const pStem = pNorm.replace(/e?s$/, '');
  const rStem = rNorm.replace(/e?s$/, '');
  if (pStem.length >= 3 && (pStem === rStem || rNorm.includes(pStem) || pNorm.includes(rStem))) {
    return true;
  }

  // Word token intersection
  const pWords = pNorm.split(' ').filter((w) => w.length >= 3);
  const rWords = rNorm.split(' ').filter((w) => w.length >= 3);
  return pWords.some((pw) => rWords.some((rw) => pw === rw || rw.startsWith(pw) || pw.startsWith(rw)));
}

function compareRecipeWithPantry(recipe: any, pantryIngredients: string[]) {
  const recipeIngs: string[] = (recipe.ingredients || [])
    .map((i: any) => (typeof i === 'string' ? i : i.name || '').trim())
    .filter((n: string) => n.length > 0);

  if (recipeIngs.length === 0) {
    return {
      matchedIngredients: [],
      missingIngredients: [],
      coverage: 0,
      score: 0.5,
      reason: 'In database recipe catalog',
    };
  }

  const matchedIngredients: string[] = [];
  const missingIngredients: string[] = [];

  for (const rIng of recipeIngs) {
    const isMatched = pantryIngredients.some((pItem) => doesIngredientMatch(pItem, rIng));
    if (isMatched) {
      matchedIngredients.push(rIng);
    } else {
      missingIngredients.push(rIng);
    }
  }

  const coverage = matchedIngredients.length / recipeIngs.length;
  const matchPct = Math.round(coverage * 100);
  const score = Math.max(
    0.2,
    Math.min(0.99, coverage * 0.85 + Math.min(0.14, matchedIngredients.length * 0.02) + 0.01)
  );

  let reason = '';
  if (matchedIngredients.length === recipeIngs.length) {
    reason = `All ${recipeIngs.length} ingredients are available in your pantry!`;
  } else if (matchedIngredients.length > 0) {
    const missingPreview = missingIngredients.slice(0, 2).join(', ');
    const moreCount = missingIngredients.length - 2;
    const moreSuffix = moreCount > 0 ? ` (+${moreCount} more)` : '';
    reason = `You have ${matchedIngredients.length} of ${recipeIngs.length} ingredients (${matchPct}%). Missing: ${missingPreview}${moreSuffix}`;
  } else {
    reason = `In database · 0 of ${recipeIngs.length} ingredients currently in pantry`;
  }

  return {
    matchedIngredients,
    missingIngredients,
    coverage,
    score: Number(score.toFixed(2)),
    reason,
  };
}

function rankDbRecipes(
  recipes: any[],
  pantryIngredients: string[],
  topK: number
) {
  const scored = recipes.map((r) => {
    const comparison = compareRecipeWithPantry(r, pantryIngredients);
    return {
      _id: String(r._id),
      recipe_id: r.slug || String(r._id),
      title: r.title,
      score: comparison.score,
      coverage: comparison.coverage,
      matched_ingredients: comparison.matchedIngredients,
      missing_ingredients: comparison.missingIngredients,
      total_ingredients: (r.ingredients || []).length,
      reason: comparison.reason,
      imageUrl: r.imageUrl,
      prepTime: r.prepTime,
      cookTime: r.cookTime,
      servings: r.servings,
      cuisine: r.cuisine,
      difficulty: r.difficulty,
      inDatabase: true,
    };
  });

  scored.sort((a, b) => {
    if (b.coverage !== a.coverage) {
      return b.coverage - a.coverage;
    }
    return b.matched_ingredients.length - a.matched_ingredients.length;
  });

  return scored.slice(0, topK);
}

const similarSchema = z.object({
  top_k: z.number().int().min(1).max(20).default(5),
  strategy: z.enum(STRATEGIES).default('tfidf'),
});

/**
 * Resolve recipe ids from the AI dataset back to their Mongo document.
 * Selects rich fields (images, times, servings) so client cards are fully functional.
 */
async function hydrateBySlug(recipeIds: string[]) {
  if (recipeIds.length === 0) return new Map<string, {
    _id: string;
    slug: string;
    imageUrl?: string;
    prepTime?: number;
    cookTime?: number;
    servings?: number;
    cuisine?: string;
    difficulty?: string;
  }>();

  const validObjectIds = recipeIds.filter((id) => /^[a-fA-F0-9]{24}$/.test(id));
  const docs = await Recipe.find({
    $or: [{ slug: { $in: recipeIds } }, { _id: { $in: validObjectIds } }],
  })
    .select('_id slug imageUrl prepTime cookTime servings cuisine difficulty')
    .lean();

  const map = new Map<string, {
    _id: string;
    slug: string;
    imageUrl?: string;
    prepTime?: number;
    cookTime?: number;
    servings?: number;
    cuisine?: string;
    difficulty?: string;
  }>();

  for (const d of docs) {
    const entry = {
      _id: String(d._id),
      slug: d.slug,
      imageUrl: d.imageUrl,
      prepTime: d.prepTime,
      cookTime: d.cookTime,
      servings: d.servings,
      cuisine: d.cuisine,
      difficulty: d.difficulty,
    };
    if (d.slug) map.set(d.slug, entry);
    map.set(String(d._id), entry);
  }

  return map;
}

router.post(
  '/recipes/:slug/similar',
  protect,
  validate({ body: similarSchema }),
  asyncHandler(async (req, res) => {
    const slug = req.params.slug;
    if (!slug) throw AppError.badRequest('Recipe slug is required');
    const { top_k, strategy } = req.body as z.infer<typeof similarSchema>;

    try {
      const result = await getSimilarRecipes(slug, top_k, strategy as RecommendStrategy);
      const hydrated = await hydrateBySlug(result.results.map((r) => r.recipe_id));
      // Attach Mongo _id and rich metadata when the recipe exists in Mongo.
      const enriched = result.results.map((r) => {
        const item = hydrated.get(r.recipe_id);
        return {
          ...r,
          _id: item?._id,
          imageUrl: item?.imageUrl,
          prepTime: item?.prepTime,
          cookTime: item?.cookTime,
          servings: item?.servings,
          cuisine: item?.cuisine,
          difficulty: item?.difficulty,
        };
      });
      res.json({ ...result, results: enriched });
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status === 404) throw AppError.notFound('Recipe not found in AI dataset');
      throw new AppError('AI service unavailable', 503);
    }
  })
);

const planWeekSchema = z.object({
  ingredients: z.array(z.string().trim()).optional(),
  dietary_preferences: z.array(z.string().trim()).optional(),
  allergies: z.array(z.string().trim()).optional(),
  use_llm: z.boolean().default(false),
  /** When true, fall back to the user's pantry / prefs / allergies. */
  useProfile: z.boolean().default(true),
  objective: z.enum(OBJECTIVES).default('balanced'),
  weights: z.record(z.string(), z.number().min(0)).optional(),
});

router.post(
  '/plan/week',
  protect,
  aiCostLimiter,
  validate({ body: planWeekSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw AppError.unauthorized();
    const body = req.body as z.infer<typeof planWeekSchema>;

    let ings = body.ingredients ?? [];
    let prefs = body.dietary_preferences ?? [];
    let allergies = body.allergies ?? [];

    if (body.useProfile) {
      const user = await User.findById(req.user.sub);
      if (ings.length === 0) ings = user?.pantry?.map((p) => p.ingredient) ?? [];
      if (prefs.length === 0) prefs = user?.dietaryPreferences ?? [];
      if (allergies.length === 0) allergies = user?.allergies ?? [];
    }

    try {
      const plan = await generateWeekPlan({
        ingredients: ings,
        dietary_preferences: prefs,
        allergies,
        use_llm: body.use_llm,
        objective: body.objective as PlannerObjective,
        weights: body.weights,
      });
      const allIds = plan.days.flatMap((d) => d.meals.map((m) => m.recipe_id));
      const hydrated = await hydrateBySlug(Array.from(new Set(allIds)));
      const enriched = {
        ...plan,
        days: plan.days.map((d) => ({
          ...d,
          meals: d.meals.map((m) => ({ ...m, _id: hydrated.get(m.recipe_id)?._id })),
        })),
      };
      res.json(enriched);
    } catch {
      throw new AppError('AI service unavailable', 503);
    }
  })
);

// ---------------------------------------------------------------------------
// Cooking-assistant chat
// ---------------------------------------------------------------------------

const chatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(4000),
      })
    )
    .min(1)
    .max(20),
  recipe_context: z.string().max(4000).optional(),
  /** When true, fold the user's pantry / prefs / allergies into the system prompt. */
  useProfile: z.boolean().default(true),
});

router.post(
  '/chat',
  protect,
  aiCostLimiter,
  validate({ body: chatSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw AppError.unauthorized();
    const body = req.body as z.infer<typeof chatSchema>;
    let pantry: string[] = [];
    let prefs: string[] = [];
    let allergies: string[] = [];
    if (body.useProfile) {
      const user = await User.findById(req.user.sub);
      pantry = user?.pantry?.map((p) => p.ingredient) ?? [];
      prefs = user?.dietaryPreferences ?? [];
      allergies = user?.allergies ?? [];
    }
    try {
      const result = await getAssistantReply({
        messages: body.messages,
        pantry,
        dietary_preferences: prefs,
        allergies,
        recipe_context: body.recipe_context,
      });
      // Apply any structured actions the assistant returned (e.g. add a
      // recipe to the user's weekly plan) and surface the resolved details
      // (calories, ingredients) so the client can render confirmation cards.
      // We pass the user's last message so chatActions can fall back to
      // parsing an explicit date (e.g. "june 4") if the LLM didn't fill
      // target_date — this prevents the recipe from landing on the wrong
      // week's Thursday when the LLM gets calendar math wrong.
      const lastUserMessage =
        [...body.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
      const appliedActions = await applyChatActions(
        req.user.sub,
        { dietaryPreferences: prefs, allergies },
        result.actions,
        lastUserMessage
      );
      res.json({ ...result, applied_actions: appliedActions });
    } catch {
      throw new AppError('AI service unavailable', 503);
    }
  })
);

router.post(
  '/chat/stream',
  protect,
  aiCostLimiter,
  validate({ body: chatSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw AppError.unauthorized();
    const userId = req.user.sub;
    const body = req.body as z.infer<typeof chatSchema>;
    let pantry: string[] = [];
    let prefs: string[] = [];
    let allergies: string[] = [];
    if (body.useProfile) {
      const user = await User.findById(userId);
      pantry = user?.pantry?.map((p) => p.ingredient) ?? [];
      prefs = user?.dietaryPreferences ?? [];
      allergies = user?.allergies ?? [];
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const lastUserMessage =
      [...body.messages].reverse().find((m) => m.role === 'user')?.content ?? '';

    try {
      const stream = await getAssistantStream({
        messages: body.messages,
        pantry,
        dietary_preferences: prefs,
        allergies,
        recipe_context: body.recipe_context,
      });

      let buffer = '';
      stream.on('data', async (chunk: Buffer) => {
        const text = chunk.toString();
        buffer += text;
        const lines = buffer.split('\n\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const parsed = JSON.parse(line.slice(6));
            if (parsed.type === 'done') {
              const appliedActions = await applyChatActions(
                userId,
                { dietaryPreferences: prefs, allergies },
                parsed.actions,
                lastUserMessage
              );
              res.write(
                `data: ${JSON.stringify({ ...parsed, applied_actions: appliedActions })}\n\n`
              );
              res.end();
              return;
            } else {
              res.write(`${line}\n\n`);
            }
          } catch {
            res.write(`${line}\n\n`);
          }
        }
      });

      stream.on('end', () => {
        if (!res.writableEnded) {
          res.end();
        }
      });

      stream.on('error', (err) => {
        logger.error({ err }, 'Streaming chat error');
        if (!res.writableEnded) {
          res.write(
            `data: ${JSON.stringify({ type: 'error', message: 'Stream error' })}\n\n`
          );
          res.end();
        }
      });
    } catch {
      res.write(
        `data: ${JSON.stringify({ type: 'error', message: 'AI service unavailable' })}\n\n`
      );
      res.end();
    }
  })
);

// ---------------------------------------------------------------------------
// Smart pantry parser
// ---------------------------------------------------------------------------

const parsePantrySchema = z.object({
  text: z.string().trim().min(1).max(2000),
});

router.post(
  '/pantry/parse',
  protect,
  validate({ body: parsePantrySchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw AppError.unauthorized();
    const { text } = req.body as z.infer<typeof parsePantrySchema>;
    try {
      const result = await parsePantryText(text);
      res.json(result);
    } catch {
      throw new AppError('AI service unavailable', 503);
    }
  })
);

// ---------------------------------------------------------------------------
// Capabilities — surfaces whether LLM features are wired up
// ---------------------------------------------------------------------------

router.get(
  '/capabilities',
  protect,
  asyncHandler(async (_req, res) => {
    const caps = await getCapabilities();
    res.json(caps);
  })
);

// ---------------------------------------------------------------------------
// Vision-based pantry capture (advanced feature)
// ---------------------------------------------------------------------------

const visionSchema = z.object({
  image_base64: z.string().min(40).max(10 * 1024 * 1024), // up to ~7 MB decoded
  hint: z.string().max(500).optional(),
});

router.post(
  '/pantry/vision',
  protect,
  aiCostLimiter,
  validate({ body: visionSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw AppError.unauthorized();
    const { image_base64, hint } = req.body as z.infer<typeof visionSchema>;
    try {
      const result = await parsePantryImage({ image_base64, hint });
      res.json(result);
    } catch {
      throw new AppError('AI service unavailable', 503);
    }
  })
);

// ---------------------------------------------------------------------------
// Sustainability footprint
// ---------------------------------------------------------------------------

router.get(
  '/recipes/:slug/footprint',
  protect,
  asyncHandler(async (req, res) => {
    const slug = req.params.slug;
    if (!slug) throw AppError.badRequest('Recipe slug is required');
    try {
      const result = await getRecipeFootprint(slug);
      res.json(result);
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status === 404) throw AppError.notFound('Recipe not found in AI dataset');
      throw new AppError('AI service unavailable', 503);
    }
  })
);

// ---------------------------------------------------------------------------
// Interaction recording (powers the collaborative model)
// ---------------------------------------------------------------------------

const interactionsSchema = z.object({
  recipe_ids: z.array(z.string().trim().min(1)).min(2).max(50),
});

router.post(
  '/interactions/record',
  protect,
  validate({ body: interactionsSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw AppError.unauthorized();
    const { recipe_ids } = req.body as z.infer<typeof interactionsSchema>;
    try {
      const result = await recordInteractions(recipe_ids);
      res.json(result);
    } catch {
      throw new AppError('AI service unavailable', 503);
    }
  })
);

// ---------------------------------------------------------------------------
// RAG recipe suggester
// ---------------------------------------------------------------------------

const ragSuggestSchema = z.object({
  pantry: z.array(z.string().trim()).optional(),
  dietary_preferences: z.array(z.string().trim()).optional(),
  allergies: z.array(z.string().trim()).optional(),
  top_k: z.number().int().min(1).max(20).default(5),
  useProfile: z.boolean().default(true),
});

router.post(
  '/rag/suggest',
  protect,
  aiCostLimiter,
  validate({ body: ragSuggestSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw AppError.unauthorized();
    const body = req.body as z.infer<typeof ragSuggestSchema>;

    let pantry = body.pantry ?? [];
    let prefs = body.dietary_preferences ?? [];
    let allergies = body.allergies ?? [];

    if (body.useProfile) {
      const user = await User.findById(req.user.sub);
      if (pantry.length === 0) pantry = user?.pantry?.map((p) => p.ingredient) ?? [];
      if (prefs.length === 0) prefs = user?.dietaryPreferences ?? [];
      if (allergies.length === 0) allergies = user?.allergies ?? [];
    }

    if (pantry.length === 0) {
      throw AppError.badRequest('Add pantry items before requesting suggestions');
    }

    try {
      const result = await ragSuggest({
        pantry,
        dietary_preferences: prefs,
        allergies,
        top_k: body.top_k,
      });
      res.json(result);
    } catch {
      throw new AppError('AI service unavailable', 503);
    }
  })
);

const ragQuerySchema = z.object({
  question: z.string().trim().min(1).max(500),
  top_k: z.number().int().min(1).max(10).default(5),
});

router.post(
  '/rag/query',
  protect,
  aiCostLimiter,
  validate({ body: ragQuerySchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw AppError.unauthorized();
    const { question, top_k } = req.body as z.infer<typeof ragQuerySchema>;
    try {
      const result = await ragQuery({ question, top_k });
      res.json(result);
    } catch {
      throw new AppError('AI service unavailable', 503);
    }
  })
);

// ---------------------------------------------------------------------------
// Culinary Knowledge Graph
// ---------------------------------------------------------------------------

const substitutesSchema = z.object({
  ingredient: z.string().trim().min(1).max(100),
  context: z.string().trim().optional(),
});

router.get(
  '/knowledge/substitutes',
  protect,
  validate({ query: substitutesSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw AppError.unauthorized();
    const { ingredient, context } = req.query as unknown as z.infer<typeof substitutesSchema>;
    try {
      const result = await getKnowledgeSubstitutes(ingredient, context);
      res.json(result);
    } catch {
      throw new AppError('AI service unavailable', 503);
    }
  })
);

const pairingsSchema = z.object({
  ingredient: z.string().trim().min(1).max(100),
});

router.get(
  '/knowledge/pairings',
  protect,
  validate({ query: pairingsSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw AppError.unauthorized();
    const { ingredient } = req.query as unknown as z.infer<typeof pairingsSchema>;
    try {
      const result = await getKnowledgePairings(ingredient);
      res.json(result);
    } catch {
      throw new AppError('AI service unavailable', 503);
    }
  })
);

// ---------------------------------------------------------------------------
// Autonomous Agentic Chat
// ---------------------------------------------------------------------------

const agentChatSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  history: z
    .array(
      z.object({
        role: z.string(),
        content: z.string(),
      })
    )
    .optional(),
  pantry: z.array(z.string().trim()).optional(),
  allergies: z.array(z.string().trim()).optional(),
});

router.post(
  '/agent/chat',
  protect,
  aiCostLimiter,
  validate({ body: agentChatSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw AppError.unauthorized();
    const body = req.body as z.infer<typeof agentChatSchema>;
    try {
      const result = await agentChat(body);
      res.json(result);
    } catch {
      throw new AppError('AI service unavailable', 503);
    }
  })
);

// ---------------------------------------------------------------------------
// A/B Experimentation
// ---------------------------------------------------------------------------

router.get(
  '/experiments',
  protect,
  asyncHandler(async (req, res) => {
    if (!req.user) throw AppError.unauthorized();
    try {
      const result = await listExperiments();
      res.json(result);
    } catch {
      throw new AppError('AI service unavailable', 503);
    }
  })
);

export default router;
