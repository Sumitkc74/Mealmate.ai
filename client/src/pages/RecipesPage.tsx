import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { RecipeCardSkeleton } from '@/components/ui/Skeleton';
import { RecipeCard } from '@/components/recipes/RecipeCard';
import { SuggestedRecipes } from '@/components/recipes/SuggestedRecipes';
import { RecipeImportModal } from '@/components/recipes/RecipeImportModal';
import { AddRecipeModal } from '@/components/recipes/AddRecipeModal';
import { useRecipes, type ListRecipesParams } from '@/hooks/useRecipes';
import { useDebounce } from '@/hooks/useDebounce';
import { extractErrorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { usePageMetadata } from '@/hooks/usePageMetadata';

const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
const SORTS = [
  { value: 'recent', label: 'Most recent' },
  { value: 'fastest', label: 'Fastest' },
  { value: 'relevance', label: 'Relevance' },
] as const;

export function RecipesPage() {
  usePageMetadata({
    title: 'Recipe Library | MealMate',
    description:
      'Browse and search your personal recipe collection, filter by dietary requirements and prep time, or generate custom dishes with MealMate smart solver.',
  });

  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState(searchParams.get('q') ?? '');
  const debouncedSearch = useDebounce(search, 350);

  const cuisine = searchParams.get('cuisine') ?? '';
  const tag = searchParams.get('tag') ?? '';
  const difficulty = (searchParams.get('difficulty') ?? '') as '' | 'easy' | 'medium' | 'hard';
  const maxPrepTimeRaw = searchParams.get('maxPrepTime');
  const sort = (searchParams.get('sort') ?? 'recent') as 'recent' | 'fastest' | 'relevance';
  const page = Number(searchParams.get('page') ?? '1') || 1;

  // Sync the debounced search box back into the URL params.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (debouncedSearch) next.set('q', debouncedSearch);
    else next.delete('q');
    if (next.toString() !== searchParams.toString()) {
      next.set('page', '1');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const params: ListRecipesParams = {
    q: debouncedSearch || undefined,
    cuisine: cuisine || undefined,
    tag: tag || undefined,
    difficulty: difficulty || undefined,
    maxPrepTime: maxPrepTimeRaw ? Number(maxPrepTimeRaw) : undefined,
    sort,
    page,
    limit: 12,
  };

  const { data, isLoading, isError, error, isFetching } = useRecipes(params);

  function updateParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.set('page', '1');
    setSearchParams(next, { replace: true });
  }

  function clearFilters() {
    setSearch('');
    setSearchParams({}, { replace: true });
  }

  const hasFilters = Boolean(cuisine || tag || difficulty || maxPrepTimeRaw || debouncedSearch);

  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Recipes</h1>
          <p className="text-sm text-gray-600">
            {data ? `${data.total} recipe${data.total === 1 ? '' : 's'}` : 'Loading…'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setIsImportModalOpen(true)}
            className="flex items-center gap-1.5"
          >
            <span>Import CSV / Excel</span>
          </Button>
          <Button
            type="button"
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center gap-1.5"
          >
            <span>+ New recipe</span>
          </Button>
        </div>
      </header>

      <SuggestedRecipes
        onGenerateNew={() => setIsAddModalOpen(true)}
      />

      <div className="grid gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-5">
        <Input
          label="Search"
          placeholder="Pasta, chicken, vegan…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search recipes"
        />
        <Input
          label="Cuisine"
          placeholder="italian, asian…"
          value={cuisine}
          onChange={(e) => updateParam('cuisine', e.target.value)}
        />
        <Input
          label="Tag"
          placeholder="vegetarian"
          value={tag}
          onChange={(e) => updateParam('tag', e.target.value)}
        />
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700" htmlFor="difficulty-select">
            Difficulty
          </label>
          <select
            id="difficulty-select"
            value={difficulty}
            onChange={(e) => updateParam('difficulty', e.target.value || null)}
            className="h-10 rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
          >
            <option value="">Any</option>
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {d.charAt(0).toUpperCase() + d.slice(1)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700" htmlFor="sort-select">
            Sort by
          </label>
          <select
            id="sort-select"
            value={sort}
            onChange={(e) => updateParam('sort', e.target.value)}
            className="h-10 rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        {hasFilters && (
          <div className="sm:col-span-2 lg:col-span-5">
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          </div>
        )}
      </div>

      {isError && (
        <div role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          {extractErrorMessage(error, 'Could not load recipes')}
        </div>
      )}

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <RecipeCardSkeleton key={i} />
          ))}
        </div>
      ) : data && data.items.length > 0 ? (
        <>
          <div
            className={cn(
              'grid gap-4 sm:grid-cols-2 lg:grid-cols-3 transition-opacity',
              isFetching && 'opacity-70'
            )}
          >
            {data.items.map((recipe) => (
              <RecipeCard key={recipe.id} recipe={recipe} />
            ))}
          </div>

          {data.pages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => updateParam('page', String(page - 1))}
              >
                ← Prev
              </Button>
              <span className="text-sm text-gray-600">
                Page {page} of {data.pages}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= data.pages}
                onClick={() => updateParam('page', String(page + 1))}
              >
                Next →
              </Button>
            </div>
          )}
        </>
      ) : (
        <EmptyState
          title="No recipes yet"
          description={
            hasFilters
              ? 'Try clearing your filters or use a different search term.'
              : 'Be the first to add a recipe to MealMate.'
          }
          action={
            hasFilters ? (
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : (
              <Button
                type="button"
                onClick={() => setIsAddModalOpen(true)}
              >
                + New recipe
              </Button>
            )
          }
        />
      )}

      <AddRecipeModal
        open={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onOpenImport={() => setIsImportModalOpen(true)}
      />

      <RecipeImportModal
        open={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
      />
    </div>
  );
}
