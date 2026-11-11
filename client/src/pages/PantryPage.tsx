import { useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useUpdateProfile } from '@/hooks/useProfile';
import { extractErrorMessage } from '@/lib/api';
import { SmartPantryPaste } from '@/components/pantry/SmartPantryPaste';
import { FridgePhotoUploader } from '@/components/pantry/FridgePhotoUploader';
import { RagRecipeSuggester } from '@/components/pantry/RagRecipeSuggester';
import { PantryInventorySection } from '@/components/pantry/PantryInventorySection';
import { DietaryPreferencesSection } from '@/components/pantry/DietaryPreferencesSection';
import { AllergiesSection } from '@/components/pantry/AllergiesSection';
import { CookingHistorySection } from '@/components/pantry/CookingHistorySection';
import { usePageMetadata } from '@/hooks/usePageMetadata';
import type { PantryItem } from '@/types';

export function PantryPage() {
  usePageMetadata({
    title: 'Pantry Inventory & Shelf Life | MealMate',
    description:
      'Track pantry ingredients, monitor shelf life presets, and identify expiring goods to reduce household food waste and improve meal planning efficiency.',
  });

  const user = useAuthStore((s) => s.user);
  const update = useUpdateProfile();
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  if (!user) return null;

  function flashSaved() {
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
  }

  async function handleAddPantryItem(item: PantryItem) {
    if (!user) return;
    setError(null);
    const next = [...user.pantry, item];
    try {
      await update.mutateAsync({ pantry: next });
      flashSaved();
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not add pantry item'));
    }
  }

  async function handleRemovePantryItem(idx: number) {
    if (!user) return;
    setError(null);
    const next = user.pantry.filter((_, i) => i !== idx);
    try {
      await update.mutateAsync({ pantry: next });
      flashSaved();
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not remove item'));
    }
  }

  async function handleClearAllPantry() {
    if (!user) return;
    setError(null);
    try {
      await update.mutateAsync({ pantry: [] });
      flashSaved();
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not clear pantry'));
    }
  }

  async function handleAddTag(field: 'dietaryPreferences' | 'allergies', value: string) {
    if (!user) return;
    setError(null);
    const cleaned = value.trim().toLowerCase();
    if (!cleaned) return;
    const current = user[field] ?? [];
    if (current.some((v) => v.toLowerCase() === cleaned)) return;
    try {
      await update.mutateAsync({ [field]: [...current, cleaned] });
      flashSaved();
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not save preference'));
    }
  }

  async function handleRemoveTag(field: 'dietaryPreferences' | 'allergies', value: string) {
    if (!user) return;
    setError(null);
    const cleaned = value.trim().toLowerCase();
    const current = user[field] ?? [];
    const next = current.filter((v) => v.toLowerCase() !== cleaned);
    try {
      await update.mutateAsync({ [field]: next });
      flashSaved();
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not remove preference'));
    }
  }

  async function handleToggleTag(field: 'dietaryPreferences' | 'allergies', value: string) {
    if (!user) return;
    setError(null);
    const cleaned = value.trim().toLowerCase();
    if (!cleaned) return;
    const current = user[field] ?? [];
    const isPresent = current.some((v) => v.toLowerCase() === cleaned);
    const next = isPresent
      ? current.filter((v) => v.toLowerCase() !== cleaned)
      : [...current, cleaned];

    try {
      await update.mutateAsync({ [field]: next });
      flashSaved();
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not save preference'));
    }
  }

  return (
    <div className="space-y-7 pb-10">
      {/* ─── Page Header ─── */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <div>
          <h1 className="font-serif text-3xl font-bold text-ink">Pantry &amp; preferences</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Manage your kitchen inventory, dietary lifestyle, and allergen safety guardrails.
          </p>
        </div>
        {savedFlash && (
          <span className="inline-flex items-center rounded border border-line bg-canvas px-3 py-1 text-xs font-mono font-medium text-text animate-fadeIn">
            <span>Saved to profile</span>
          </span>
        )}
      </header>

      {/* ─── Informational Benefit Note (Calm & Minimal) ─── */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-line bg-card px-4 py-2.5 text-xs text-text-muted">
        <div>
          <span>
            <strong className="text-text">Pantry-first intelligence:</strong> Items in your pantry are automatically deducted from grocery lists and prioritized by our AI meal planner to minimize household food waste.
          </span>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded bg-canvas border border-terracotta px-4 py-3 text-sm text-terracotta">
          {error}
        </div>
      )}

      {/* ─── Smart Ingestion: AI Paste & Vision Photo Uploader ─── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SmartPantryPaste
          existing={user.pantry}
          onAdd={async (next) => {
            await update.mutateAsync({ pantry: next });
            flashSaved();
          }}
        />
        <FridgePhotoUploader
          existing={user.pantry}
          onAdd={async (next) => {
            await update.mutateAsync({ pantry: next });
            flashSaved();
          }}
        />
      </div>

      {/* ─── Zero-Waste Chef Expiry Alert ─── */}
      {(() => {
        const expiringSoon = user.pantry.filter((p) => {
          if (!p.expiresAt) return false;
          const daysLeft = (new Date(p.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
          return daysLeft <= 3 && daysLeft >= 0;
        });
        if (expiringSoon.length === 0) return null;
        return (
          <div className="rounded border border-line bg-canvas p-4 text-text flex flex-wrap items-center justify-between gap-3 animate-fadeIn">
            <div>
              <p className="font-serif font-bold text-sm text-text">
                Zero-Waste Alert: {expiringSoon.length} {expiringSoon.length === 1 ? 'item is' : 'items are'} nearing expiration
              </p>
              <p className="text-xs text-text-muted leading-relaxed mt-1">
                Use them up soon: <span className="font-semibold text-text">{expiringSoon.map((p) => p.ingredient).join(', ')}</span>.
                MealMate suggests prioritizing these in your next meal plan to eliminate household waste!
              </p>
            </div>
          </div>
        );
      })()}

      {/* ─── Redesigned "In Your Pantry" Section ─── */}
      <PantryInventorySection
        items={user.pantry}
        onAdd={handleAddPantryItem}
        onRemove={handleRemovePantryItem}
        onClearAll={handleClearAllPantry}
        isUpdating={update.isPending}
      />

      {/* ─── RAG Recipe Suggester ("What can I make with my pantry?") ─── */}
      <RagRecipeSuggester
        pantry={user.pantry}
        dietaryPreferences={user.dietaryPreferences ?? []}
        allergies={user.allergies ?? []}
      />

      {/* ─── Cooking History & Notes Log ─── */}
      <CookingHistorySection history={user.cookingHistory ?? []} />

      {/* ─── Redesigned Dietary Preferences & Allergies Grid ─── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <DietaryPreferencesSection
          preferences={user.dietaryPreferences ?? []}
          onToggle={(val) => handleToggleTag('dietaryPreferences', val)}
          onAdd={(val) => handleAddTag('dietaryPreferences', val)}
          onRemove={(val) => handleRemoveTag('dietaryPreferences', val)}
          isUpdating={update.isPending}
        />

        <AllergiesSection
          allergies={user.allergies ?? []}
          onToggle={(val) => handleToggleTag('allergies', val)}
          onAdd={(val) => handleAddTag('allergies', val)}
          onRemove={(val) => handleRemoveTag('allergies', val)}
          isUpdating={update.isPending}
        />
      </div>
    </div>
  );
}
