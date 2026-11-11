import { Link } from 'react-router-dom';
import type { CookingHistoryEntry } from '@/types';

interface CookingHistorySectionProps {
  history: CookingHistoryEntry[];
}

export function CookingHistorySection({ history }: CookingHistorySectionProps) {
  const sorted = [...history].sort(
    (a, b) => new Date(b.cookedAt).getTime() - new Date(a.cookedAt).getTime()
  );

  return (
    <section
      aria-label="Cooking History"
      className="rounded-lg border border-line bg-card p-6 transition-colors"
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between border-b border-line pb-4">
        <div>
          <h2 className="font-serif text-xl font-semibold text-text">Cooking History</h2>
          <p className="text-xs text-text-muted mt-0.5">
            Log of recipes cooked, household ratings, and recipe notes
          </p>
        </div>
        <span className="inline-flex items-center rounded border border-line bg-canvas px-2.5 py-1 text-xs font-mono font-medium text-text-muted w-fit">
          {sorted.length} {sorted.length === 1 ? 'meal cooked' : 'meals cooked'}
        </span>
      </div>

      {sorted.length === 0 ? (
        <div className="py-8 text-center text-text-muted text-sm">
          No meals recorded yet. When you prepare a dish, log it to track portions and family notes.
        </div>
      ) : (
        <div className="divide-y divide-line mt-4">
          {sorted.map((entry, idx) => (
            <article
              key={`${entry.recipeId}-${entry.cookedAt}-${idx}`}
              className="py-4 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3"
            >
              <div className="space-y-1.5 flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium text-text text-base">{entry.recipeTitle}</h3>
                  {entry.servingsCooked && (
                    <span className="text-xs px-2 py-0.5 rounded bg-canvas border border-line text-text-muted">
                      {entry.servingsCooked} servings
                    </span>
                  )}
                  {entry.rating && entry.rating > 0 && (
                    <span className="inline-flex items-center text-xs font-mono text-terracotta bg-canvas border border-line px-2 py-0.5 rounded">
                      Rating: {entry.rating}/5
                    </span>
                  )}
                </div>

                <div className="text-xs text-text-muted">
                  Prepared on {new Date(entry.cookedAt).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </div>

                {entry.notes && (
                  <p className="text-sm text-text bg-canvas/60 border border-line rounded p-2.5 italic">
                    "{entry.notes}"
                  </p>
                )}
              </div>

              <div className="sm:self-center shrink-0">
                <Link
                  to={`/recipes/${entry.recipeId}`}
                  className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded border border-line bg-card hover:bg-canvas text-text transition-colors"
                >
                  Cook Again
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

