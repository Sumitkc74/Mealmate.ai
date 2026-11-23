import rateLimit from 'express-rate-limit';

/**
 * Tiered rate limit on resource- and LLM-heavy AI endpoints to prevent cost
 * spikes and compute exhaustion. Shared by aiRoutes (chat, RAG, plan, ...)
 * and recipeRoutes (verify, generate, bulk, ...), so a single account cannot
 * burn the Gemini quota through any one of them.
 */
export const aiCostLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'AI generation quota reached. Please try again shortly.',
  },
});
