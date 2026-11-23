/**
 * One-off backfill: replace the broken image URLs on existing AI-generated
 * recipes with fresh ones from the AI service's now-fixed image lookup.
 *
 * Usage:  `npx tsx src/scripts/backfillAiImages.ts`  (from the server folder)
 *
 * Requires the AI service to be running locally (defaults to AI_SERVICE_URL
 * env var or http://127.0.0.1:8000). Idempotent: safe to re-run.
 *
 * Strategy:
 *   1. Find every Recipe with `source: 'ai-generated'`.
 *   2. Call the AI service's `/recipes/refresh-image` endpoint (added in
 *      this same change) to get a freshly computed image URL for the
 *      recipe's title.
 *   3. Update the doc if the URL changed.
 */
import 'dotenv/config';
import { connectDB, disconnectDB } from '../config/db';
import { logger } from '../config/logger';
import { Recipe } from '../models/Recipe';

const AI_SERVICE_URL = process.env.AI_SERVICE_URL ?? 'http://127.0.0.1:8000';
const AI_SERVICE_KEY = process.env.AI_SERVICE_KEY;

async function fetchFreshImage(title: string, cuisine?: string, ingredients?: string[]): Promise<string | null> {
  try {
    const resp = await fetch(`${AI_SERVICE_URL}/recipes/refresh-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(AI_SERVICE_KEY ? { 'X-AI-Service-Key': AI_SERVICE_KEY } : {}),
      },
      body: JSON.stringify({ title, cuisine, ingredients }),
    });
    if (!resp.ok) {
      logger.warn({ status: resp.status, title }, 'refresh-image upstream non-2xx');
      return null;
    }
    const data = (await resp.json()) as { image_url?: string | null };
    return data.image_url ?? null;
  } catch (err) {
    logger.warn({ err, title }, 'refresh-image call failed');
    return null;
  }
}

async function main() {
  await connectDB();
  const docs = await Recipe.find({ source: 'ai-generated' }).lean();
  logger.info({ count: docs.length }, 'backfill: found ai-generated recipes');

  let updated = 0;
  let skipped = 0;
  for (const doc of docs) {
    const title = doc.title;
    const cuisine = doc.cuisine;
    const ingredients = (doc.ingredients ?? []).map((i: { name: string }) => i.name);
    const fresh = await fetchFreshImage(title, cuisine, ingredients);
    if (!fresh) {
      logger.info({ id: doc._id, title }, 'backfill: no fresh URL, skipping');
      skipped += 1;
      continue;
    }
    if (fresh === doc.imageUrl) {
      logger.info({ id: doc._id, title }, 'backfill: URL unchanged, skipping');
      skipped += 1;
      continue;
    }
    await Recipe.updateOne({ _id: doc._id }, { $set: { imageUrl: fresh } });
    logger.info({ id: doc._id, title, before: doc.imageUrl, after: fresh }, 'backfill: updated image');
    updated += 1;
  }

  logger.info({ updated, skipped, total: docs.length }, 'backfill complete');
  await disconnectDB();
}

main().catch((err) => {
  logger.error({ err }, 'backfill script crashed');
  process.exit(1);
});
