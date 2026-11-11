import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  useDeleteGroceryList,
  useGroceryList,
  useUpdateGroceryItem,
  useTransferToPantry,
} from '@/hooks/useGrocery';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ExportGroceryPdfButton } from '@/components/grocery/ExportGroceryPdfButton';
import { extractErrorMessage } from '@/lib/api';
import { usePageMetadata } from '@/hooks/usePageMetadata';
import type { GroceryCategory, GroceryItem } from '@/types';
import { cn } from '@/lib/cn';

const CATEGORY_LABELS: Record<GroceryCategory, { label: string; icon: string }> = {
  produce: { label: 'Produce', icon: '' },
  dairy: { label: 'Dairy', icon: '' },
  meat: { label: 'Meat', icon: '' },
  seafood: { label: 'Seafood', icon: '' },
  bakery: { label: 'Bakery', icon: '' },
  pantry: { label: 'Pantry', icon: '' },
  frozen: { label: 'Frozen', icon: '' },
  beverages: { label: 'Beverages', icon: '' },
  snacks: { label: 'Snacks', icon: '' },
  spices: { label: 'Spices', icon: '' },
  other: { label: 'Other', icon: '' },
};

const CATEGORY_ORDER: GroceryCategory[] = [
  'produce',
  'meat',
  'seafood',
  'dairy',
  'bakery',
  'pantry',
  'frozen',
  'beverages',
  'snacks',
  'spices',
  'other',
];

export type GrocerySortOption =
  | 'category'
  | 'name-asc'
  | 'name-desc'
  | 'status'
  | 'quantity-desc'
  | 'default';

