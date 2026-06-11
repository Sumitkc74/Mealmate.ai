import { z } from 'zod';
import { Router } from 'express';
import { protect } from '../middleware/authMiddleware';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { User } from '../models/User';
import { Recipe } from '../models/Recipe';
import {
  generateWeekPlan,
  getAssistantReply,
  getCapabilities,
  getRecipeFootprint,
  getRecommendations,
  getSimilarRecipes,
  parsePantryImage,
  parsePantryText,
  recordInteractions,
  ragSuggest,
  ragQuery,
  type PlannerObjective,
  type RecommendStrategy,
} from '../services/aiClient';
import { applyChatActions } from '../services/chatActions';

const router = Router();

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
});

router.post(
  '/recipes/recommend',
  protect,
  validate({ body: recommendSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw AppError.unauthorized();
    const { ingredients, dietary_preferences, top_k, usePantry, strategy, liked_recipe_ids } =
      req.body as z.infer<typeof recommendSchema>;

    let ings = ingredients ?? [];
    if (ings.length === 0 && usePantry) {
      const user = await User.findById(req.user.sub);
      ings = user?.pantry?.map((p) => p.ingredient) ?? [];
    }
    if (ings.length === 0 && strategy !== 'collab') {
      throw AppError.badRequest(
        'Provide ingredients or add items to your pantry before requesting recommendations'
      );
    }

    let prefs = dietary_preferences;
    let allergies: string[] = [];
    if (!prefs || allergies.length === 0) {
      const user = await User.findById(req.user.sub);
      prefs = prefs ?? user?.dietaryPreferences ?? [];
      allergies = user?.allergies ?? [];
    }

    try {
      const result = await getRecommendations({
        ingredients: ings,
        dietary_preferences: prefs,
        allergies,
        top_k,
        strategy: strategy as RecommendStrategy,
        liked_recipe_ids,
      });
      res.json(result);
    } catch {
      throw new AppError('AI service unavailable', 503);
    }
  })
);

const similarSchema = z.object({
  top_k: z.number().int().min(1).max(20).default(5),
  strategy: z.enum(STRATEGIES).default('tfidf'),
});

/**
 * Resolve a recipe id from the AI dataset back to its Mongo document (if it
 * was seeded). Recipes seeded via `npm run seed` use the AI dataset's
 * `recipe_id` as their `slug`, so this is just a slug lookup.
 */
async function hydrateBySlug(recipeIds: string[]) {
  if (recipeIds.length === 0) return new Map<string, { _id: string; slug: string }>();
  const docs = await Recipe.find({ slug: { $in: recipeIds } })
    .select('_id slug')
    .lean();
  return new Map(docs.map((d) => [d.slug, { _id: String(d._id), slug: d.slug }]));
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
      // Attach Mongo _id when the recipe has been seeded so the client can link.
      const enriched = result.results.map((r) => ({
        ...r,
        _id: hydrated.get(r.recipe_id)?._id,
      }));
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

export default router;
