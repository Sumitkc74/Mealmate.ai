import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useSimilarRecipes } from '@/hooks/useAiPlanner';
import { useAiStatus } from '@/hooks/useAiStatus';
import { useRecipes } from '@/hooks/useRecipes';
import type { Recipe } from '@/types';

interface Props {
  slug: string;
  /** Pass the current recipe so the offline fallback can match by tags/cuisine. */
  currentRecipe?: Recipe;
}

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.05 },
  },
};

const item = {
  hidden: { opacity: 0, y: 12, scale: 0.97 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.25 } },
};

/**
 * "You might also like" panel.
 *
 * Primary path: AI service nearest-neighbour search (TF-IDF / embedding).
 * Offline fallback: tag & cuisine match from the user's saved recipes — no AI
 * required, always shows something useful.
 */
export function SimilarRecipes({ slug, currentRecipe }: Props) {
  const aiStatus = useAiStatus();
  const { data, isLoading, isError } = useSimilarRecipes(slug, 4);

  // Fetch all saved recipes for the offline fallback (only when needed).
  const { data: allRecipesData } = useRecipes(
    { limit: 100 },
  );

  // Tag/cuisine-based fallback: scored by overlapping tags + same cuisine.
  const fallbackRecipes = useMemo(() => {
    if (!currentRecipe || !allRecipesData?.items) return [];
    const currentTags = new Set((currentRecipe.tags ?? []).map((t) => t.toLowerCase()));
    const currentCuisine = (currentRecipe.cuisine ?? '').toLowerCase();

    return allRecipesData.items
      .filter((r) => r.id !== currentRecipe.id && r.slug !== slug)
      .map((r) => {
        let score = 0;
        if (currentCuisine && (r.cuisine ?? '').toLowerCase() === currentCuisine) score += 2;
        for (const t of r.tags ?? []) {
          if (currentTags.has(t.toLowerCase())) score += 1;
        }
        return { recipe: r, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map(({ recipe }) => recipe);
  }, [currentRecipe, allRecipesData, slug]);

  // --- Offline fallback ---
  if (!aiStatus.loading && !aiStatus.serviceOnline) {
    if (fallbackRecipes.length === 0) return null;
    return (
      <section className="rounded-lg border border-line bg-card p-6">
        <h2 className="text-lg font-semibold text-ink">You might also like</h2>
        <p className="mt-1 text-xs text-ink-soft">
          Matched by shared tags and cuisine from your saved recipes.
        </p>
        <motion.ul
          className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          variants={container}
          initial="hidden"
          animate="show"
        >
          {fallbackRecipes.map((r) => (
            <motion.li key={r.id} variants={item}>
              <Link to={`/recipes/${r.id}`} className="block h-full">
                <div className="h-full rounded border border-line bg-canvas-soft p-3 transition hover:border-brand-500">
                  <h3 className="text-sm font-medium text-ink">{r.title}</h3>
                  {r.cuisine && (
                    <p className="mt-1 text-xs capitalize text-ink-soft">{r.cuisine}</p>
                  )}
                  {(r.tags ?? []).length > 0 && (
                    <p className="mt-1 text-[11px] text-ink-soft">
                      {(r.tags ?? []).slice(0, 3).join(', ')}
                    </p>
                  )}
                </div>
              </Link>
            </motion.li>
          ))}
        </motion.ul>
      </section>
    );
  }

  // --- AI path ---
  if (isLoading) {
    return (
      <section aria-busy="true" className="rounded-lg border border-line bg-card p-6">
        <h2 className="text-lg font-semibold text-ink">You might also like</h2>
        <p className="mt-2 text-sm text-ink-soft">Finding similar dishes…</p>
      </section>
    );
  }

  if (isError || !data || data.results.length === 0) {
    return null;
  }

  return (
    <section className="rounded-lg border border-line bg-card p-6">
      <h2 className="text-lg font-semibold text-ink">You might also like</h2>
      <p className="mt-1 text-xs text-ink-soft">
        Nearest neighbours in our recipe space - picked by culinary similarity metrics trained on recipes in MealMate.
      </p>
      <motion.ul
        className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        variants={container}
        initial="hidden"
        animate="show"
      >
        {data.results.map((r) => {
          const href = r._id ? `/recipes/${r._id}` : undefined;
          const inner = (
            <div className="h-full rounded border border-line bg-canvas-soft p-3 transition hover:border-brand-500">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-medium text-ink">{r.title}</h3>
                <span className="rounded bg-card border border-line px-2 py-0.5 text-[11px] font-medium text-brand-700">
                  {Math.round(r.score * 100)}%
                </span>
              </div>
              <p className="mt-1 text-xs text-ink-soft">{r.reason}</p>
            </div>
          );
          return (
            <motion.li key={r.recipe_id} variants={item}>
              {href ? (
                <Link to={href} className="block h-full">
                  {inner}
                </Link>
              ) : (
                inner
              )}
            </motion.li>
          );
        })}
      </motion.ul>
    </section>
  );
}
