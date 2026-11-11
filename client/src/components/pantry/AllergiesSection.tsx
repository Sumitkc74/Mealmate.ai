import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export interface AllergenPreset {
  id: string;
  label: string;
}

export const ALLERGEN_PRESETS: AllergenPreset[] = [
  { id: 'peanuts', label: 'Peanuts' },
  { id: 'tree-nuts', label: 'Tree Nuts' },
  { id: 'dairy', label: 'Milk / Dairy' },
  { id: 'eggs', label: 'Eggs' },
  { id: 'shellfish', label: 'Shellfish' },
  { id: 'fish', label: 'Fish' },
  { id: 'wheat', label: 'Wheat / Gluten' },
  { id: 'soy', label: 'Soy' },
  { id: 'sesame', label: 'Sesame' },
  { id: 'alliums', label: 'Alliums' },
  { id: 'mustard', label: 'Mustard' },
  { id: 'celery', label: 'Celery' },
  { id: 'sulfites', label: 'Sulfites' },
];

interface Props {
  allergies: string[];
  onToggle: (allergy: string) => Promise<void> | void;
  onAdd: (allergy: string) => Promise<void> | void;
  onRemove: (allergy: string) => Promise<void> | void;
  isUpdating?: boolean;
}

export function AllergiesSection({
  allergies,
  onToggle,
  onAdd,
  onRemove,
  isUpdating = false,
}: Props) {
  const [customInput, setCustomInput] = useState('');

  const normalizedAllergies = allergies.map((a) => a.toLowerCase().trim());

  const handleCustomSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const val = customInput.trim();
    if (!val) return;
    await onAdd(val);
    setCustomInput('');
  };

  const customActive = allergies.filter(
    (a) => !ALLERGEN_PRESETS.some((preset) => preset.id === a.toLowerCase() || preset.label.toLowerCase() === a.toLowerCase())
  );

  return (
    <section aria-label="Allergies" className="mm-card p-5 sm:p-6 flex flex-col justify-between">
      <div>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line pb-3">
          <div>
            <h2 className="text-lg font-serif font-semibold text-text">
              Allergies &amp; Intolerances
            </h2>
            <p className="text-xs text-text-muted mt-0.5">
              Critical safety filter: Dishes with these items are strictly excluded from meal plans.
            </p>
          </div>
          <span
            className="rounded border border-line bg-canvas px-2.5 py-0.5 text-xs font-mono text-text-muted"
          >
            {allergies.length} {allergies.length === 1 ? 'critical allergen' : 'critical allergens'}
          </span>
        </div>

        {/* Minimalist Allergen Toggle Pills Cloud */}
        <div className="mt-4">
          <span className="text-[11px] font-mono text-text-muted uppercase tracking-wider block mb-2.5">
            Click to block allergens:
          </span>

          <div className="flex flex-wrap gap-2">
            {ALLERGEN_PRESETS.map((preset) => {
              const isSelected =
                normalizedAllergies.includes(preset.id) ||
                normalizedAllergies.includes(preset.label.toLowerCase());

              return (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={isSelected}
                  disabled={isUpdating}
                  onClick={() => onToggle(preset.id)}
                  className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition border ${
                    isSelected
                      ? 'bg-canvas border-terracotta text-terracotta font-medium'
                      : 'bg-card text-text-muted border-line hover:border-text-muted hover:text-text'
                  }`}
                >
                  <span>{preset.label}</span>
                  {isSelected && <span className="text-[10px] ml-0.5 font-mono font-bold text-terracotta">[blocked]</span>}
                </button>
              );
            })}

            {/* Custom active allergies that were added manually */}
            {customActive.map((custom) => (
              <span
                key={custom}
                className="inline-flex items-center gap-1.5 rounded bg-canvas border border-terracotta text-terracotta px-2.5 py-1 text-xs font-medium"
              >
                <span className="capitalize">{custom}</span>
                <button
                  type="button"
                  onClick={() => onRemove(custom)}
                  aria-label={`Remove ${custom}`}
                  className="ml-0.5 text-text-muted hover:text-terracotta font-mono text-xs"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Inline Custom Input */}
      <form onSubmit={handleCustomSubmit} className="mt-5 pt-3 border-t border-line flex gap-2">
        <Input
          aria-label="Custom food allergy"
          placeholder="Add custom allergy (e.g. strawberries, kiwi, nightshades)..."
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          className="bg-card text-xs h-8.5 focus:border-terracotta"
        />
        <Button
          type="submit"
          loading={isUpdating}
          className="h-8.5 px-3 text-xs shrink-0 bg-ink hover:bg-terracotta text-canvas"
        >
          + Add Allergy
        </Button>
      </form>
    </section>
  );
}
