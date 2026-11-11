import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/Button';
import { useParsePantry, type ParsedPantryItem } from '@/hooks/useAiPlanner';
import { extractErrorMessage } from '@/lib/api';
import type { PantryItem } from '@/types';

interface Props {
  /** Existing pantry - we de-dupe by ingredient name. */
  existing: PantryItem[];
  /** Called once with the merged pantry. */
  onAdd: (next: PantryItem[]) => Promise<void> | void;
}

/**
 * Paste-anything pantry import. Sends the freeform text to `/ai/pantry/parse`
 * (Gemini-backed when `GEMINI_API_KEY` is set, deterministic regex fallback
 * otherwise) and previews structured items before merging into the pantry.
 */
export function SmartPantryPaste({ existing, onAdd }: Props) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<ParsedPantryItem[]>([]);
  const [strategy, setStrategy] = useState<'llm' | 'heuristic' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const parse = useParsePantry();

  async function handleParse() {
    setError(null);
    setStrategy(null);
    try {
      const res = await parse.mutateAsync(text);
      setPreview(res.items);
      setStrategy(res.strategy);
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not parse that - try simplifying it'));
    }
  }

  async function handleAdd() {
    setError(null);
    setAdding(true);
    try {
      const have = new Set(existing.map((p) => p.ingredient.toLowerCase()));
      const merged: PantryItem[] = [...existing];
      for (const p of preview) {
        const name = p.ingredient.trim().toLowerCase();
        if (!name || have.has(name)) continue;
        have.add(name);
        merged.push({
          ingredient: name,
          quantity: p.quantity ?? undefined,
          unit: p.unit ?? undefined,
        });
      }
      await onAdd(merged);
      setText('');
      setPreview([]);
      setStrategy(null);
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not save'));
    } finally {
      setAdding(false);
    }
  }

  return (
    <section className="rounded-lg border border-line bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">
            Batch pantry paste
          </h2>
          <p className="mt-1 text-xs text-ink-soft">
            Paste a shopping receipt or list of ingredients. Automated parsing extracts
            structured names, quantities, and units before adding them.
          </p>
        </div>
      </div>

      <textarea
        rows={3}
        className="mt-3 w-full rounded-md border border-gray-200 bg-white p-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
        placeholder="e.g. 2 tomatoes, half a red onion, 200g chicken breast, leftover rice and a clove of garlic"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button onClick={handleParse} loading={parse.isPending} disabled={!text.trim()}>
          Parse with AI
        </Button>
        {strategy && (
          <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-brand-700 ring-1 ring-brand-200">
            {strategy === 'llm' ? 'Gemini parsed' : 'Offline parser'}
          </span>
        )}
        {error && (
          <span role="alert" className="text-xs text-red-700">
            {error}
          </span>
        )}
      </div>

      <AnimatePresence>
        {preview.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="mt-3 overflow-hidden"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Preview ({preview.length})
            </p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {preview.map((p, i) => (
                <motion.li
                  key={`${p.ingredient}-${i}`}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.03 }}
                  className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-sm shadow-sm ring-1 ring-brand-100"
                >
                  <span className="font-medium capitalize">{p.ingredient}</span>
                  {(p.quantity || p.unit) && (
                    <span className="text-xs text-gray-500">
                      {p.quantity ?? ''}
                      {p.unit ? ` ${p.unit}` : ''}
                    </span>
                  )}
                </motion.li>
              ))}
            </ul>
            <div className="mt-3 flex gap-2">
              <Button onClick={handleAdd} loading={adding}>
                Add {preview.length} item{preview.length === 1 ? '' : 's'}
              </Button>
              <Button variant="secondary" onClick={() => setPreview([])} disabled={adding}>
                Clear
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
