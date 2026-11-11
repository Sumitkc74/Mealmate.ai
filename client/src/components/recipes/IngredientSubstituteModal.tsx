import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface SubstitutionItem {
  target: string;
  substitute: string;
  ratio: string;
  context: string;
  notes: string;
}

interface SubstitutesResponse {
  success: boolean;
  ingredient: string;
  substitutions: SubstitutionItem[];
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  initialIngredient?: string;
}

export function IngredientSubstituteModal({ isOpen, onClose, initialIngredient = '' }: Props) {
  const [query, setQuery] = useState(initialIngredient);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [substitutions, setSubstitutions] = useState<SubstitutionItem[]>([]);
  const [searchedIngredient, setSearchedIngredient] = useState('');

  useEffect(() => {
    if (isOpen && initialIngredient) {
      setQuery(initialIngredient);
      fetchSubstitutes(initialIngredient);
    }
  }, [isOpen, initialIngredient]);

  async function fetchSubstitutes(ingredientName: string) {
    const clean = ingredientName.trim();
    if (!clean) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<SubstitutesResponse>('/ai/knowledge/substitutes', {
        params: { ingredient: clean },
      });
      setSubstitutions(res.data.substitutions || []);
      setSearchedIngredient(clean);
    } catch {
      setError(`No verified substitutions found for "${clean}". Try common ingredients like buttermilk, egg, butter, or soy sauce.`);
      setSubstitutions([]);
    } finally {
      setLoading(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="substitute-modal-title"
    >
      <div className="w-full max-w-lg overflow-hidden rounded-lg border border-line bg-card p-6 shadow-lg">
        <div className="flex items-center justify-between border-b border-line pb-3">
          <div>
            <h2 id="substitute-modal-title" className="text-lg font-bold text-ink">
              Culinary Substitutions
            </h2>
            <p className="text-xs text-ink-soft">Knowledge Graph &amp; Food Science Engine</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-xs font-semibold text-ink-soft hover:bg-canvas-soft hover:text-ink"
            aria-label="Close"
          >
            Close
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            fetchSubstitutes(query);
          }}
          className="mt-4 flex gap-2"
        >
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. buttermilk, egg, butter, heavy cream..."
            className="flex-1 rounded border border-line bg-card px-3.5 py-2 text-sm text-ink focus:border-brand-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="rounded bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </form>

        <div className="mt-4 max-h-[60vh] space-y-3 overflow-y-auto">
          {error && (
            <div className="rounded bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
              {error}
            </div>
          )}

          {!loading && !error && substitutions.length === 0 && searchedIngredient && (
            <p className="text-center text-sm text-ink-soft py-4">
              No specific swaps in Knowledge Graph for <strong>{searchedIngredient}</strong>.
            </p>
          )}

          {substitutions.map((sub, idx) => (
            <div
              key={idx}
              className="rounded border border-line bg-canvas-soft p-3.5 transition hover:border-brand-500"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-ink">{sub.substitute}</span>
                <span className="rounded bg-card border border-line px-2.5 py-0.5 text-xs font-semibold text-brand-700">
                  Ratio: {sub.ratio}
                </span>
              </div>
              <p className="mt-1 text-xs text-ink-soft leading-relaxed">{sub.notes}</p>
              <div className="mt-2 flex items-center gap-1.5">
                <span className="rounded bg-card border border-line px-2 py-0.5 text-[11px] font-medium text-ink capitalize">
                  {sub.context}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 flex justify-end border-t border-gray-100 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

