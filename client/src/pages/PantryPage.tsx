import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuthStore } from '@/stores/authStore';
import { useUpdateProfile } from '@/hooks/useProfile';
import { extractErrorMessage } from '@/lib/api';
import { EmptyState } from '@/components/ui/EmptyState';
import { SmartPantryPaste } from '@/components/pantry/SmartPantryPaste';
import { FridgePhotoUploader } from '@/components/pantry/FridgePhotoUploader';
import { RagRecipeSuggester } from '@/components/pantry/RagRecipeSuggester';
import type { PantryItem } from '@/types';

export function PantryPage() {
  const user = useAuthStore((s) => s.user);
  const update = useUpdateProfile();

  const [draft, setDraft] = useState({ ingredient: '', quantity: '', unit: '' });
  const [dietInput, setDietInput] = useState('');
  const [allergyInput, setAllergyInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  if (!user) return null;

  function flashSaved() {
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
  }

  async function handleAddPantry(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!user) return;
    const ingredient = draft.ingredient.trim().toLowerCase();
    if (!ingredient) return;
    const next: PantryItem[] = [
      ...user.pantry,
      {
        ingredient,
        quantity: draft.quantity.trim() || undefined,
        unit: draft.unit.trim().toLowerCase() || undefined,
      },
    ];
    try {
      await update.mutateAsync({ pantry: next });
      setDraft({ ingredient: '', quantity: '', unit: '' });
      flashSaved();
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not add pantry item'));
    }
  }

  async function handleRemovePantry(idx: number) {
    if (!user) return;
    const next = user.pantry.filter((_, i) => i !== idx);
    try {
      await update.mutateAsync({ pantry: next });
      flashSaved();
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not remove item'));
    }
  }

  async function addTag(field: 'dietaryPreferences' | 'allergies', value: string) {
    if (!user) return;
    const cleaned = value.trim().toLowerCase();
    if (!cleaned) return;
    const current = user[field] ?? [];
    if (current.includes(cleaned)) return;
    try {
      await update.mutateAsync({ [field]: [...current, cleaned] });
      flashSaved();
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not save'));
    }
  }

  async function removeTag(field: 'dietaryPreferences' | 'allergies', value: string) {
    if (!user) return;
    try {
      await update.mutateAsync({ [field]: user[field].filter((v) => v !== value) });
      flashSaved();
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not save'));
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Pantry & preferences</h1>
          <p className="text-sm text-gray-600">
            What you already have, what you avoid, and what you love — used everywhere in MealMate.
          </p>
        </div>
        {savedFlash && (
          <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-700">
            ✓ Saved
          </span>
        )}
      </header>

      <section className="rounded-xl border border-brand-100 bg-brand-50/40 px-4 py-3 text-sm text-brand-900">
        <p className="font-semibold">Why your pantry matters</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-brand-800/90">
          <li>
            <span className="font-medium">Cheaper grocery lists:</span> pantry items are
            automatically subtracted when a list is generated from your weekly plan.
          </li>
          <li>
            <span className="font-medium">Smarter AI suggestions:</span> the assistant and the
            weekly planner prefer recipes that reuse what you already own.
          </li>
          <li>
            <span className="font-medium">Safer recipes:</span> your dietary preferences and
            allergies are sent with every AI request — generated dishes will avoid them.
          </li>
        </ul>
      </section>

      {error && (
        <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

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

      <RagRecipeSuggester
        pantry={user.pantry}
        dietaryPreferences={user.dietaryPreferences ?? []}
        allergies={user.allergies ?? []}
      />

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">In your pantry</h2>
        <form onSubmit={handleAddPantry} className="mt-3 grid gap-2 sm:grid-cols-[2fr,1fr,1fr,auto]">
          <Input
            aria-label="Ingredient"
            placeholder="e.g. olive oil"
            value={draft.ingredient}
            onChange={(e) => setDraft((d) => ({ ...d, ingredient: e.target.value }))}
            required
          />
          <Input
            aria-label="Quantity"
            placeholder="qty"
            value={draft.quantity}
            onChange={(e) => setDraft((d) => ({ ...d, quantity: e.target.value }))}
          />
          <Input
            aria-label="Unit"
            placeholder="ml, g…"
            value={draft.unit}
            onChange={(e) => setDraft((d) => ({ ...d, unit: e.target.value }))}
          />
          <Button type="submit" loading={update.isPending}>
            Add
          </Button>
        </form>

        <div className="mt-4">
          {user.pantry.length === 0 ? (
            <EmptyState
              icon="🥫"
              title="Your pantry is empty"
              description="Add ingredients you already have so we don't put them on your grocery list."
              className="py-10"
            />
          ) : (
            <ul className="flex flex-wrap gap-2">
              {user.pantry.map((p, i) => (
                <li
                  key={`${p.ingredient}-${i}`}
                  className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-sm text-brand-800"
                >
                  <span className="font-medium capitalize">{p.ingredient}</span>
                  {p.quantity && (
                    <span className="text-xs text-brand-600">
                      {p.quantity}
                      {p.unit ? ` ${p.unit}` : ''}
                    </span>
                  )}
                  <button
                    onClick={() => handleRemovePantry(i)}
                    aria-label={`Remove ${p.ingredient}`}
                    className="rounded-full p-0.5 text-brand-700 hover:bg-brand-100"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <TagSection
          title="Dietary preferences"
          hint="vegetarian, vegan, keto, halal…"
          tags={user.dietaryPreferences}
          input={dietInput}
          setInput={setDietInput}
          onAdd={(v) => addTag('dietaryPreferences', v).then(() => setDietInput(''))}
          onRemove={(v) => removeTag('dietaryPreferences', v)}
        />
        <TagSection
          title="Allergies"
          hint="peanuts, shellfish, gluten…"
          tags={user.allergies}
          input={allergyInput}
          setInput={setAllergyInput}
          onAdd={(v) => addTag('allergies', v).then(() => setAllergyInput(''))}
          onRemove={(v) => removeTag('allergies', v)}
          variant="danger"
        />
      </div>
    </div>
  );
}

interface TagSectionProps {
  title: string;
  hint: string;
  tags: string[];
  input: string;
  setInput: (v: string) => void;
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
  variant?: 'default' | 'danger';
}

function TagSection({
  title,
  hint,
  tags,
  input,
  setInput,
  onAdd,
  onRemove,
  variant = 'default',
}: TagSectionProps) {
  const chipColor =
    variant === 'danger' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-800';
  const chipBtn = variant === 'danger' ? 'text-red-700 hover:bg-red-100' : 'text-amber-700 hover:bg-amber-100';

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onAdd(input);
        }}
        className="mt-3 flex gap-2"
      >
        <Input
          aria-label={title}
          placeholder={hint}
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <Button type="submit">Add</Button>
      </form>
      <ul className="mt-3 flex flex-wrap gap-2">
        {tags.length === 0 && <li className="text-sm text-gray-500">None yet.</li>}
        {tags.map((t) => (
          <li
            key={t}
            className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm ${chipColor}`}
          >
            <span className="capitalize">{t}</span>
            <button
              onClick={() => onRemove(t)}
              aria-label={`Remove ${t}`}
              className={`rounded-full p-0.5 ${chipBtn}`}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
