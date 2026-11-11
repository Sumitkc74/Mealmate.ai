import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useGroceryLists } from '@/hooks/useGrocery';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { usePageMetadata } from '@/hooks/usePageMetadata';

type GroceryListSortOption = 'newest' | 'oldest' | 'items-desc' | 'items-asc' | 'progress';

export function GroceryPage() {
  usePageMetadata({
    title: 'Grocery Lists & Shopping | MealMate',
    description:
      'Manage consolidated weekly shopping lists organized by supermarket aisle, pre-subtracted against ingredients already in stock in your pantry.',
  });

  const { data, isLoading } = useGroceryLists();
  const [listSort, setListSort] = useState<GroceryListSortOption>('newest');

  const sortedLists = useMemo(() => {
    if (!data) return [];
    const list = [...data];
    switch (listSort) {
      case 'newest':
        return list.sort(
          (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
        );
      case 'oldest':
        return list.sort(
          (a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
        );
      case 'items-desc':
        return list.sort((a, b) => b.items.length - a.items.length);
      case 'items-asc':
        return list.sort((a, b) => a.items.length - b.items.length);
      case 'progress':
        return list.sort((a, b) => {
          const pctA = a.items.length > 0 ? a.items.filter((i) => i.checked).length / a.items.length : 0;
          const pctB = b.items.length > 0 ? b.items.filter((i) => i.checked).length / b.items.length : 0;
          return pctB - pctA;
        });
      default:
        return list;
    }
  }, [data, listSort]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Grocery lists</h1>
          <p className="text-sm text-gray-600">Generated from your meal plans.</p>
        </div>
        {data && data.length > 1 && (
          <div className="flex items-center gap-2">
            <label htmlFor="grocery-list-sort" className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              Sort lists:
            </label>
            <select
              id="grocery-list-sort"
              value={listSort}
              onChange={(e) => setListSort(e.target.value as GroceryListSortOption)}
              className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition hover:border-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 cursor-pointer"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="items-desc">Most items</option>
              <option value="items-asc">Fewest items</option>
              <option value="progress">Highest progress</option>
            </select>
          </div>
        )}
      </header>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : !data || data.length === 0 ? (
        <EmptyState
          title="No grocery lists yet"
          description="Open the planner, fill some slots, and tap “Generate grocery list”."
          action={
            <Link
              to="/planner"
              className="inline-block rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
            >
              Go to planner
            </Link>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sortedLists.map((list) => {
            const total = list.items.length;
            const done = list.items.filter((i) => i.checked).length;
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            return (
              <Link
                key={list.id}
                to={`/grocery/${list.id}`}
                className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-brand-300 hover:shadow"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500">
                      {list.createdAt
                        ? new Date(list.createdAt).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })
                        : ''}
                    </p>
                    <h3 className="mt-0.5 font-semibold text-gray-900">
                      {total} item{total === 1 ? '' : 's'}
                    </h3>
                  </div>
                  <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
                    {pct}%
                  </span>
                </div>
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="h-full bg-brand-500 transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  {done} of {total} purchased
                </p>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
