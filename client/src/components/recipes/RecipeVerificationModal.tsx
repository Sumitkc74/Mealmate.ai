import type { VerifyRecipeResponse } from '@/hooks/useRecipes';
import { Button } from '@/components/ui/Button';

interface RecipeVerificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmPublish: () => void;
  isLoading: boolean;
  verification: VerifyRecipeResponse | null;
  recipeTitle?: string;
}

export function RecipeVerificationModal({
  isOpen,
  onClose,
  onConfirmPublish,
  isLoading,
  verification,
  recipeTitle,
}: RecipeVerificationModalProps) {
  if (!isOpen) return null;

  const isVerified = verification?.verdict === 'verified' || (verification?.score ?? 0) >= 80;
  const isRejected = verification?.verdict === 'rejected';
  const isReview = verification?.verdict === 'needs_review';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="verification-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/50"
    >
      <div className="relative w-full max-w-lg rounded-lg bg-card p-6 border border-line max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line pb-4">
          <div>
            <h2 id="verification-modal-title" className="font-serif text-lg font-bold text-text">
              Recipe Verification
            </h2>
            {recipeTitle && (
              <p className="text-xs text-text-muted truncate max-w-xs mt-0.5">
                {recipeTitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-text-muted hover:text-text font-mono text-xs"
            aria-label="Close verification modal"
          >
            Close
          </button>
        </div>

        {/* Content */}
        <div className="py-5">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-10 space-y-4 text-center">
              <div className="w-8 h-8 rounded border-2 border-line border-t-terracotta animate-spin" />
              <div>
                <p className="font-semibold text-text text-sm">
                  Analyzing recipe with AI...
                </p>
                <p className="text-xs text-text-muted mt-1 max-w-xs">
                  Checking ingredient safety, proportions, preparation steps, and allergen flags.
                </p>
              </div>
            </div>
          ) : verification ? (
            <div className="space-y-4">
              {/* Verdict Banner */}
              <div
                className={`rounded border p-4 flex items-start gap-3 ${
                  isVerified
                    ? 'bg-canvas border-line text-text'
                    : isRejected
                    ? 'bg-canvas border-terracotta text-text'
                    : 'bg-canvas border-line text-text'
                }`}
              >
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-sm">
                      {isVerified
                        ? 'Recipe Verified & Safe'
                        : isRejected
                        ? 'Potential Issues Detected'
                        : 'Review Recommendations'}
                    </h3>
                    <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded border border-line bg-card">
                      Score: {verification.score}/100
                    </span>
                  </div>
                  <p className="text-xs mt-1 leading-relaxed text-text-muted">
                    {verification.summary}
                  </p>
                </div>
              </div>

              {/* Detected Allergens */}
              {verification.detected_allergens && verification.detected_allergens.length > 0 && (
                <div className="rounded border border-line p-3 bg-canvas">
                  <h4 className="text-xs font-mono uppercase tracking-wider text-text-muted mb-2">
                    Detected Allergens
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {verification.detected_allergens.map((allergen) => (
                      <span
                        key={allergen}
                        className="rounded bg-card text-text px-2 py-0.5 text-xs font-mono border border-line capitalize"
                      >
                        {allergen}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Issues List */}
              {verification.issues && verification.issues.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-mono uppercase tracking-wider text-text-muted">
                    Identified Points ({verification.issues.length})
                  </h4>
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {verification.issues.map((issue, idx) => (
                      <div
                        key={idx}
                        className="rounded p-2.5 text-xs border border-line bg-canvas flex items-start gap-2"
                      >
                        <span className="font-mono text-[10px] uppercase shrink-0 mt-0.5 px-1 py-0.5 rounded border border-line bg-card text-text-muted">
                          {issue.category}
                        </span>
                        <span className="flex-1 leading-snug text-text">{issue.message}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Suggestions */}
              {verification.suggestions && verification.suggestions.length > 0 && (
                <div className="rounded border border-line p-3 bg-canvas">
                  <h4 className="text-xs font-mono uppercase tracking-wider text-text-muted mb-1.5">
                    Chef's Suggestions
                  </h4>
                  <ul className="list-disc list-inside space-y-1 text-xs text-text-muted">
                    {verification.suggestions.map((sug, idx) => (
                      <li key={idx}>{sug}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <p className="text-center text-sm text-text-muted py-6">
              No verification details available yet.
            </p>
          )}
        </div>

        {/* Footer Actions */}
        <div className="border-t border-line pt-4 flex items-center justify-end gap-2.5">
          <Button type="button" variant="secondary" onClick={onClose} size="sm">
            {isRejected ? 'Close & Edit' : 'Edit Recipe'}
          </Button>

          {!isRejected && (
            <Button
              type="button"
              onClick={onConfirmPublish}
              disabled={isLoading || !verification}
              size="sm"
              className="bg-ink hover:bg-terracotta text-canvas"
            >
              {isReview ? 'Publish Anyway' : 'Confirm & Publish'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
