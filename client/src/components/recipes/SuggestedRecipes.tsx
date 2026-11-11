import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useRecommendations } from '@/hooks/useRecommendations';
import type { RecommendStrategy } from '@/hooks/useAiPlanner';
import { extractErrorMessage } from '@/lib/api';
import { AddRecipeModal } from './AddRecipeModal';

const STRATEGIES: { value: RecommendStrategy; label: string; hint: string }[] = [
  { value: 'hybrid', label: 'Hybrid', hint: 'TF-IDF + LSA + collaborative (best)' },
  { value: 'tfidf', label: 'TF-IDF', hint: 'lexical overlap' },
  { value: 'lsa', label: 'LSA', hint: 'latent-semantic embedding' },
  { value: 'collab', label: 'Collab', hint: 'recipe co-occurrence' },
];

const QUICK_INSPIRATION = ['Garlic', 'Tomato', 'Pasta', 'Eggs', 'Chicken', 'Rice', 'Cheese', 'Onion'];

const AI_DISH_SUGGESTIONS = [
  'Garlic Butter Tuscan Salmon',
  '15-Min Thai Basil Chicken',
  'Creamy Lemon Ricotta Pasta',
  'Crispy Sesame Peanut Noodles',
  'Moroccan Chickpea Sweet Potato Tagine',
  'Spicy Chipotle Black Bean Bowls',
];

interface Props {
  onGenerateNew?: () => void;
  className?: string;
}

/**
 * "Suggested for you" panel — displays suggestions from recipes present in the
 * system first. If the user is not happy with existing recipes, they get to
 * decide whether they want an AI-generated option not yet in the system.
 */
