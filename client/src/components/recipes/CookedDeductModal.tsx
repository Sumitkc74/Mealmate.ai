import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/stores/authStore';
import { useUpdateProfile } from '@/hooks/useProfile';
import { Link } from 'react-router-dom';
import type { CookingHistoryEntry } from '@/types';

interface CookedDeductModalProps {
  isOpen: boolean;
  onClose: () => void;
  recipeId: string;
  recipeTitle: string;
  recipeIngredients: Array<{ name: string; quantity?: number; unit?: string }>;
  servingsCooked?: number;
  onDeducted?: (count: number) => void;
}

function normalizeIng(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/^(fresh|dry|dried|chopped|diced|sliced|minced|grated|crushed)\s+/g, '')
    .replace(/(s|es)$/g, ''); // simple plural strip
}

export function CookedDeductModal({
  isOpen,
  onClose,
  recipeId,
  recipeTitle,
  recipeIngredients,
  servingsCooked = 2,
  onDeducted,
}: CookedDeductModalProps) {
  const user = useAuthStore((s) => s.user);
  const updateProfile = useUpdateProfile();

  const [rating, setRating] = useState<number>(5);
  const [notes, setNotes] = useState<string>('');

  // Match recipe ingredients against pantry items
  const { matchedItems, missingIngredients } = useMemo(() => {
    if (!user || !user.pantry || user.pantry.length === 0) {
      return { matchedItems: [], missingIngredients: recipeIngredients };
    }

    const matched: Array<{
      pantryIndex: number;
      pantryName: string;
      recipeName: string;
      quantity?: string;
      unit?: string;
    }> = [];
    const matchedRecipeIndices = new Set<number>();

    user.pantry.forEach((pItem, pIdx) => {
      const pNorm = normalizeIng(pItem.ingredient);
      recipeIngredients.forEach((rItem, rIdx) => {
        const rNorm = normalizeIng(rItem.name);
        if (pNorm.includes(rNorm) || rNorm.includes(pNorm)) {
          matched.push({
            pantryIndex: pIdx,
            pantryName: pItem.ingredient,
            recipeName: rItem.name,
            quantity: pItem.quantity,
            unit: pItem.unit,
          });
          matchedRecipeIndices.add(rIdx);
        }
      });
    });

    const missing = recipeIngredients.filter((_, idx) => !matchedRecipeIndices.has(idx));
    return { matchedItems: matched, missingIngredients: missing };
  }, [user, recipeIngredients]);

  // Selected pantry item indices to deduct (default: all matched)
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(() => {
    return new Set(matchedItems.map((m) => m.pantryIndex));
  });

  // Re-sync selected items when matched items change
  useMemo(() => {
    setSelectedIndices(new Set(matchedItems.map((m) => m.pantryIndex)));
  }, [matchedItems]);

  if (!isOpen) return null;

  function toggleIndex(idx: number) {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  }

  async function handleConfirm(deductPantry: boolean) {
    if (!user) return;

    let remainingPantry = [...user.pantry];
    let deductedCount = 0;

    if (deductPantry && selectedIndices.size > 0) {
      remainingPantry = user.pantry.filter((_, idx) => !selectedIndices.has(idx));
      deductedCount = selectedIndices.size;
    }

    const newHistoryEntry: CookingHistoryEntry = {
      recipeId,
      recipeTitle,
      cookedAt: new Date().toISOString(),
      servingsCooked,
      rating: rating > 0 ? rating : undefined,
      notes: notes.trim() ? notes.trim() : undefined,
    };

    const nextHistory = [...(user.cookingHistory || []), newHistoryEntry];

    await updateProfile.mutateAsync({
      pantry: remainingPantry,
      cookingHistory: nextHistory,
    });

    if (onDeducted) {
      onDeducted(deductedCount);
    }
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cooked-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/50"
    >
      <div className="relative w-full max-w-lg rounded-lg bg-card p-6 border border-line max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line pb-4">
          <div>
            <h2 id="cooked-modal-title" className="font-serif text-lg font-bold text-text">
              I Cooked This Recipe!
            </h2>
            <p className="text-xs text-text-muted mt-0.5">
              Log cooking and update your pantry for <span className="font-medium text-text">{recipeTitle}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-text-muted hover:text-text font-mono text-xs"
            aria-label="Close"
          >
            Close
          </button>
        </div>

        {/* Body */}
        <div className="py-4 space-y-4">
          {!user ? (
            <div className="p-4 rounded border border-line bg-canvas text-center space-y-3">
              <p className="text-sm text-text-muted">
                Sign in to log your cooking history and automatically deduct ingredients from your pantry!
              </p>
              <Link to="/login">
                <Button size="sm">Sign In</Button>
              </Link>
            </div>
          ) : (
            <>
              {/* Rating & Notes Card */}
              <div className="rounded border border-line bg-canvas p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-text">
                    Rate this meal:
                  </span>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setRating(star)}
                        className={`px-2 py-0.5 rounded text-xs font-mono border transition-colors ${
                          star <= rating
                            ? 'bg-ink text-canvas border-ink'
                            : 'bg-card text-text-muted border-line hover:border-text-muted'
                        }`}
                        aria-label={`Rate ${star} stars`}
                      >
                        {star}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-medium text-text-muted block mb-1">
                    Personal Chef Notes (optional)
                  </label>
                  <textarea
                    rows={2}
                    placeholder="e.g. Added extra garlic, cooked 2 mins less. Family loved it!"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full rounded border border-line bg-card p-2 text-xs text-text placeholder:text-text-muted focus:outline-none focus:border-terracotta"
                  />
                </div>
              </div>

              {/* Matched Pantry Items */}
              {matchedItems.length > 0 ? (
                <div className="rounded border border-line bg-canvas p-3.5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-mono font-semibold uppercase tracking-wider text-text">
                      Pantry Items Used ({matchedItems.length})
                    </h3>
                    <button
                      type="button"
                      onClick={() => {
                        if (selectedIndices.size === matchedItems.length) {
                          setSelectedIndices(new Set());
                        } else {
                          setSelectedIndices(new Set(matchedItems.map((m) => m.pantryIndex)));
                        }
                      }}
                      className="text-[11px] font-medium text-terracotta hover:underline"
                    >
                      {selectedIndices.size === matchedItems.length ? 'Deselect All' : 'Select All'}
                    </button>
                  </div>
                  <p className="text-xs text-text-muted mt-1">
                    Selected items will be deducted from your pantry inventory.
                  </p>

                  <div className="mt-3 space-y-1.5 max-h-40 overflow-y-auto">
                    {matchedItems.map((m) => {
                      const isChecked = selectedIndices.has(m.pantryIndex);
                      return (
                        <label
                          key={m.pantryIndex}
                          className={`flex items-center justify-between p-2 rounded cursor-pointer border text-xs ${
                            isChecked
                              ? 'bg-card border-terracotta text-text'
                              : 'bg-card/40 border-line text-text-muted opacity-60'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleIndex(m.pantryIndex)}
                              className="rounded border-line text-terracotta focus:ring-terracotta"
                            />
                            <span className="font-medium capitalize">
                              {m.pantryName}
                            </span>
                          </div>
                          {m.quantity && (
                            <span className="text-[11px] font-mono text-text-muted">
                              {m.quantity} {m.unit || ''}
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="rounded border border-line bg-canvas p-4 text-center space-y-1.5">
                  <p className="text-xs font-medium text-text">
                    No matching ingredients currently in your pantry.
                  </p>
                  <p className="text-[11px] text-text-muted">
                    Your cooking session will still be logged to your cooking history.
                  </p>
                </div>
              )}

              {missingIngredients.length > 0 && matchedItems.length > 0 && (
                <div className="rounded border border-line bg-canvas p-2.5">
                  <h4 className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
                    Other Ingredients (Not in Pantry)
                  </h4>
                  <p className="text-xs text-text-muted mt-0.5">
                    {missingIngredients.map((i) => i.name).join(', ')}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-line pt-4 flex items-center justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>

          {user && (
            <>
              {matchedItems.length > 0 && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  loading={updateProfile.isPending}
                  onClick={() => handleConfirm(false)}
                >
                  Log Without Deducting
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                loading={updateProfile.isPending}
                onClick={() => handleConfirm(matchedItems.length > 0)}
                disabled={matchedItems.length > 0 && selectedIndices.size === 0}
                className="bg-ink hover:bg-terracotta text-canvas"
              >
                {matchedItems.length > 0
                  ? `Deduct ${selectedIndices.size} Items & Log`
                  : 'Log to Cooking History'}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
