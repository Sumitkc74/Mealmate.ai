import { useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import {
  useParsePantryImage,
  type ParsedPantryItem,
} from '@/hooks/useAiPlanner';
import { extractErrorMessage } from '@/lib/api';
import type { PantryItem } from '@/types';

interface Props {
  /** Existing pantry - we de-dupe by ingredient name. */
  existing: PantryItem[];
  /** Called once with the merged pantry. */
  onAdd: (next: PantryItem[]) => Promise<void> | void;
}

const MAX_BYTES = 6 * 1024 * 1024; // 6 MB matches the AI service guard

/**
 * Drag-drop / click-to-upload component that POSTs a fridge / pantry photo
 * (encoded as base64) to `/ai/pantry/vision`. Gemini extracts a structured
 * ingredient list which the user can preview and merge into their pantry.
 *
 * Gracefully shows a "not configured" empty state when the AI service responds
 * with `available: false` (i.e. Gemini key is missing).
 */
export function FridgePhotoUploader({ existing, onAdd }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [hint, setHint] = useState('');
  const [preview, setPreview] = useState<ParsedPantryItem[]>([]);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const vision = useParsePantryImage();

  function pickFile() {
    inputRef.current?.click();
  }

  async function handleFile(file: File) {
    setError(null);
    setPreview([]);
    setAvailable(null);
    setMessage(null);
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/heic'].includes(file.type)) {
      setError('Please upload a JPEG, PNG, WebP or HEIC photo');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`Image is larger than ${MAX_BYTES / (1024 * 1024)} MB`);
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result ?? '');
      setImagePreview(dataUrl);
      const base64 = dataUrl.split(',', 2)[1] ?? '';
      try {
        const res = await vision.mutateAsync({ imageBase64: base64, hint: hint || undefined });
        setAvailable(res.available);
        setMessage(res.message ?? null);
        setPreview(res.items);
      } catch (err) {
        setError(extractErrorMessage(err, 'Could not analyse that image'));
      }
    };
    reader.readAsDataURL(file);
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
      setPreview([]);
      setImagePreview(null);
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
            Shelf photo recognition
          </h2>
          <p className="mt-1 text-xs text-ink-soft">
            Upload an image of your refrigerator or pantry shelf. Vision models identify
            visible ingredients and add them to your inventory list.
          </p>
        </div>
      </div>

      <div
        className="mt-3 flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-line bg-canvas-soft p-6 text-sm text-ink-soft transition hover:bg-canvas"
        role="button"
        tabIndex={0}
        onClick={pickFile}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') pickFile();
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files[0];
          if (file) void handleFile(file);
        }}
      >
        {imagePreview ? (
          <img
            src={imagePreview}
            alt="Pantry ingredient preview"
            width={400}
            height={192}
            loading="lazy"
            decoding="async"
            className="max-h-48 rounded-md shadow object-contain"
          />
        ) : (
          <span>Drop a photo here or click to choose</span>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      <input
        type="text"
        className="mt-3 w-full rounded-md border border-gray-200 p-2 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-200"
        placeholder="Optional hint (e.g. 'leftovers from Sunday roast')"
        value={hint}
        onChange={(e) => setHint(e.target.value)}
      />

      {error && (
        <p role="alert" className="mt-3 text-xs text-red-700">
          {error}
        </p>
      )}
      {available === false && message && (
        <div className="mt-3 space-y-3">
          <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900 ring-1 ring-amber-200">
            {message} — You can add items manually below.
          </p>
          <ManualEntryFallback existing={existing} onAdd={onAdd} />
        </div>
      )}

      {preview.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-medium text-gray-900">Detected items</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {preview.map((item, idx) => (
              <li
                key={`${item.ingredient}-${idx}`}
                className="rounded-full bg-white px-3 py-1 text-xs text-gray-800 ring-1 ring-emerald-200"
              >
                {item.ingredient}
                {item.quantity ? ` · ${item.quantity}${item.unit ? ' ' + item.unit : ''}` : ''}
              </li>
            ))}
          </ul>
          <div className="mt-3">
            <Button onClick={handleAdd} loading={adding}>
              Add to pantry ({preview.length})
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Simple manual pantry entry form — shown when AI vision is unavailable.
 * Accepts one ingredient per line in the format: "name, quantity unit"
 * e.g. "eggs, 6" or "chicken breast, 200 g"
 */
function ManualEntryFallback({
  existing,
  onAdd,
}: {
  existing: PantryItem[];
  onAdd: (next: PantryItem[]) => Promise<void> | void;
}) {
  const [text, setText] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleManualAdd() {
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return;

    const have = new Set(existing.map((p) => p.ingredient.toLowerCase()));
    const merged: PantryItem[] = [...existing];
    for (const line of lines) {
      const [rawName, rest] = line.split(',');
      const name = (rawName ?? '').trim().toLowerCase();
      if (!name || have.has(name)) continue;
      have.add(name);
      const parts = (rest ?? '').trim().split(/\s+/);
      const hasQty = parts[0] && !isNaN(Number(parts[0]));
      const quantity: string | undefined = hasQty ? parts[0] : undefined;
      const unit: string | undefined = hasQty ? parts.slice(1).join(' ') || undefined : undefined;
      merged.push({ ingredient: name, quantity, unit });
    }

    setAdding(true);
    setError(null);
    try {
      await onAdd(merged);
      setText('');
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="rounded-md border border-line bg-canvas-soft p-3">
      <p className="text-xs font-medium text-ink mb-2">Add items manually</p>
      <p className="text-[11px] text-ink-soft mb-2">
        One item per line: <span className="font-mono">eggs, 6</span> or <span className="font-mono">chicken breast, 200 g</span>
      </p>
      <textarea
        rows={4}
        className="w-full rounded border border-gray-200 bg-white p-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
        placeholder={`eggs, 6\nmilk, 1 litre\nbutter, 250 g`}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      {success && <p className="mt-1 text-xs text-green-700">Added to pantry.</p>}
      <Button
        className="mt-2"
        onClick={handleManualAdd}
        loading={adding}
        disabled={!text.trim()}
      >
        Add to pantry
      </Button>
    </div>
  );
}
