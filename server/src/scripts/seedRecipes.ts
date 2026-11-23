/**
 * Seed MongoDB with the bundled recipe dataset that the AI recommender ships with.
 *
 * Usage: `npm run seed` from the server folder. Requires `MONGO_URI` in env.
 *
 * - Reads `mealmate/ai-service/data/recipes.json` so the server and AI service
 *   stay in sync.
 * - Idempotent: upserts by `slug` so re-running adds new recipes / updates
 *   existing ones without duplicates.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { connectDB, disconnectDB } from '../config/db';
import { logger } from '../config/logger';
import { Recipe, COMMUNITY_OWNER_ID } from '../models/Recipe';

interface SeedRecipe {
  recipe_id: string;
  title: string;
  ingredients: string[];
  tags: string[];
  cuisine?: string;
}

const DATASET_PATH = resolve(__dirname, '../../../ai-service/data/recipes.json');

function toMongoRecipe(r: SeedRecipe) {
  return {
    title: r.title,
    slug: r.recipe_id,
    description: `${r.title} — seeded from the MealMate dataset.`,
    ingredients: r.ingredients.map((name) => ({ name })),
    instructions: [
      'Prep all ingredients.',
      'Cook according to your preferred method.',
      'Season to taste and serve warm.',
    ],
    cuisine: r.cuisine,
    tags: r.tags,
    prepTime: 10,
    cookTime: 20,
    servings: 2,
    nutrition: {},
    difficulty: 'easy' as const,
    source: 'seed',
    // Seeded recipes belong to the shared library, so they are community
    // recipes (editable by any signed-in user, ownership transfers on edit).
    // Never leave createdBy unset: an ownerless recipe would be editable by
    // no one under the deny-by-default owner check — or by everyone under
    // the old falsy-createdBy skip.
    createdBy: COMMUNITY_OWNER_ID,
  };
}

async function main(): Promise<void> {
  const raw = readFileSync(DATASET_PATH, 'utf-8');
  const data = JSON.parse(raw) as SeedRecipe[];
  logger.info(`Loaded ${data.length} recipes from ${DATASET_PATH}`);

  await connectDB();

  let upserted = 0;
  for (const r of data) {
    const doc = toMongoRecipe(r);
    await Recipe.updateOne({ slug: doc.slug }, { $set: doc }, { upsert: true });
    upserted += 1;
  }

  const total = await Recipe.countDocuments();
  logger.info(`Seed complete. Upserted ${upserted} recipes; collection now has ${total}.`);
  await disconnectDB();
}

main().catch((err) => {
  logger.error({ err }, 'Seed failed');
  void disconnectDB().finally(() => process.exit(1));
});