export function SuggestedRecipes({ onGenerateNew, className = '' }: Props = {}) {
  const [strategy, setStrategy] = useState<RecommendStrategy>('hybrid');
  const [viewMode, setViewMode] = useState<'existing' | 'ai_option'>('existing');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalPrompt, setModalPrompt] = useState('');
  const [customPrompt, setCustomPrompt] = useState('');

  // Mode 1: Suggest items present in database comparing user pantry and recipe ingredients list
  const {
    data: dbData,
    isLoading: isLoadingDb,
    isError: isErrorDb,
    error: dbError,
  } = useRecommendations({ top_k: 6, scope: 'database' });

  // Mode 2: For AI generated recipes, use the recommendation implemented previously (ML recommender)
  const {
    data: aiData,
    isLoading: isLoadingAi,
    isError: isErrorAi,
    error: aiError,
  } = useRecommendations({ top_k: 6, strategy, scope: 'ai' }, viewMode === 'ai_option');

  const isExisting = viewMode === 'existing';
  const data = isExisting ? dbData : aiData;
  const isLoading = isExisting ? isLoadingDb : isLoadingAi;
  const isError = isExisting ? isErrorDb : isErrorAi;
  const error = isExisting ? dbError : aiError;

  const handleOpenAiGenerator = (initialPrompt = '') => {
    if (onGenerateNew && !initialPrompt) {
      onGenerateNew();
      return;
    }
    setModalPrompt(initialPrompt);
    setIsModalOpen(true);
  };

  const handleFormGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    if (customPrompt.trim()) {
      handleOpenAiGenerator(customPrompt.trim());
    } else {
      handleOpenAiGenerator();
    }
  };

  return (
    <section
      aria-label="Suggested for you"
      className={`rounded-lg border border-line bg-card p-4 sm:p-6 ${className}`}
    >
      {/* ─── Header & Strategy & View Toggle ─── */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-line pb-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-serif font-bold text-text flex items-center gap-1.5">
              <span>Suggested for you</span>
            </h2>
            <span
              className="rounded border border-line bg-canvas px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-text-muted"
              title="Active recommendation mode"
            >
              {isExisting ? 'Pantry match' : (aiData?.strategy ?? strategy)}
            </span>
          </div>
          <p className="mt-1 text-xs text-text-muted">
            {isExisting
              ? 'Comparing your pantry items with recipe ingredient lists in your database. Then decide if you want an AI-generated option.'
              : 'Machine-learning recommendations (TF-IDF, LSA and Collaborative). Review, generate, and save any dish.'}
          </p>
        </div>

        {/* Action controls: Mode switcher and Strategy selector */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Mode Switcher: Present in database vs AI generated */}
          <div className="inline-flex rounded border border-line bg-canvas p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('existing')}
              className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                isExisting
                  ? 'bg-ink text-canvas font-semibold'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              Recipes in database
            </button>
            <button
              type="button"
              onClick={() => setViewMode('ai_option')}
              className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                !isExisting
                  ? 'bg-ink text-canvas font-semibold'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              AI generated option
            </button>
          </div>

          {!isExisting && (
            <div className="flex items-center gap-1.5">
              <label htmlFor="recommender-strategy-select" className="text-xs text-brand-700">
                Strategy
              </label>
              <select
                id="recommender-strategy-select"
                value={strategy}
                onChange={(e) => setStrategy(e.target.value as RecommendStrategy)}
                className="rounded-md border border-brand-200 bg-white px-2 py-1 text-xs font-medium text-brand-800 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                aria-label="Recommendation strategy"
              >
                {STRATEGIES.map((s) => (
                  <option key={s.value} value={s.value} title={s.hint}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* ─── Mode 1: Present on Database (Pantry vs Recipe Ingredients Comparison) ─── */}
      {isExisting && (
        <div className="space-y-4">
          {isLoading && (
            <div aria-busy="true" className="flex items-center gap-2 p-6 text-sm text-brand-700">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
              <span>Comparing your pantry with recipes in database…</span>
            </div>
          )}

          {isError && (
            <div className="rounded-xl border border-brand-200 bg-white/80 p-4">
              <p className="text-xs text-brand-800">
                {extractErrorMessage(error, '').toLowerCase().includes('pantry')
                  ? 'Add ingredients to your pantry to get personalized recipe suggestions.'
                  : 'Suggestions are temporarily unavailable.'}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Link
                  to="/pantry"
                  className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-700"
                >
                  Manage pantry →
                </Link>
                <div className="flex flex-wrap items-center gap-1 text-xs text-brand-700">
                  <span className="text-gray-500">Popular items:</span>
                  {QUICK_INSPIRATION.slice(0, 5).map((ing) => (
                    <Link
                      key={ing}
                      to={`/recipes?q=${encodeURIComponent(ing)}`}
                      className="rounded-full bg-white px-2 py-0.5 text-[11px] text-brand-800 shadow-xs ring-1 ring-brand-200 hover:bg-brand-100"
                    >
                      {ing}
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          )}

          {!isLoading && !isError && (!data || data.results.length === 0) && (
            <div className="rounded-xl border border-dashed border-brand-200 bg-white/70 p-6 text-center text-xs text-gray-600">
              <p className="font-medium text-brand-900">No matching recipes currently found in your database.</p>
              <p className="mt-1 text-gray-500">
                Add more recipes or switch to the AI-generated option to discover fresh dishes.
              </p>
            </div>
          )}

          {/* Database Recipe Cards with Pantry vs Ingredients Comparison */}
          {data && data.results.length > 0 && (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.results.map((r) => {
                const totalTime = (r.prepTime ?? 0) + (r.cookTime ?? 0);
                const linkTarget = r._id ? `/recipes/${r._id}` : `/recipes?q=${encodeURIComponent(r.title)}`;

                return (
                  <li
                    key={r.recipe_id}
                    className="group relative flex flex-col justify-between rounded-xl border border-brand-200 bg-white p-3.5 shadow-xs transition hover:border-brand-400 hover:shadow-md"
                  >
                    <Link to={linkTarget} className="flex-1 focus:outline-none">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="mb-1">
                            <span className="inline-block rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 border border-emerald-200">
                              Present in database
                            </span>
                          </div>
                          <h3 className="font-semibold text-gray-900 transition-colors group-hover:text-brand-700">
                            {r.title}
                          </h3>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500">
                            {totalTime > 0 && <span>⏱️ {totalTime}m</span>}
                            {r.cuisine && (
                              <span className="capitalize text-brand-700">· {r.cuisine}</span>
                            )}
                            {r.difficulty && (
                              <span className="capitalize text-gray-400">· {r.difficulty}</span>
                            )}
                          </div>
                        </div>
                        <span
                          className="shrink-0 rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-900 border border-emerald-200"
                          title="Pantry match score"
                        >
                          {Math.round(r.score * 100)}%
                        </span>
                      </div>

                      <p className="mt-2 text-xs leading-relaxed text-gray-600 line-clamp-2">
                        {r.reason}
                      </p>

                      {/* Pantry Comparison Breakdown: Matched vs Missing */}
                      <div className="mt-2.5 flex flex-col gap-1.5">
                        {r.matched_ingredients.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1">
                            <span className="text-[10px] font-semibold text-text-muted mr-0.5">Pantry:</span>
                            {r.matched_ingredients.slice(0, 4).map((ing) => (
                              <span
                                key={ing}
                                className="inline-flex items-center gap-1 rounded bg-canvas px-2 py-0.5 text-[11px] font-medium text-text border border-line"
                              >
                                <span className="font-mono text-[10px] text-terracotta">+</span> {ing}
                              </span>
                            ))}
                            {r.matched_ingredients.length > 4 && (
                              <span className="text-[10px] text-text-muted self-center">
                                +{r.matched_ingredients.length - 4} more
                              </span>
                            )}
                          </div>
                        )}

                        {r.missing_ingredients && r.missing_ingredients.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1">
                            <span className="text-[10px] font-semibold text-text-muted mr-0.5">Need:</span>
                            {r.missing_ingredients.slice(0, 3).map((ing) => (
                              <span
                                key={ing}
                                className="inline-flex items-center gap-1 rounded bg-canvas px-2 py-0.5 text-[11px] font-medium text-text-muted border border-line"
                              >
                                <span className="font-mono text-[10px] text-terracotta">-</span> {ing}
                              </span>
                            ))}
                            {r.missing_ingredients.length > 3 && (
                              <span className="text-[10px] text-text-muted self-center">
                                +{r.missing_ingredients.length - 3} missing
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </Link>

                    <div className="mt-3 flex items-center justify-between border-t border-brand-100/70 pt-2 text-[10px] text-gray-500">
                      <span className="text-[10px] text-gray-400">In database</span>
                      <Link
                        to={linkTarget}
                        className="font-medium text-brand-700 hover:text-brand-900 group-hover:underline"
                      >
                        View recipe →
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {/* ─── Decision Block: User gets to decide if they want an AI generated option ─── */}
          <div className="mt-5 rounded-lg border border-line bg-canvas p-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-serif text-sm sm:text-base font-semibold text-text">
                    Not happy with these existing recipe suggestions?
                  </h3>
                  <span className="rounded border border-line bg-card px-2 py-0.5 text-[10px] font-mono text-text-muted">
                    Optional
                  </span>
                </div>
                <p className="mt-1 text-xs text-text-muted max-w-xl leading-relaxed">
                  You get to decide if you want an AI-generated option. MealMate AI uses your previously implemented recommendation model (TF-IDF, LSA, and Collaborative filtering) to suggest creative dishes for you to verify and save.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setViewMode('ai_option')}
                  className="rounded border border-line bg-card px-3 py-1.5 text-xs font-semibold text-text hover:bg-canvas transition"
                >
                  Explore AI Ideas
                </button>
                <button
                  type="button"
                  onClick={() => handleOpenAiGenerator()}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded bg-ink px-3.5 py-1.5 text-xs font-semibold text-canvas transition hover:bg-terracotta"
                >
                  <span>Suggest new recipes with AI</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Mode 2: AI Generated Option (Using Previously Implemented AI Recommendation) ─── */}
      {!isExisting && (
        <div className="space-y-4 animate-fadeIn">
          <div className="rounded-lg border border-line bg-card p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold text-text">
                    AI-Generated Recipes (Not Present in Database)
                  </h3>
                </div>
                <p className="mt-1 text-xs text-text-muted max-w-2xl leading-relaxed">
                  Powered by your previously implemented AI recommender (TF-IDF, LSA, and Collaborative filtering). Select any dish to generate, review, and save to your database.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewMode('existing')}
                className="text-xs font-medium text-terracotta hover:underline shrink-0"
              >
                Back to recipes in database
              </button>
            </div>

            {/* AI Recommender Results (Using Previously Implemented Recommendation) */}
            {isLoading && (
              <div aria-busy="true" className="flex items-center gap-2 p-6 text-sm text-brand-700">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
                <span>Running {strategy.toUpperCase()} recommendation engine…</span>
              </div>
            )}

            {!isLoading && data && data.results.length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <label className="text-xs font-semibold text-gray-700 block mb-2.5">
                  AI Recommender Matches ({strategy.toUpperCase()}):
                </label>
                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {data.results.map((r) => {
                    return (
                      <li
                        key={r.recipe_id}
                        className="group relative flex flex-col justify-between rounded-xl border border-brand-100 bg-brand-50/30 p-3.5 shadow-xs transition hover:border-brand-400 hover:bg-white hover:shadow-md"
                      >
                        <div className="flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <span className="inline-block rounded bg-canvas px-1.5 py-0.5 text-[10px] font-mono text-text-muted border border-line">
                                AI Recommendation
                              </span>
                              <h4 className="mt-1 font-semibold text-text transition-colors group-hover:text-terracotta">
                                {r.title}
                              </h4>
                              {r.cuisine && (
                                <p className="text-[11px] capitalize text-text-muted mt-0.5">
                                  {r.cuisine} cuisine
                                </p>
                              )}
                            </div>
                            <span
                              className="shrink-0 rounded border border-line bg-canvas px-2 py-0.5 text-xs font-mono font-semibold text-text"
                              title="AI match score"
                            >
                              {Math.round(r.score * 100)}%
                            </span>
                          </div>

                          {r.reason && (
                            <p className="mt-2 text-xs leading-relaxed text-text-muted line-clamp-2">
                              {r.reason}
                            </p>
                          )}

                          {r.matched_ingredients.length > 0 && (
                            <div className="mt-2.5 flex flex-wrap gap-1">
                              {r.matched_ingredients.slice(0, 3).map((ing) => (
                                <span
                                  key={ing}
                                  className="rounded bg-canvas px-2 py-0.5 text-[11px] font-medium text-text border border-line"
                                >
                                  {ing}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="mt-3 flex items-center justify-between border-t border-line pt-2 text-[10px]">
                          {r.signals && r.signals.length > 0 ? (
                            <div className="flex flex-wrap gap-1 text-text-muted">
                              {r.signals.map((s) => (
                                <span key={s.name} className="rounded bg-canvas px-1.5 py-0.5 border border-line">
                                  {s.name} {Math.round(s.score * 100)}%
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-text-muted">ML Recommender</span>
                          )}

                          <button
                            type="button"
                            onClick={() => handleOpenAiGenerator(r.title)}
                            className="inline-flex items-center gap-1 font-semibold text-terracotta hover:underline"
                          >
                            <span>Generate</span>
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* Quick Inspiration Chips */}
            <div className="mt-4 pt-3 border-t border-line">
              <label className="text-xs font-semibold text-text block mb-2">
                Suggested dish ideas (not in system):
              </label>
              <div className="flex flex-wrap gap-2">
                {AI_DISH_SUGGESTIONS.map((dish) => (
                  <button
                    key={dish}
                    type="button"
                    onClick={() => handleOpenAiGenerator(dish)}
                    className="inline-flex items-center rounded border border-line bg-canvas px-3 py-1.5 text-xs font-medium text-text hover:border-text transition-colors"
                  >
                    <span>{dish}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Custom AI Prompt Form */}
            <form onSubmit={handleFormGenerate} className="mt-4 pt-3 border-t border-line flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                placeholder="Or enter any custom craving (e.g. 15-min Lemon Herb Salmon, Thai Coconut Curry)..."
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                className="flex-1 rounded border border-line bg-canvas px-3 py-2 text-xs sm:text-sm text-text placeholder:text-text-muted focus:border-terracotta focus:outline-none"
              />
              <button
                type="submit"
                className="rounded bg-ink px-4 py-2 text-xs sm:text-sm font-semibold text-canvas hover:bg-terracotta transition-colors flex items-center justify-center shrink-0"
              >
                <span>Generate &amp; Verify Draft</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Autonomous AddRecipeModal instance for self-contained operation */}
      <AddRecipeModal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        initialPrompt={modalPrompt}
      />
    </section>
  );
}
