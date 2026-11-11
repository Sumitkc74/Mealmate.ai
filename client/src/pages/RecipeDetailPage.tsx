import { useState, useMemo, useEffect, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { useDeleteRecipe, useRecipe } from '@/hooks/useRecipes';
import { useAuthStore } from '@/stores/authStore';
import { extractErrorMessage } from '@/lib/api';
import { Skeleton } from '@/components/ui/Skeleton';
import { SimilarRecipes } from '@/components/recipes/SimilarRecipes';
import { IngredientSubstituteModal } from '@/components/recipes/IngredientSubstituteModal';
import { KitchenModeModal } from '@/components/recipes/KitchenModeModal';
import { CookedDeductModal } from '@/components/recipes/CookedDeductModal';
import { MedicalDisclaimerBanner } from '@/components/ui/MedicalDisclaimerBanner';
import {
  formatQuantity,
  scaleRecipe,
  extractInstructionTimers,
} from '@/lib/recipeScaler';
import { usePageMetadata } from '@/hooks/usePageMetadata';

export function RecipeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const { data: recipe, isLoading, isError, error } = useRecipe(id);

  usePageMetadata({
    title: recipe?.title ? `${recipe.title} | MealMate` : 'Recipe Details | MealMate',
    description: recipe?.description
      ? (recipe.description.length > 155 ? `${recipe.description.slice(0, 152)}...` : recipe.description)
      : 'View ingredient quantities, dynamic portion scaling, step-by-step cooking instructions, active timers, and nutritional macronutrient breakdowns.',
  });

  const del = useDeleteRecipe();

  const [imageOk, setImageOk] = useState(true);
  const [subModalOpen, setSubModalOpen] = useState(false);
  const [kitchenModeOpen, setKitchenModeOpen] = useState(false);
  const [cookedModalOpen, setCookedModalOpen] = useState(false);
  const [selectedIng, setSelectedIng] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Dynamic Servings state
  const baseServings = recipe?.servings || 2;
  const [customServings, setCustomServings] = useState<number | null>(null);
  const currentServings = customServings ?? baseServings;

  // Scaled Recipe based on dynamic servings
  const displayRecipe = useMemo(() => {
    if (!recipe) return null;
    return scaleRecipe(recipe, currentServings);
  }, [recipe, currentServings]);

  // Cooking history for this recipe
  const recipeCookingHistory = useMemo(() => {
    if (!user?.cookingHistory || !recipe) return [];
    return user.cookingHistory.filter((h) => h.recipeId === recipe.id);
  }, [user?.cookingHistory, recipe?.id]);

  // In-Instruction Active Timer state
  const [activeTimer, setActiveTimer] = useState<{
    seconds: number;
    total: number;
    label: string;
    running: boolean;
  } | null>(null);

  const timerIntervalRef = useRef<any>(null);

  // Play audio chime when timer completes
  function playTimerFinishChime() {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.8);
      osc.start();
      osc.stop(ctx.currentTime + 0.8);
    } catch {}
  }

  // Active Timer countdown loop
  useEffect(() => {
    if (activeTimer && activeTimer.running && activeTimer.seconds > 0) {
      timerIntervalRef.current = setInterval(() => {
        setActiveTimer((prev) => {
          if (!prev) return null;
          if (prev.seconds <= 1) {
            clearInterval(timerIntervalRef.current);
            playTimerFinishChime();
            return { ...prev, seconds: 0, running: false };
          }
          return { ...prev, seconds: prev.seconds - 1 };
        });
      }, 1000);
    }
    return () => clearInterval(timerIntervalRef.current);
  }, [activeTimer?.running, activeTimer?.seconds]);

  function showToast(msg: string) {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="aspect-[16/9] w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (isError || !recipe || !displayRecipe) {
    return (
      <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
        {extractErrorMessage(error, 'Recipe not found')}
        <div className="mt-2">
          <Link to="/recipes" className="font-medium text-red-800 underline">
            ← Back to recipes
          </Link>
        </div>
      </div>
    );
  }

  const isOwner =
    user && recipe.createdBy && (String(recipe.createdBy) === user.id || user.role === 'admin');
  const total = (recipe.prepTime ?? 0) + (recipe.cookTime ?? 0);
  const showImage = Boolean(recipe.imageUrl) && imageOk;

  async function handleDelete() {
    if (!recipe) return;
    if (!confirm(`Delete "${recipe.title}"? This cannot be undone.`)) return;
    try {
      await del.mutateAsync(recipe.id);
      navigate('/recipes', { replace: true });
    } catch (err) {
      alert(extractErrorMessage(err, 'Could not delete recipe'));
    }
  }

  return (
    <article className="space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-lg bg-emerald-950 text-white px-5 py-3 shadow-lg border border-emerald-800 animate-slideUp">
          <span className="text-sm font-medium">{toastMessage}</span>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            className="text-emerald-300 hover:text-white text-xs ml-2 font-semibold"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Floating Active Timer Widget */}
      {activeTimer && (
        <div className="sticky top-4 z-40 flex items-center justify-between rounded-lg bg-stone-900 text-white px-5 py-3 shadow-lg border border-stone-800">
          <div className="flex items-center gap-3">
            <div>
              <div className="text-xs text-stone-400">{activeTimer.label}</div>
              <div className="font-mono text-xl font-bold">
                {Math.floor(activeTimer.seconds / 60)}:
                {activeTimer.seconds % 60 < 10 ? '0' : ''}
                {activeTimer.seconds % 60}
                {activeTimer.seconds === 0 && (
                  <span className="ml-2.5 text-xs font-sans text-red-400 font-normal">
                    Time is up!
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setActiveTimer((prev) => (prev ? { ...prev, running: !prev.running } : null))
              }
              className="px-3 py-1.5 rounded bg-stone-800 hover:bg-stone-700 text-xs font-semibold text-stone-200"
            >
              {activeTimer.running ? 'Pause' : 'Resume'}
            </button>
            <button
              type="button"
              onClick={() => setKitchenModeOpen(true)}
              className="px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 text-xs font-semibold text-white"
            >
              Open Kitchen Mode
            </button>
            <button
              type="button"
              onClick={() => setActiveTimer(null)}
              className="p-1.5 text-stone-400 hover:text-white text-xs font-semibold"
              aria-label="Dismiss timer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div>
        <Link to="/recipes" className="text-sm text-terracotta hover:underline font-medium">
          All recipes
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-serif text-3xl font-bold text-text">{recipe.title}</h1>
            {recipeCookingHistory.length > 0 && (
              <span className="inline-flex items-center rounded border border-line bg-canvas px-2.5 py-0.5 text-xs font-mono text-text-muted">
                Cooked {recipeCookingHistory.length}x
              </span>
            )}
          </div>
          {recipe.description && <p className="mt-2 text-sm text-text-muted leading-relaxed">{recipe.description}</p>}
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {/* I Cooked This button */}
          <Button
            type="button"
            variant="secondary"
            onClick={() => setCookedModalOpen(true)}
            className="flex items-center gap-1.5"
          >
            <span>I Cooked This!</span>
          </Button>

          {/* Kitchen Mode launch button */}
          <Button
            type="button"
            onClick={() => setKitchenModeOpen(true)}
            className="flex items-center gap-1.5 bg-ink hover:bg-terracotta text-canvas font-medium"
          >
            <span>Kitchen Mode</span>
          </Button>

          {isOwner && (
            <div className="flex gap-2">
              <Link to={`/recipes/${recipe.id}/edit`}>
                <Button variant="secondary" size="sm">
                  Edit
                </Button>
              </Link>
              <Button variant="danger" size="sm" loading={del.isPending} onClick={handleDelete}>
                Delete
              </Button>
            </div>
          )}
        </div>
      </header>

      <div className="overflow-hidden rounded-lg bg-canvas border border-line">
        {showImage ? (
          <img
            src={recipe.imageUrl}
            alt={recipe.title}
            width={800}
            height={360}
            loading="eager"
            decoding="async"
            className="h-[360px] w-full object-cover"
            onError={() => setImageOk(false)}
          />
        ) : (
          <div className="flex h-[240px] items-center justify-center font-serif text-sm text-text-muted">
            Recipe preview image
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-text-muted">
        <span className="rounded border border-line bg-card px-2.5 py-1">Prep: {recipe.prepTime} min</span>
        <span className="rounded border border-line bg-card px-2.5 py-1">Cook: {recipe.cookTime} min</span>
        <span className="rounded border border-line bg-card px-2.5 py-1">Total: {total} min</span>
        <span className="rounded border border-line bg-card px-2.5 py-1">{currentServings} servings</span>
        <span className="rounded border border-line bg-card px-2.5 py-1 capitalize">Difficulty: {recipe.difficulty}</span>
        {recipe.cuisine && (
          <span className="rounded border border-line bg-card px-2.5 py-1 capitalize">Cuisine: {recipe.cuisine}</span>
        )}
      </div>

      {recipe.tags && recipe.tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {recipe.tags.map((t) => (
            <span
              key={t}
              className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700"
            >
              #{t}
            </span>
          ))}
        </div>
      )}

      {/* Previous Cooking History & Notes */}
      {recipeCookingHistory.length > 0 && (
        <section className="rounded-lg border border-line bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-text">
                You've cooked this {recipeCookingHistory.length} {recipeCookingHistory.length === 1 ? 'time' : 'times'}!
              </h3>
            </div>
            <span className="text-xs text-text-muted font-mono">
              Last cooked:{' '}
              {new Date(
                recipeCookingHistory[recipeCookingHistory.length - 1]!.cookedAt
              ).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </span>
          </div>

          {recipeCookingHistory.some((h) => h.notes || h.rating) && (
            <div className="mt-3 space-y-2 border-t border-line pt-2.5 text-xs">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                Your Chef Notes
              </h4>
              {recipeCookingHistory
                .filter((h) => h.notes || h.rating)
                .slice(-2)
                .reverse()
                .map((entry, idx) => (
                  <div
                    key={idx}
                    className="flex flex-col gap-1 rounded bg-canvas p-2.5 border border-line"
                  >
                    <div className="flex items-center justify-between">
                      {entry.rating ? (
                        <span className="text-terracotta font-mono text-xs">
                          Rating: {entry.rating}/5
                        </span>
                      ) : (
                        <span className="text-text-muted text-[10px]">No rating</span>
                      )}
                      <span className="text-[10px] text-text-muted">
                        {new Date(entry.cookedAt).toLocaleDateString()}
                      </span>
                    </div>
                    {entry.notes && (
                      <p className="text-text italic">
                        "{entry.notes}"
                      </p>
                    )}
                  </div>
                ))}
            </div>
          )}
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-[2fr,3fr]">
        {/* Ingredients section with Dynamic Servings Stepper */}
        <section className="rounded-lg border border-line bg-card p-6">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
            <div>
              <h2 className="text-lg font-semibold text-text">Ingredients</h2>
              <p className="text-xs text-text-muted">
                Scaled dynamically for {currentServings} {currentServings === 1 ? 'serving' : 'servings'}
              </p>
            </div>

            {/* Servings Stepper Controls */}
            <div className="flex items-center gap-2">
              <div className="inline-flex items-center rounded border border-line bg-canvas p-0.5">
                <button
                  type="button"
                  onClick={() => setCustomServings(Math.max(1, currentServings - 1))}
                  disabled={currentServings <= 1}
                  aria-label="Decrease servings"
                  className="h-7 w-7 rounded bg-card text-sm font-bold text-text hover:bg-canvas disabled:opacity-30 disabled:hover:bg-card"
                >
                  −
                </button>
                <span className="px-2.5 text-xs font-mono font-semibold text-text min-w-[28px] text-center">
                  {currentServings}
                </span>
                <button
                  type="button"
                  onClick={() => setCustomServings(currentServings + 1)}
                  aria-label="Increase servings"
                  className="h-7 w-7 rounded bg-card text-sm font-bold text-text hover:bg-canvas"
                >
                  +
                </button>
              </div>

              {currentServings !== baseServings && (
                <button
                  type="button"
                  onClick={() => setCustomServings(baseServings)}
                  className="text-xs font-medium text-terracotta hover:underline"
                >
                  Reset ({baseServings})
                </button>
              )}
            </div>
          </div>

          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={() => {
                setSelectedIng('');
                setSubModalOpen(true);
              }}
              className="text-xs font-semibold text-terracotta hover:underline"
            >
              Ingredient Swaps
            </button>
          </div>

          <ul className="mt-3 space-y-2 text-sm">
            {displayRecipe.ingredients.map((ing, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-2 border-b border-line py-1.5"
              >
                <div className="flex items-center gap-2">
                  <span className="text-text">{ing.name}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedIng(ing.name);
                      setSubModalOpen(true);
                    }}
                    title={`Find substitutions for ${ing.name}`}
                    className="text-[11px] text-text-muted hover:text-terracotta hover:underline font-mono"
                  >
                    swap?
                  </button>
                </div>
                <span className="font-mono text-xs text-text-muted">
                  {formatQuantity(ing.quantity)}
                  {ing.unit ? ` ${ing.unit}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* Instructions with Smart Timers */}
        <section className="rounded-lg border border-line bg-card p-6">
          <div className="flex items-center justify-between border-b border-line pb-3">
            <h2 className="text-lg font-semibold text-text">Instructions</h2>
            <button
              type="button"
              onClick={() => setKitchenModeOpen(true)}
              className="text-xs font-semibold text-terracotta hover:underline"
            >
              Hands-Free Mode
            </button>
          </div>

          <ol className="mt-3 space-y-3.5 text-sm">
            {displayRecipe.instructions.map((step, i) => {
              const detectedTimers = extractInstructionTimers(step);

              return (
                <li key={i} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
                    {i + 1}
                  </span>
                  <div className="flex-1 space-y-1.5">
                    <p className="leading-relaxed text-gray-700">{step}</p>
                    {detectedTimers.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        {detectedTimers.map((timer, tIdx) => (
                          <button
                            key={tIdx}
                            type="button"
                            onClick={() =>
                              setActiveTimer({
                                seconds: timer.seconds,
                                total: timer.seconds,
                                label: `Step ${i + 1} (${timer.label})`,
                                running: true,
                              })
                            }
                            className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800 border border-amber-200 hover:bg-amber-100 transition"
                          >
                            <span>⏱️</span>
                            <span>Start {timer.label} timer</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      </div>

      {/* Nutrition (per serving) */}
      {recipe.nutrition && (
        <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Nutrition (per serving)</h2>
            {currentServings !== baseServings && (
              <span className="text-xs text-gray-500">
                Total for {currentServings} servings available
              </span>
            )}
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {Object.entries(recipe.nutrition).map(([k, v]) =>
              v == null ? null : (
                <div key={k} className="rounded-md bg-gray-50 p-3">
                  <dt className="text-xs uppercase text-gray-500">{k}</dt>
                  <dd className="text-base font-semibold text-gray-900">
                    {v}
                    {currentServings !== baseServings && typeof v === 'number' && (
                      <span className="block text-[11px] font-normal text-gray-500">
                        Total: {Math.round(v * currentServings)}
                      </span>
                    )}
                  </dd>
                </div>
              )
            )}
          </dl>
        </section>
      )}

      <MedicalDisclaimerBanner compact />

      {recipe.slug && <SimilarRecipes slug={recipe.slug} currentRecipe={recipe} />}

      {/* Modals */}
      <IngredientSubstituteModal
        isOpen={subModalOpen}
        onClose={() => setSubModalOpen(false)}
        initialIngredient={selectedIng}
      />

      <KitchenModeModal
        isOpen={kitchenModeOpen}
        onClose={() => setKitchenModeOpen(false)}
        recipe={displayRecipe}
      />

      <CookedDeductModal
        isOpen={cookedModalOpen}
        onClose={() => setCookedModalOpen(false)}
        recipeId={recipe.id}
        recipeTitle={recipe.title}
        recipeIngredients={displayRecipe.ingredients}
        servingsCooked={currentServings}
        onDeducted={(count) => {
          showToast(
            count > 0
              ? `Awesome cooking! ${count} items were deducted and logged to your history.`
              : 'Meal logged to your cooking history!'
          );
        }}
      />
    </article>
  );
}
