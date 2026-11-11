import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/Button';
import { extractErrorMessage } from '@/lib/api';
import type { PantryItem } from '@/types';
import { useAuthStore } from '@/stores/authStore';
import { useAiStatus } from '@/hooks/useAiStatus';
import { useRecipes } from '@/hooks/useRecipes';

interface Props {
  pantry: PantryItem[];
  dietaryPreferences: string[];
  allergies: string[];
}

interface RAGRecipe {
  id: string;
  title: string;
  cuisine: string;
  ingredients: string[];
  similarity_score: number;
}

interface RAGResult {
  success: boolean;
  suggestion: string;
  recipes: RAGRecipe[];
  method: string;
  rag_available: boolean;
}

/**
 * RAG-powered recipe suggester.
 *
 * Takes the user's current pantry items, dietary preferences and allergies,
 * sends them to POST /ai/rag/suggest, and displays Gemini's natural-language
 * recommendation alongside the top matched recipe cards.
 *
 * Falls back gracefully to a ranked list when Gemini is not configured.
 */
export function RagRecipeSuggester({ pantry, dietaryPreferences, allergies }: Props) {
  const [result, setResult] = useState<RAGResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const token = useAuthStore((s) => s.token);
  const hasPantry = pantry.length > 0;

  const aiStatus = useAiStatus();
  const { data: savedRecipesData } = useRecipes({ limit: 200 });
  const [filterQuery, setFilterQuery] = useState('');

  const filteredRecipes = useMemo(() => {
    const q = filterQuery.toLowerCase();
    if (!q) return savedRecipesData?.items ?? [];
    return (savedRecipesData?.items ?? []).filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        (r.cuisine ?? '').toLowerCase().includes(q) ||
        (r.tags ?? []).some((t: string) => t.toLowerCase().includes(q)) ||
        (r.ingredients ?? []).some((i: { name: string }) => i.name.toLowerCase().includes(q))
    );
  }, [savedRecipesData, filterQuery]);

  async function handleSuggest() {
    setError(null);
    setLoading(true);
    setResult(null);
    setExpanded(true);
    try {
      const res = await fetch('/api/ai/rag/suggest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          pantry: pantry.map((p) => p.ingredient),
          dietary_preferences: dietaryPreferences,
          allergies,
          top_k: 5,
        }),
      });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const data: RAGResult = await res.json();
      setResult(data);
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not fetch suggestions - try again'));
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    setExpanded(false);
    setResult(null);
    setError(null);
  }

  if (!aiStatus.serviceOnline && !aiStatus.loading) {
    return (
      <section className="rounded-lg border border-line bg-card p-5">
        <div>
          <h2 className="text-lg font-semibold text-ink">Find a recipe</h2>
          <p className="mt-1 text-xs text-ink-soft">
            Search your saved recipes by name, ingredient, cuisine, or tag.
          </p>
        </div>
        <input
          type="search"
          className="mt-3 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
          placeholder="e.g. pasta, chicken, Italian..."
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
        />
        {filterQuery && (
          <ul className="mt-3 space-y-2">
            {filteredRecipes.slice(0, 8).map((r) => (
              <li key={r.id}>
                <Link
                  to={`/recipes/${r.id}`}
                  className="flex items-center justify-between rounded border border-line bg-canvas-soft px-3 py-2 text-sm hover:border-brand-400 transition"
                >
                  <span className="font-medium text-ink">{r.title}</span>
                  {r.cuisine && (
                    <span className="text-xs text-ink-soft capitalize">{r.cuisine}</span>
                  )}
                </Link>
              </li>
            ))}
            {filteredRecipes.length === 0 && (
              <p className="text-xs text-ink-soft">No saved recipes match that search.</p>
            )}
          </ul>
        )}
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-line bg-card p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">
            Semantic recipe matching
          </h2>
          <p className="mt-1 text-xs text-ink-soft">
            Evaluates your pantry items, dietary preferences, and allergies to recommend
            recipes using vector search and generative ranking.
          </p>
        </div>
        {result && (
          <span className="shrink-0 rounded bg-canvas-soft border border-line px-2 py-0.5 text-[11px] font-medium text-ink">
            {result.method === 'rag_gemini' ? 'Gemini powered' : 'Semantic search'}
          </span>
        )}
      </div>

      {/* Pantry summary chips */}
      {hasPantry && (
        <div className="mt-3 flex flex-wrap gap-1">
          {pantry.slice(0, 6).map((p) => (
            <span
              key={p.ingredient}
              className="rounded bg-canvas-soft border border-line px-2 py-0.5 text-xs text-ink capitalize"
            >
              {p.ingredient}
            </span>
          ))}
          {pantry.length > 6 && (
            <span className="rounded bg-canvas-soft border border-line px-2 py-0.5 text-xs text-ink-soft">
              +{pantry.length - 6} more
            </span>
          )}
        </div>
      )}

      {/* Action row */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          onClick={handleSuggest}
          loading={loading}
          disabled={!hasPantry || loading}
        >
          {loading ? 'Finding matches…' : 'Find matching recipes'}
        </Button>
        {!hasPantry && (
          <span className="text-xs text-gray-500">Add pantry items first</span>
        )}
        {result && !loading && (
          <Button variant="secondary" onClick={handleClose}>
            Clear
          </Button>
        )}
        {error && (
          <span role="alert" className="text-xs text-red-700">
            {error}
          </span>
        )}
      </div>

      {/* Results */}
      <AnimatePresence>
        {expanded && (result || loading) && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="mt-4 overflow-hidden"
          >
            {loading && (
              <div className="flex items-center gap-2 text-sm text-violet-700">
                <span className="animate-spin">⟳</span>
                Searching recipes semantically…
              </div>
            )}

            {result && (
              <div className="space-y-4">
                {/* Gemini suggestion text */}
                {result.suggestion && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-lg bg-violet-50 p-4 text-sm text-gray-800 ring-1 ring-violet-100"
                  >
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-violet-600">
                      AI Suggestion
                    </p>
                    <p className="whitespace-pre-line leading-relaxed">
                      {result.suggestion}
                    </p>
                  </motion.div>
                )}

                {/* Matched recipe cards */}
                {result.recipes.length > 0 && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                      Top matches ({result.recipes.length})
                    </p>
                    <ul className="mt-2 space-y-2">
                      {result.recipes.map((recipe, i) => {
                        const linkTarget =
                          recipe.id && recipe.id.length === 24
                            ? `/recipes/${recipe.id}`
                            : `/recipes?q=${encodeURIComponent(recipe.title)}`;
                        return (
                          <motion.li
                            key={recipe.id ?? i}
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: i * 0.05 }}
                            className="rounded-lg border border-gray-100 bg-white shadow-sm transition hover:border-violet-300 hover:shadow-md"
                          >
                            <Link
                              to={linkTarget}
                              className="flex items-center justify-between px-4 py-3 group"
                            >
                              <div className="min-w-0">
                                <p className="truncate font-medium text-gray-900 group-hover:text-violet-700 transition-colors">
                                  {recipe.title}
                                </p>
                                <p className="mt-0.5 truncate text-xs text-gray-500">
                                  {recipe.cuisine && (
                                    <span className="capitalize">{recipe.cuisine} · </span>
                                  )}
                                  {recipe.ingredients?.slice(0, 4).join(', ')}
                                  {recipe.ingredients?.length > 4 ? '…' : ''}
                                </p>
                              </div>
                              <span className="ml-3 shrink-0 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 ring-1 ring-violet-200">
                                {Math.round((recipe.similarity_score ?? 0) * 100)}% match
                              </span>
                            </Link>
                          </motion.li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {/* No results state */}
                {!result.success && (
                  <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
                    {result.suggestion}
                  </p>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
