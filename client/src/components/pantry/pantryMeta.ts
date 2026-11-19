/**
 * Pantry metadata shared by the Pantry Inventory section: category list,
 * shelf-life estimates, expiry presets, and the helpers that derive
 * category/freshness display info from them.
 * Kept in its own module (no components here) so the section file only
 * exports its component — see react-refresh/only-export-components.
 */

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