function compareGroceryItems(a: GroceryItem, b: GroceryItem, sortBy: GrocerySortOption): number {
  switch (sortBy) {
    case 'name-asc':
      return a.ingredient.localeCompare(b.ingredient, undefined, { sensitivity: 'base' });
    case 'name-desc':
      return b.ingredient.localeCompare(a.ingredient, undefined, { sensitivity: 'base' });
    case 'status': {
      if (a.checked !== b.checked) {
        return a.checked ? 1 : -1;
      }
      return a.ingredient.localeCompare(b.ingredient, undefined, { sensitivity: 'base' });
    }
    case 'quantity-desc': {
      const qA = typeof a.quantity === 'number' ? a.quantity : 0;
      const qB = typeof b.quantity === 'number' ? b.quantity : 0;
      if (qB !== qA) return qB - qA;
      return a.ingredient.localeCompare(b.ingredient, undefined, { sensitivity: 'base' });
    }
    case 'category': {
      const idxA = CATEGORY_ORDER.indexOf(a.category);
      const idxB = CATEGORY_ORDER.indexOf(b.category);
      const diff = (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
      if (diff !== 0) return diff;
      return a.ingredient.localeCompare(b.ingredient, undefined, { sensitivity: 'base' });
    }
    case 'default':
    default:
      return 0;
  }
}

interface GroceryItemRowProps {
  item: GroceryItem;
  onToggle: (item: GroceryItem) => void;
  showCategoryBadge?: boolean;
}

function GroceryItemRow({ item, onToggle, showCategoryBadge = false }: GroceryItemRowProps) {
  const meta = CATEGORY_LABELS[item.category] ?? { label: item.category, icon: '' };
  return (
    <li
      key={item._id}
      className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-2.5 last:border-b-0 hover:bg-gray-50/60 transition-colors"
    >
      <label className="flex flex-1 items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={item.checked}
          onChange={() => onToggle(item)}
          className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
        />
        <span className="flex flex-1 flex-col gap-1">
          <span className="flex items-center gap-2 flex-wrap">
            <span
              className={cn(
                'capitalize font-medium transition',
                item.checked ? 'text-gray-400 line-through' : 'text-gray-900'
              )}
            >
              {item.ingredient}
            </span>
            {showCategoryBadge && (
              <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                <span aria-hidden>{meta.icon}</span>
                <span>{meta.label}</span>
              </span>
            )}
          </span>
          {item.sources && item.sources.length > 0 && (
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] uppercase tracking-wide text-gray-400">
                for
              </span>
              {item.sources.map((s, idx) => {
                const qty =
                  s.quantity && s.unit
                    ? `${Math.round(s.quantity * 10) / 10} ${s.unit}`
                    : s.quantity
                      ? String(Math.round(s.quantity * 10) / 10)
                      : null;
                const chipClasses = cn(
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition',
                  item.checked
                    ? 'bg-gray-100 text-gray-400'
                    : 'bg-brand-50 text-brand-700 hover:bg-brand-100'
                );
                const content = (
                  <>
                    <span className="truncate max-w-[16ch]">{s.title}</span>
                    {qty && <span className="text-brand-500/80">· {qty}</span>}
                  </>
                );
                return s.recipe && !item.checked ? (
                  <Link
                    key={`${s.recipe}-${idx}`}
                    to={`/recipes/${s.recipe}`}
                    className={chipClasses}
                    title={`Open ${s.title}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {content}
                  </Link>
                ) : (
                  <span
                    key={`${s.title}-${idx}`}
                    className={chipClasses}
                    title={s.title}
                  >
                    {content}
                  </span>
                );
              })}
            </span>
          )}
        </span>
      </label>
      <span className="shrink-0 pt-0.5 text-sm font-medium text-gray-600">
        {item.quantity ?? ''}
        {item.unit ? ` ${item.unit}` : ''}
      </span>
    </li>
  );
}

export function GroceryDetailPage() {
  usePageMetadata({
    title: 'Shopping Checklist | MealMate',
    description:
      'Check off grocery items by supermarket aisle in real time, export printable PDF checklists, and update your household pantry automatically on MealMate.',
  });

  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: list, isLoading, isError, error } = useGroceryList(id);
  const update = useUpdateGroceryItem();
  const del = useDeleteGroceryList();
  const transfer = useTransferToPantry();

  const [sortBy, setSortBy] = useState<GrocerySortOption>(() => {
    try {
      return (localStorage.getItem('mealmate_grocery_sort') as GrocerySortOption) || 'category';
    } catch {
      return 'category';
    }
  });

  const [groupByCategory, setGroupByCategory] = useState<boolean>(() => {
    try {
      return localStorage.getItem('mealmate_grocery_group') !== 'false';
    } catch {
      return true;
    }
  });

  const [hideChecked, setHideChecked] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [transferMsg, setTransferMsg] = useState<string | null>(null);

  async function handleTransfer() {
    if (!id) return;
    try {
      const res = await transfer.mutateAsync(id);
      setTransferMsg(res.message || 'Transferred checked items to your pantry!');
      setTimeout(() => setTransferMsg(null), 5000);
    } catch (err) {
      alert(extractErrorMessage(err, 'Failed to transfer items to pantry'));
    }
  }

  const filteredItems = useMemo(() => {
    if (!list?.items) return [];
    let items = list.items;
    if (hideChecked) {
      items = items.filter((i) => !i.checked);
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      items = items.filter(
        (i) =>
          i.ingredient.toLowerCase().includes(q) ||
          i.sources?.some((s) => s.title.toLowerCase().includes(q))
      );
    }
    return items;
  }, [list?.items, hideChecked, searchQuery]);

  const flatSortedItems = useMemo(() => {
    return [...filteredItems].sort((a, b) => compareGroceryItems(a, b, sortBy));
  }, [filteredItems, sortBy]);

  const grouped = useMemo(() => {
    const map = new Map<GroceryCategory, GroceryItem[]>();
    for (const item of filteredItems) {
      const existing = map.get(item.category) ?? [];
      existing.push(item);
      map.set(item.category, existing);
    }
    return CATEGORY_ORDER.filter((c) => map.has(c)).map((c) => ({
      category: c,
      items: (map.get(c) ?? []).sort((a, b) => compareGroceryItems(a, b, sortBy)),
    }));
  }, [filteredItems, sortBy]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-1/2" />
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (isError || !list || !id) {
    return (
      <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
        {extractErrorMessage(error, 'Grocery list not found')}
        <div className="mt-2">
          <Link to="/grocery" className="font-medium text-red-800 underline">
            ← Back to grocery lists
          </Link>
        </div>
      </div>
    );
  }

  const total = list.items.length;
  const done = list.items.filter((it) => it.checked).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  function toggle(item: GroceryItem) {
    if (!id) return;
    update.mutate({ listId: id, itemId: item._id, patch: { checked: !item.checked } });
  }

  async function handleDelete() {
    if (!list) return;
    if (!confirm('Delete this grocery list?')) return;
    try {
      await del.mutateAsync(list.id);
      navigate('/grocery', { replace: true });
    } catch (err) {
      alert(extractErrorMessage(err, 'Could not delete list'));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link to="/grocery" className="text-sm text-brand-700 hover:underline">
          ← All grocery lists
        </Link>
      </div>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Grocery list</h1>
          <p className="text-sm text-gray-600">
            {done} of {total} items purchased ({pct}%)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {done > 0 && (
            <Button
              variant="secondary"
              size="sm"
              loading={transfer.isPending}
              onClick={handleTransfer}
              title="Add all checked items into your pantry with smart shelf-life expiration dates"
            >
              Add {done} to Pantry
            </Button>
          )}
          <ExportGroceryPdfButton items={flatSortedItems} title="Grocery list" />
          <Button variant="danger" size="sm" loading={del.isPending} onClick={handleDelete}>
            Delete
          </Button>
        </div>
      </header>

      {transferMsg && (
        <div className="flex items-center justify-between rounded border border-line bg-canvas p-4 text-sm text-text animate-fadeIn">
          <div className="flex items-center gap-2">
            <span>{transferMsg}</span>
          </div>
          <Link to="/pantry" className="font-semibold text-terracotta underline hover:text-ink">
            View in Pantry
          </Link>
        </div>
      )}

      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
        <div className="h-full bg-brand-500 transition-all" style={{ width: `${pct}%` }} />
      </div>

      {/* Controls: Sorting, Grouping, Filter */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-3.5 shadow-sm">
        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
          <div className="flex items-center gap-2">
            <label htmlFor="grocery-sort" className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              Sort items:
            </label>
            <select
              id="grocery-sort"
              value={sortBy}
              onChange={(e) => {
                const val = e.target.value as GrocerySortOption;
                setSortBy(val);
                try {
                  localStorage.setItem('mealmate_grocery_sort', val);
                } catch {}
              }}
              className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition hover:border-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 cursor-pointer"
            >
              <option value="category">Category (Aisle Order)</option>
              <option value="name-asc">Item Name (A → Z)</option>
              <option value="name-desc">Item Name (Z → A)</option>
              <option value="status">Status (Unchecked First)</option>
              <option value="quantity-desc">Quantity (High to Low)</option>
              <option value="default">Original / Added Order</option>
            </select>
          </div>

          <div className="hidden h-4 w-px bg-gray-200 sm:block" />

          <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={groupByCategory}
              onChange={(e) => {
                const val = e.target.checked;
                setGroupByCategory(val);
                try {
                  localStorage.setItem('mealmate_grocery_group', String(val));
                } catch {}
              }}
              className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
            />
            <span className="font-medium">Group by category</span>
          </label>

          <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={hideChecked}
              onChange={(e) => setHideChecked(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
            />
            <span className="font-medium">Hide checked</span>
          </label>
        </div>

        <div className="relative w-full sm:w-60">
          <input
            type="text"
            placeholder="Search items..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search grocery items"
            className="w-full rounded border border-line bg-card px-3 pr-7 py-1.5 text-xs text-text placeholder:text-text-muted focus:border-terracotta focus:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text px-1 py-0.5 text-xs font-mono"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {total === 0 ? (
        <EmptyState
          title="This grocery list is empty"
          description="Add items manually using the input above or generate ingredients from your weekly meal planner."
          action={
            <Link
              to="/planner"
              className="inline-block rounded-md bg-ink px-4 py-2 text-xs font-semibold text-canvas hover:bg-terracotta transition-colors"
            >
              Open weekly planner
            </Link>
          }
        />
      ) : filteredItems.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          <p className="font-semibold text-gray-800">No items match your active filters.</p>
          <p className="mt-1 text-gray-500">Try adjusting your search query or unchecking &quot;Hide checked&quot;.</p>
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="mt-3 inline-block rounded-md bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-200"
            >
              Clear search
            </button>
          )}
        </div>
      ) : groupByCategory ? (
        <div className="space-y-5">
          {grouped.map(({ category, items }) => {
            if (items.length === 0) return null;
            const meta = CATEGORY_LABELS[category];
            const categoryChecked = items.filter((i) => i.checked).length;
            return (
              <section
                key={category}
                className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
              >
                <header className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-2.5">
                  <h2 className="text-sm font-semibold text-gray-700">
                    <span aria-hidden className="mr-1.5">
                      {meta.icon}
                    </span>
                    {meta.label}
                  </h2>
                  <span className="text-xs font-medium text-gray-500">
                    {categoryChecked}/{items.length}
                  </span>
                </header>
                <ul>
                  {items.map((item) => (
                    <GroceryItemRow
                      key={item._id}
                      item={item}
                      onToggle={toggle}
                      showCategoryBadge={false}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      ) : (
        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <header className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-gray-700">
              All Items ({flatSortedItems.length})
            </h2>
            <span className="text-xs font-medium text-gray-500">
              {flatSortedItems.filter((i) => i.checked).length}/{flatSortedItems.length} purchased
            </span>
          </header>
          <ul>
            {flatSortedItems.map((item) => (
              <GroceryItemRow
                key={item._id}
                item={item}
                onToggle={toggle}
                showCategoryBadge={true}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
