/**
 * Syncs all MongoDB recipes into the AI service's ChromaDB RAG index.
 * Called on server startup and after any recipe create/update/delete.
 */
import { Recipe } from '../models/Recipe';
import { ragIndex } from './aiClient';
import { logger } from '../config/logger';

async function attemptSync(retries = 5, delayMs = 5000): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      const recipes = await Recipe.find({}).lean();
      if (recipes.length === 0) {
        logger.warn('rag_sync_skipped: no recipes in MongoDB');
        return;
      }
      const payload = recipes.map((r) => ({
        id: String(r._id),
        title: r.title,
        cuisine: r.cuisine ?? '',
        ingredients: r.ingredients.map((ing) => ing.name),
        tags: r.tags ?? [],
        instructions: r.instructions ?? [],
      }));
      const result = await ragIndex(payload);
      logger.info({ indexed: result.indexed }, 'rag_sync_complete');
      return;
    } catch (err) {
      const isLast = i === retries - 1;
      if (isLast) {
        logger.error({ err }, 'rag_sync_failed after retries');
      } else {
        logger.warn(`rag_sync attempt ${i + 1} failed, retrying in ${delayMs}ms...`);
        await new Promise((res) => setTimeout(res, delayMs));
      }
    }
  }
}

export async function syncRecipesToRag(): Promise<void> {
  await attemptSync();
}
