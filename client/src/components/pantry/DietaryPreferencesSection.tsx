import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export interface DietPreset {
  id: string;
  label: string;
}

export const DIET_PRESETS: DietPreset[] = [
  { id: 'vegetarian', label: 'Vegetarian' },
  { id: 'vegan', label: 'Vegan' },
  { id: 'pescatarian', label: 'Pescatarian' },
  { id: 'keto', label: 'Keto' },
  { id: 'paleo', label: 'Paleo' },
  { id: 'gluten-free', label: 'Gluten-Free' },
  { id: 'dairy-free', label: 'Dairy-Free' },
  { id: 'mediterranean', label: 'Mediterranean' },
  { id: 'low-carb', label: 'Low-Carb' },
  { id: 'low-fodmap', label: 'Low-FODMAP' },
  { id: 'halal', label: 'Halal' },
  { id: 'kosher', label: 'Kosher' },
];

interface Props {
  preferences: string[];
  onToggle: (preference: string) => Promise<void> | void;
  onAdd: (preference: string) => Promise<void> | void;
  onRemove: (preference: string) => Promise<void> | void;
  isUpdating?: boolean;
}

export function DietaryPreferencesSection({
  preferences,
  onToggle,
  onAdd,
  onRemove,
  isUpdating = false,
}: Props) {
  const [customInput, setCustomInput] = useState('');

  const normalizedPrefs = preferences.map((p) => p.toLowerCase().trim());

  const handleCustomSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const val = customInput.trim();
    if (!val) return;
    await onAdd(val);
    setCustomInput('');
  };

  const customActive = preferences.filter(
    (p) => !DIET_PRESETS.some((preset) => preset.id === p.toLowerCase() || preset.label.toLowerCase() === p.toLowerCase())
  );

  return (
    <section aria-label="Dietary preferences" className="mm-card p-5 sm:p-6 flex flex-col justify-between">
      <div>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line pb-3">
          <div>
            <h2 className="text-lg font-serif font-semibold text-text">
              Dietary preferences
            </h2>
            <p className="text-xs text-text-muted mt-0.5">
              Meal plans and AI suggestions adapt automatically to these dietary choices.
            </p>
          </div>
          <span className="rounded border border-line bg-canvas px-2.5 py-0.5 text-xs font-mono text-text-muted">
            {preferences.length} active
          </span>
        </div>

        {/* Minimalist Toggle Pills Cloud */}
        <div className="mt-4">
          <span className="text-[11px] font-mono text-text-muted uppercase tracking-wider block mb-2.5">
            Click to toggle diets:
          </span>

          <div className="flex flex-wrap gap-2">
            {DIET_PRESETS.map((preset) => {
              const isSelected =
                normalizedPrefs.includes(preset.id) ||
                normalizedPrefs.includes(preset.label.toLowerCase());

              return (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={isSelected}
                  disabled={isUpdating}
                  onClick={() => onToggle(preset.id)}
                  className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition border ${
                    isSelected
                      ? 'bg-ink text-canvas border-ink font-medium'
                      : 'bg-card text-text-muted border-line hover:border-text-muted hover:text-text'
                  }`}
                >
                  <span>{preset.label}</span>
                  {isSelected && <span className="text-[10px] ml-0.5 font-mono font-bold">+</span>}
                </button>
              );
            })}

            {/* Custom active tags that were added manually */}
            {customActive.map((custom) => (
              <span
                key={custom}
                className="inline-flex items-center gap-1.5 rounded bg-canvas border border-line text-text px-2.5 py-1 text-xs font-medium"
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
          aria-label="Custom dietary preference"
          placeholder="Add custom preference (e.g. low-sodium, high-protein)..."
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          className="bg-card text-xs h-8.5"
        />
        <Button type="submit" loading={isUpdating} className="h-8.5 px-3 text-xs shrink-0 bg-ink hover:bg-terracotta text-canvas">
          + Add
        </Button>
      </form>
    </section>
  );
}
