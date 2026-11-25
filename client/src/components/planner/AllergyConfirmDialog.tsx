import { useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import type { AllergyConflict } from '@/lib/allergens';

interface AllergyConfirmDialogProps {
  conflict: AllergyConflict;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Warn-and-confirm shown when a user manually adds a recipe whose
 * ingredients conflict with one of their saved allergies. Confirming
 * adds the recipe anyway; cancelling leaves the slot untouched.
 */
export function AllergyConfirmDialog({ conflict, onConfirm, onCancel }: AllergyConfirmDialogProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Allergy warning"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-lg bg-card border border-line p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-ink">Allergy warning</h3>
        <p className="mt-2 text-sm text-ink-soft">
          This recipe contains <span className="font-medium text-ink">{conflict.ingredient}</span>,
          which conflicts with your saved{' '}
          <span className="font-medium text-ink">{conflict.allergy}</span> allergy. Add it anyway?
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" onClick={onConfirm}>
            Add anyway
          </Button>
        </div>
      </div>
    </div>
  );
}
