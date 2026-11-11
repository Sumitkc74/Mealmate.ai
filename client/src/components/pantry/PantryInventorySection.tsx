import { useState, useMemo, type FormEvent } from 'react';
import type { PantryItem } from '@/types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export const PANTRY_CATEGORIES = [
  { id: 'all', label: 'All', emoji: '' },
  { id: 'produce', label: 'Produce', emoji: '', days: 5 },
  { id: 'dairy', label: 'Dairy', emoji: '', days: 7 },
  { id: 'meat', label: 'Meat & Poultry', emoji: '', days: 3 },
  { id: 'seafood', label: 'Seafood', emoji: '', days: 2 },
  { id: 'bakery', label: 'Bakery', emoji: '', days: 5 },
  { id: 'pantry', label: 'Pantry Staples', emoji: '', days: 90 },
  { id: 'frozen', label: 'Frozen', emoji: '', days: 180 },
  { id: 'other', label: 'Other', emoji: '', days: 14 },
] as const;

export const SHELF_LIFE_ESTIMATES: Record<string, number> = {
  produce: 5,
  dairy: 7,
  meat: 3,
  seafood: 2,
  bakery: 5,
  pantry: 90,
  frozen: 180,
  other: 14,
};

export const SHELF_LIFE_PRESETS = [
  { label: '+3 days', days: 3 },
  { label: '+7 days', days: 7 },
  { label: '+14 days', days: 14 },
  { label: '+30 days', days: 30 },
  { label: '+90 days', days: 90 },
] as const;

const COMMON_STAPLES = [
  { ingredient: 'olive oil', category: 'pantry', quantity: '1', unit: 'btl' },
  { ingredient: 'garlic', category: 'produce', quantity: '1', unit: 'head' },
  { ingredient: 'onion', category: 'produce', quantity: '2', unit: 'pcs' },
  { ingredient: 'eggs', category: 'dairy', quantity: '12', unit: 'pcs' },
  { ingredient: 'butter', category: 'dairy', quantity: '1', unit: 'block' },
  { ingredient: 'salt', category: 'pantry' },
  { ingredient: 'black pepper', category: 'pantry' },
  { ingredient: 'pasta', category: 'pantry', quantity: '500', unit: 'g' },
  { ingredient: 'rice', category: 'pantry', quantity: '1', unit: 'kg' },
  { ingredient: 'soy sauce', category: 'pantry' },
];

export function getCategoryMeta(category?: string) {
  const norm = (category || 'other').toLowerCase();
  const found = PANTRY_CATEGORIES.find((c) => c.id === norm);
  return found || { id: 'other', label: 'Other', emoji: '', days: 14 };
}

export function getFreshnessStatus(expiresAt?: string) {
  if (!expiresAt) return { status: 'stable', label: 'Stable', daysLeft: null };
  const diffMs = new Date(expiresAt).getTime() - Date.now();
  const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (daysLeft < 0) return { status: 'expired', label: 'Expired', daysLeft };
  if (daysLeft <= 3) return { status: 'expiring', label: `${daysLeft}d left`, daysLeft };
  return { status: 'fresh', label: `${daysLeft}d left`, daysLeft };
}

interface Props {
  items: PantryItem[];
  onAdd: (item: PantryItem) => Promise<void> | void;
  onRemove: (index: number) => Promise<void> | void;
  onClearAll?: () => Promise<void> | void;
  isUpdating?: boolean;
}

