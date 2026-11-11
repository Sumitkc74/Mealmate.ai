import { useEffect, useState } from 'react';
import { useGenerateRecipe, useRecipes } from '@/hooks/useRecipes';
import { useDebounce } from '@/hooks/useDebounce';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

interface RecipePickerModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  onPick: (recipeId: string) => void;
}

export function RecipePickerModal({ open, title, onClose, onPick }: RecipePickerModalProps) {
  const [search, setSearch] = useState('');
  const [genError, setGenError] = useState<string | null>(null);
  const debounced = useDebounce(search, 300);
  const { data, isLoading } = useRecipes({
    q: debounced || undefined,
    limit: 20,
    page: 1,
  });
  const generate = useGenerateRecipe();

  useEffect(() => {
    if (!open) {
      setSearch('');
      setGenError(null);
      generate.reset();
    }
    // We intentionally don't include `generate` in the dep array - calling
    // .reset() on every render would loop. Only run when `open` changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Clear stale errors as soon as the user edits the search box.
  useEffect(() => {
    if (genError) setGenError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const trimmedSearch = debounced.trim();
  const noResults = !isLoading && data !== undefined && data.items.length === 0;
  const canGenerate = trimmedSearch.length >= 3;

  async function handleGenerate() {
    if (!canGenerate || generate.isPending) return;
    setGenError(null);
    try {
      const { recipe } = await generate.mutateAsync({ query: trimmedSearch });
      // Immediately assign the freshly-generated recipe to the meal slot.
      onPick(recipe.id);
    } catch (err) {
      const message =
        (err as { response?: { data?: { message?: string } }; message?: string })
          ?.response?.data?.message ||
        (err as Error)?.message ||
        'Failed to generate recipe.';
      setGenError(message);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-md flex-col rounded-lg bg-card border border-line p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-ink">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-ink-soft hover:bg-canvas-soft hover:text-ink text-xs font-semibold"
          >
            Close
          </button>
        </div>

        <div className="mt-3">
          <Input
            autoFocus
            aria-label="Search"
            placeholder="Search recipes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <ul className="mt-3 flex-1 space-y-1 overflow-y-auto">
          {isLoading && <li className="p-3 text-sm text-ink-soft">Loading…</li>}
          {data?.items.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => onPick(r.id)}
                className="flex w-full items-center justify-between rounded p-2 text-left text-sm hover:bg-canvas-soft"
              >
                <span className="truncate font-medium text-ink">{r.title}</span>
                <span className="ml-2 shrink-0 text-xs text-ink-soft">
                  {(r.prepTime ?? 0) + (r.cookTime ?? 0)} min
                </span>
              </button>
            </li>
          ))}
          {noResults && (
            <li className="space-y-3 p-3 text-sm">
              <p className="text-ink-soft">
                No recipes in your library match{' '}
                <span className="font-medium text-ink">
                  &ldquo;{trimmedSearch || search}&rdquo;
                </span>
                .
              </p>
              <p className="text-xs text-ink-soft">
                MealMate can generate a recipe draft for your search terms and assign
                it to this slot.
              </p>
            </li>
          )}
          <li className="space-y-3 p-3 text-sm">
            {canGenerate ? (
              <>
                <p className="text-ink-soft">
                  Can’t find the match? Generate a custom recipe based on{' '}
                  <span className="font-medium text-ink">{trimmedSearch || search}</span>.
                </p>
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={generate.isPending}
                  className="flex w-full items-center justify-center gap-2 rounded bg-brand-600 px-4 py-2 text-sm font-semibold text-white border border-brand-700 shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {generate.isPending ? (
                    <>
                      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      Generating…
                    </>
                  ) : (
                    <>Generate &ldquo;{trimmedSearch || search}&rdquo;</>
                  )}
                </button>
                {genError && (
                  <p className="rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700">
                    {genError}
                  </p>
                )}
              </>
            ) : (
              <p className="text-xs text-gray-400">
                Type at least 3 characters to generate with AI.
              </p>
            )}
          </li>
        </ul>

        <div className="mt-3 flex justify-end">
          <Button
            variant="secondary"
            size="sm"
            onClick={onClose}
            disabled={generate.isPending}
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
