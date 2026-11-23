import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useGuestStore } from '@/stores/guestStore';
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
  const isAuthed = Boolean(user);
  const update = useUpdateProfile();
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  // Guests use the local guest store (browser only); signed-in users use
  // their profile. Cooking history stays account-only (recording a cook
  // needs an account).
  const guestPantry = useGuestStore((s) => s.pantry);
  const guestDietary = useGuestStore((s) => s.dietaryPreferences);
  const guestAllergies = useGuestStore((s) => s.allergies);
  const guestAddItem = useGuestStore((s) => s.addPantryItem);
  const guestRemoveItem = useGuestStore((s) => s.removePantryItem);
  const guestClearPantry = useGuestStore((s) => s.clearPantry);
  const guestAddTag = useGuestStore((s) => s.addTag);
  const guestRemoveTag = useGuestStore((s) => s.removeTag);
  const guestToggleTag = useGuestStore((s) => s.toggleTag);

  const pantry = isAuthed ? (user?.pantry ?? []) : guestPantry;
  const dietaryPreferences = isAuthed ? (user?.dietaryPreferences ?? []) : guestDietary;
  const allergies = isAuthed ? (user?.allergies ?? []) : guestAllergies;
  const cookingHistory = user?.cookingHistory ?? [];

  function flashSaved() {
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
  }

  async function handleAddPantryItem(item: PantryItem) {
    if (!user) {
      guestAddItem(item);
      flashSaved();
      return;
    }
    setError(null);
    try {
      // Guard: a freshly signed-in user may carry no pantry field yet
      // (auth responses used to return only id/name/email/role), and the
      // spread must live inside the try so a failure shows an error instead
      // of failing silently with the typed value left in the form.
      const next = [...(user.pantry ?? []), item];
      await update.mutateAsync({ pantry: next });
      flashSaved();
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not add pantry item'));
    }
  }

  async function handleRemovePantryItem(idx: number) {
    if (!user) {
      guestRemoveItem(idx);
      flashSaved();
      return;
    }
    setError(null);
    try {
      const next = (user.pantry ?? []).filter((_, i) => i !== idx);
      await update.mutateAsync({ pantry: next });
      flashSaved();
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not remove item'));
    }
  }

  async function handleClearAllPantry() {
    if (!user) {
      guestClearPantry();
      flashSaved();
      return;
    }
    setError(null);
    try {
      await update.mutateAsync({ pantry: [] });
      flashSaved();
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not clear pantry'));
    }
  }

  async function handleAddTag(field: 'dietaryPreferences' | 'allergies', value: string) {
    if (!user) {
      guestAddTag(field, value);
      flashSaved();
      return;
    }
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
    if (!user) {
      guestRemoveTag(field, value);
      flashSaved();
      return;
    }
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
    if (!user) {
      guestToggleTag(field, value);
      flashSaved();
      return;
    }
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
            <span>{isAuthed ? 'Saved to profile' : 'Saved in this browser'}</span>
          </span>
        )}
      </header>

      {!isAuthed && (
        <div className="rounded-md border border-line bg-card px-4 py-3 text-sm text-ink-soft">
          You&apos;re trying MealMate as a guest — items you add here are saved
          in this browser only, and move to your account when you{' '}
          <Link to="/login" className="font-medium text-brand-700 hover:underline">
            sign in
          </Link>
          .
        </div>
      )}

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
      {isAuthed ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <SmartPantryPaste
            existing={pantry}
            onAdd={async (next) => {
              await update.mutateAsync({ pantry: next });
              flashSaved();
            }}
          />
          <FridgePhotoUploader
            existing={pantry}
            onAdd={async (next) => {
              await update.mutateAsync({ pantry: next });
              flashSaved();
            }}
          />
        </div>
      ) : (
        <div className="rounded border border-line bg-card px-4 py-3 text-sm text-text-muted">
          Smart import and photo capture need an account —{' '}
          <Link to="/login" className="font-medium text-brand-700 hover:underline">
            sign in
          </Link>{' '}
          to add pantry items from text or a photo.
        </div>
      )}

      {/* ─── Zero-Waste Chef Expiry Alert ─── */}
      {(() => {
        const expiringSoon = pantry.filter((p) => {
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
        items={pantry}
        onAdd={handleAddPantryItem}
        onRemove={handleRemovePantryItem}
        onClearAll={handleClearAllPantry}
        isUpdating={update.isPending}
      />

      {/* ─── RAG Recipe Suggester ("What can I make with my pantry?") ─── */}
      {isAuthed ? (
        <RagRecipeSuggester
          pantry={pantry}
          dietaryPreferences={dietaryPreferences}
          allergies={allergies}
        />
      ) : (
        <div className="rounded border border-line bg-card px-4 py-3 text-sm text-text-muted">
          AI recipe suggestions need an account —{' '}
          <Link to="/login" className="font-medium text-brand-700 hover:underline">
            sign in
          </Link>{' '}
          to see what you can make with your pantry.
        </div>
      )}

      {/* ─── Cooking History & Notes Log ─── */}
      <CookingHistorySection history={cookingHistory} />

      {/* ─── Redesigned Dietary Preferences & Allergies Grid ─── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <DietaryPreferencesSection
          preferences={dietaryPreferences}
          onToggle={(val) => handleToggleTag('dietaryPreferences', val)}
          onAdd={(val) => handleAddTag('dietaryPreferences', val)}
          onRemove={(val) => handleRemoveTag('dietaryPreferences', val)}
          isUpdating={update.isPending}
        />

        <AllergiesSection
          allergies={allergies}
          onToggle={(val) => handleToggleTag('allergies', val)}
          onAdd={(val) => handleAddTag('allergies', val)}
          onRemove={(val) => handleRemoveTag('allergies', val)}
          isUpdating={update.isPending}
        />
      </div>
    </div>
  );
}