export function PantryInventorySection({
  items,
  onAdd,
  onRemove,
  onClearAll,
  isUpdating = false,
}: Props) {
  const [draft, setDraft] = useState({
    ingredient: '',
    quantity: '',
    unit: '',
    category: 'produce',
  });
  const [selectedPresetDays, setSelectedPresetDays] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [showOnlyExpiring, setShowOnlyExpiring] = useState(false);
  const [viewMode, setViewMode] = useState<'grouped' | 'list'>('grouped');
  const [confirmClear, setConfirmClear] = useState(false);

  // Compute summary stats & list of expiring/expired items
  const { stats, expiringItems } = useMemo(() => {
    let expiringCount = 0;
    const expiringList: PantryItem[] = [];
    for (const item of items) {
      const { status } = getFreshnessStatus(item.expiresAt);
      if (status === 'expiring' || status === 'expired') {
        expiringCount++;
        expiringList.push(item);
      }
    }
    return {
      stats: {
        total: items.length,
        expiring: expiringCount,
      },
      expiringItems: expiringList,
    };
  }, [items]);

  // Current effective shelf life days for draft
  const effectiveShelfLifeDays =
    selectedPresetDays ?? (SHELF_LIFE_ESTIMATES[draft.category] ?? 14);

  // Filter items by category & search query & expiring toggle
  const filteredItems = useMemo(() => {
    return items
      .map((item, originalIndex) => ({ item, originalIndex }))
      .filter(({ item }) => {
        if (showOnlyExpiring) {
          const { status } = getFreshnessStatus(item.expiresAt);
          if (status !== 'expiring' && status !== 'expired') return false;
        }

        if (selectedCategory !== 'all') {
          const itemCat = (item.category || 'other').toLowerCase();
          if (itemCat !== selectedCategory) return false;
        }

        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim();
          const matchName = item.ingredient.toLowerCase().includes(q);
          const matchCat = (item.category || '').toLowerCase().includes(q);
          if (!matchName && !matchCat) return false;
        }

        return true;
      });
  }, [items, selectedCategory, searchQuery, showOnlyExpiring]);

  // Group items by category
  const groupedItems = useMemo(() => {
    const groups: Record<string, { meta: ReturnType<typeof getCategoryMeta>; list: typeof filteredItems }> = {};
    for (const entry of filteredItems) {
      const cat = (entry.item.category || 'other').toLowerCase();
      if (!groups[cat]) {
        groups[cat] = {
          meta: getCategoryMeta(cat),
          list: [],
        };
      }
      groups[cat].list.push(entry);
    }
    return groups;
  }, [filteredItems]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const ingredient = draft.ingredient.trim().toLowerCase();
    if (!ingredient) return;

    const days = effectiveShelfLifeDays;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

    await onAdd({
      ingredient,
      quantity: draft.quantity.trim() || undefined,
      unit: draft.unit.trim().toLowerCase() || undefined,
      addedAt: new Date().toISOString(),
      expiresAt,
      category: draft.category,
    });

    setDraft({ ingredient: '', quantity: '', unit: '', category: draft.category });
    setSelectedPresetDays(null);
  };

  const handleAddStaple = async (staple: typeof COMMON_STAPLES[0]) => {
    const days = SHELF_LIFE_ESTIMATES[staple.category] ?? 14;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

    await onAdd({
      ingredient: staple.ingredient,
      quantity: staple.quantity,
      unit: staple.unit,
      category: staple.category,
      addedAt: new Date().toISOString(),
      expiresAt,
    });
  };

  return (
    <section aria-label="In your pantry" className="mm-card p-5 sm:p-6">
      {/* ─── Header: Clean & Typographic ─── */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-line pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-serif font-semibold text-text">In your pantry</h2>
            <span className="rounded border border-line bg-canvas px-2.5 py-0.5 text-xs font-mono text-text-muted">
              {stats.total} {stats.total === 1 ? 'item' : 'items'}
            </span>
            {stats.expiring > 0 && (
              <button
                type="button"
                onClick={() => setShowOnlyExpiring(!showOnlyExpiring)}
                className={`rounded px-2.5 py-0.5 text-[11px] font-mono transition border ${
                  showOnlyExpiring
                    ? 'bg-ink text-canvas border-ink font-semibold'
                    : 'bg-canvas text-terracotta border-line hover:border-terracotta'
                }`}
                title="Filter to items expiring soon"
              >
                {stats.expiring} expiring soon {showOnlyExpiring ? '(active)' : ''}
              </button>
            )}
          </div>
          <p className="mt-0.5 text-xs text-text-muted">
            Ingredients in stock at home: automatically deducted from shopping lists and prioritized by AI.
          </p>
        </div>

        {/* View mode toggle & clear all */}
        <div className="flex items-center gap-2 self-start sm:self-center">
          <div className="inline-flex rounded bg-canvas p-0.5 border border-line" role="group" aria-label="View mode">
            <button
              type="button"
              onClick={() => setViewMode('grouped')}
              className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                viewMode === 'grouped' ? 'bg-card text-text font-semibold' : 'text-text-muted hover:text-text'
              }`}
            >
              Grouped
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                viewMode === 'list' ? 'bg-card text-text font-semibold' : 'text-text-muted hover:text-text'
              }`}
            >
              List
            </button>
          </div>

          {items.length > 0 && onClearAll && (
            <div>
              {confirmClear ? (
                <div className="flex items-center gap-1 bg-canvas px-2 py-0.5 rounded border border-line text-xs">
                  <span className="text-[11px] text-terracotta">Clear all?</span>
                  <button
                    type="button"
                    onClick={async () => {
                      await onClearAll();
                      setConfirmClear(false);
                    }}
                    className="font-bold text-terracotta hover:underline px-1"
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClear(false)}
                    className="text-text-muted hover:text-text px-1"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmClear(true)}
                  className="text-xs text-text-muted hover:text-terracotta transition px-1"
                >
                  Clear all
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ─── Expiring Items Alert Banner ─── */}
      {stats.expiring > 0 && (
        <div className="mt-3.5 rounded border border-line bg-canvas p-3 text-xs text-text flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <div>
              <span className="font-semibold text-text">
                {stats.expiring} {stats.expiring === 1 ? 'item requires' : 'items require'} attention:
              </span>{' '}
              <span className="text-text-muted">
                {expiringItems.slice(0, 3).map((it) => it.ingredient).join(', ')}
                {expiringItems.length > 3 ? ` +${expiringItems.length - 3} more` : ''}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowOnlyExpiring(!showOnlyExpiring)}
            className="rounded border border-line bg-card hover:bg-canvas px-2.5 py-1 text-[11px] font-mono font-medium text-text transition-colors"
          >
            {showOnlyExpiring ? 'Show All Items' : 'Filter Expiring Items'}
          </button>
        </div>
      )}

      {/* ─── Search & Category Filter Bar ─── */}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Search */}
        <div className="relative flex-1 max-w-sm">
          <input
            type="text"
            placeholder="Search your pantry ingredients..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded border border-line bg-card py-1.5 pl-3 pr-7 text-xs text-text placeholder:text-text-muted focus:border-terracotta focus:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-2 text-xs text-text-muted hover:text-text font-mono"
              aria-label="Clear search"
            >
              Clear
            </button>
          )}
        </div>

        {/* Category Filter Chips */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-none">
          {PANTRY_CATEGORIES.map((cat) => {
            const count =
              cat.id === 'all'
                ? items.length
                : items.filter((it) => (it.category || 'other').toLowerCase() === cat.id).length;

            const isSelected = selectedCategory === cat.id;

            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => {
                  setSelectedCategory(cat.id);
                  setShowOnlyExpiring(false);
                }}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded px-2.5 py-1 text-xs transition border ${
                  isSelected
                    ? 'bg-ink text-canvas border-ink font-medium'
                    : 'bg-canvas text-text-muted hover:text-text border-line'
                }`}
              >
                <span>{cat.label}</span>
                <span className={`text-[10px] font-mono ${isSelected ? 'text-canvas/80' : 'text-text-muted'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── Add Input with Quick Shelf-Life Presets ─── */}
      <div className="mt-4 rounded border border-line bg-canvas p-3.5">
        <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            aria-label="Ingredient name"
            placeholder="Ingredient name (e.g. olive oil)..."
            value={draft.ingredient}
            onChange={(e) => setDraft((d) => ({ ...d, ingredient: e.target.value }))}
            required
            className="bg-card text-xs flex-1 h-9"
          />
          <Input
            aria-label="Quantity"
            placeholder="Qty"
            value={draft.quantity}
            onChange={(e) => setDraft((d) => ({ ...d, quantity: e.target.value }))}
            className="bg-card text-xs sm:w-20 h-9"
          />
          <Input
            aria-label="Unit"
            placeholder="Unit"
            value={draft.unit}
            onChange={(e) => setDraft((d) => ({ ...d, unit: e.target.value }))}
            className="bg-card text-xs sm:w-24 h-9"
          />
          <select
            aria-label="Category"
            value={draft.category}
            onChange={(e) => {
              setDraft((d) => ({ ...d, category: e.target.value }));
              setSelectedPresetDays(null);
            }}
            className="h-9 rounded border border-line bg-card px-2.5 text-xs text-text focus:border-terracotta focus:outline-none"
          >
            <option value="produce">Produce</option>
            <option value="dairy">Dairy</option>
            <option value="meat">Meat</option>
            <option value="seafood">Seafood</option>
            <option value="bakery">Bakery</option>
            <option value="pantry">Pantry</option>
            <option value="frozen">Frozen</option>
            <option value="other">Other</option>
          </select>
          <Button type="submit" loading={isUpdating} className="h-9 px-4 text-xs shrink-0 bg-ink hover:bg-terracotta text-canvas">
            + Add
          </Button>
        </form>

        {/* Shelf-Life Presets */}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs border-t border-line/50 pt-2">
          <span className="text-ink-mute text-[11px] font-medium mr-1">Shelf-life preset:</span>
          {SHELF_LIFE_PRESETS.map((preset) => {
            const isSelected = effectiveShelfLifeDays === preset.days;
            return (
              <button
                key={preset.days}
                type="button"
                onClick={() => setSelectedPresetDays(preset.days)}
                className={`rounded-md px-2 py-0.5 text-[11px] transition border ${
                  isSelected
                    ? 'bg-brand-700 text-white border-brand-700 font-semibold shadow-2xs'
                    : 'bg-card text-ink-soft border-line hover:border-brand-300'
                }`}
              >
                {preset.label}
              </button>
            );
          })}
          <span className="text-[10px] text-ink-mute ml-auto">
            Expires in {effectiveShelfLifeDays} days
          </span>
        </div>

        {/* Quick staple shortcuts */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-ink-mute text-[11px] font-medium mr-1">Quick add staples:</span>
          {COMMON_STAPLES.slice(0, 7).map((s) => {
            const hasIt = items.some((it) => it.ingredient.toLowerCase() === s.ingredient.toLowerCase());
            if (hasIt) return null;
            return (
              <button
                key={s.ingredient}
                type="button"
                onClick={() => handleAddStaple(s)}
                className="inline-flex items-center gap-0.5 rounded-full bg-card px-2 py-0.5 text-[11px] text-ink-soft border border-line hover:border-brand-300 hover:text-brand-800 transition"
              >
                <span>+</span>
                <span className="capitalize">{s.ingredient}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── Items Display: Clean Interactive Chips Grouped by Category ─── */}
      <div className="mt-5">
        {items.length === 0 ? (
          <div className="rounded border border-dashed border-line bg-canvas p-8 text-center text-xs text-text-muted">
            <p className="font-serif font-medium text-text text-sm">Your pantry is currently empty</p>
            <p className="mt-1 text-text-muted max-w-sm mx-auto">
              Add your everyday ingredients or click the quick staple buttons above to get started.
            </p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="rounded border border-line bg-canvas p-6 text-center text-xs text-text-muted">
            <p>No pantry items match your current search.</p>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setSelectedCategory('all');
                setShowOnlyExpiring(false);
              }}
              className="mt-1 text-terracotta underline"
            >
              Reset filters
            </button>
          </div>
        ) : viewMode === 'grouped' ? (
          /* ─── Clean Modern Chips Grouped by Category ─── */
          <div className="space-y-4">
            {Object.entries(groupedItems).map(([catKey, { meta, list }]) => (
              <div key={catKey} className="rounded border border-line bg-card p-3.5">
                {/* Category Header */}
                <div className="mb-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <h3 className="font-serif text-xs font-semibold text-text uppercase tracking-wider">
                      {meta.label}
                    </h3>
                  </div>
                  <span className="text-[10px] font-mono text-text-muted">
                    {list.length} {list.length === 1 ? 'item' : 'items'}
                  </span>
                </div>

                {/* Interactive Chips Container */}
                <div className="flex flex-wrap gap-2">
                  {list.map(({ item, originalIndex }) => {
                    const freshness = getFreshnessStatus(item.expiresAt);

                    return (
                      <span
                        key={`${item.ingredient}-${originalIndex}`}
                        className={`group inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition border ${
                          freshness.status === 'expired'
                            ? 'bg-red-50/90 text-red-900 border-red-200 shadow-2xs'
                            : freshness.status === 'expiring'
                            ? 'bg-amber-50/90 text-amber-900 border-amber-200 shadow-2xs'
                            : 'bg-canvas-soft text-ink border-line hover:border-brand-300'
                        }`}
                      >
                        {/* Freshness Status Dot */}
                        {freshness.status === 'expired' ? (
                          <span className="h-1.5 w-1.5 rounded-full bg-red-500" title="Expired" />
                        ) : freshness.status === 'expiring' ? (
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" title={`${freshness.daysLeft}d left`} />
                        ) : null}

                        {/* Ingredient Name */}
                        <span className="font-medium capitalize">{item.ingredient}</span>

                        {/* Subtle Quantity Pill */}
                        {item.quantity && (
                          <span className="rounded bg-black/5 px-1 py-0.2 text-[10px] font-normal text-ink-soft">
                            {item.quantity} {item.unit || ''}
                          </span>
                        )}

                        {/* Expiry subtle text if expiring or expired */}
                        {freshness.status === 'expired' ? (
                          <span className="rounded-full bg-red-100 text-red-800 px-1.5 py-0.2 text-[10px] font-bold">
                            Expired
                          </span>
                        ) : freshness.status === 'expiring' ? (
                          <span className="rounded-full bg-amber-100 text-amber-800 px-1.5 py-0.2 text-[10px] font-bold">
                            {freshness.daysLeft}d left
                          </span>
                        ) : freshness.daysLeft !== null ? (
                          <span className="text-[10px] text-ink-mute">
                            · {freshness.daysLeft}d
                          </span>
                        ) : null}

                        {/* Remove Action Button */}
                        <button
                          type="button"
                          onClick={() => onRemove(originalIndex)}
                          aria-label={`Remove ${item.ingredient}`}
                          className="ml-1 rounded px-1 text-text-muted hover:text-terracotta hover:bg-canvas transition font-mono text-xs"
                        >
                          ×
                        </button>
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* ─── Sleek Minimalist Table List ─── */
          <div className="overflow-hidden rounded border border-line bg-card">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-line bg-canvas/60 text-[11px] font-mono text-text-muted">
                <tr>
                  <th scope="col" className="px-4 py-2">Ingredient</th>
                  <th scope="col" className="px-3 py-2">Category</th>
                  <th scope="col" className="px-3 py-2">Quantity</th>
                  <th scope="col" className="px-3 py-2">Freshness Status</th>
                  <th scope="col" className="px-3 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/40">
                {filteredItems.map(({ item, originalIndex }) => {
                  const meta = getCategoryMeta(item.category);
                  const freshness = getFreshnessStatus(item.expiresAt);

                  return (
                    <tr key={`${item.ingredient}-${originalIndex}`} className="hover:bg-canvas/30 transition">
                      <td className="px-4 py-2 font-medium text-text capitalize">
                        {item.ingredient}
                      </td>
                      <td className="px-3 py-2 text-text-muted">
                        <span className="capitalize">{meta.label}</span>
                      </td>
                      <td className="px-3 py-2 text-text-muted font-mono">
                        {item.quantity ? `${item.quantity} ${item.unit || ''}` : '-'}
                      </td>
                      <td className="px-3 py-2 font-mono">
                        {freshness.status === 'expired' ? (
                          <span className="rounded bg-canvas border border-terracotta px-1.5 py-0.5 text-[10px] text-terracotta">
                            Expired
                          </span>
                        ) : freshness.status === 'expiring' ? (
                          <span className="rounded bg-canvas border border-line px-1.5 py-0.5 text-[10px] text-terracotta">
                            {freshness.daysLeft}d left
                          </span>
                        ) : (
                          <span className="text-text-muted text-[11px]">Fresh</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => onRemove(originalIndex)}
                          aria-label={`Remove ${item.ingredient}`}
                          className="text-text-muted hover:text-terracotta px-2 py-0.5 font-mono text-xs rounded hover:bg-canvas"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
