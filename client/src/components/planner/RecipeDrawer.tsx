import { useMemo, useState } from 'react';
import { useRecipes } from '@/hooks/useRecipes';
import { useGuestStore } from '@/stores/guestStore';
import { useDebounce } from '@/hooks/useDebounce';
import { Input } from '@/components/ui/Input';
import { DraggableRecipe } from './DraggableRecipe';
import { Skeleton } from '@/components/ui/Skeleton';

export function RecipeDrawer() {
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search, 300);
  const { data, isLoading } = useRecipes({ q: debounced || undefined, limit: 25, page: 1 });

  // Guest recipes (saved in this browser) are merged above the library,
  // filtered by the same search.
  const guestRecipes = useGuestStore((s) => s.recipes);
  const matchingGuests = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    return guestRecipes.filter((r) => {
      if (!q) return true;
      const hay = `${r.title} ${r.cuisine ?? ''} ${(r.tags ?? []).join(' ')}`.toLowerCase();
      return hay.includes(q);
    });
  }, [guestRecipes, debounced]);

  const hasAny = matchingGuests.length > 0 || (data?.items.length ?? 0) > 0;

  return (
    <aside className="flex h-full flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
        Recipe library
      </h2>
      <p className="mt-0.5 text-xs text-gray-400">Drag a recipe into a slot →</p>

      <div className="mt-3">
        <Input
          aria-label="Search recipes"
          placeholder="Search recipes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="mt-3 flex-1 space-y-2 overflow-y-auto pr-1">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)
        ) : !hasAny ? (
          <p className="rounded-md bg-gray-50 p-3 text-center text-xs text-gray-500">
            No recipes match your search.
          </p>
        ) : (
          <>
            {matchingGuests.length > 0 && (
              <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                Saved in this browser
              </p>
            )}
            {matchingGuests.map((r) => (
              <DraggableRecipe key={r.id} recipe={r} />
            ))}
            {data?.items.map((r) => <DraggableRecipe key={r.id} recipe={r} />)}
          </>
        )}
      </div>
    </aside>
  );
}
