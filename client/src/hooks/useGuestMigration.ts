import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import { useGuestStore, hasGuestData } from '@/stores/guestStore';
import { migrateGuestData } from '@/lib/guestMigration';

/**
 * Single trigger for guest-data migration. Runs once when a user is present
 * and the guest store holds data — covering login, register, and session
 * restore via useMe, all through the same path. The ref guard resets on
 * logout, and the migration itself is guarded against concurrent runs, so
 * it can never post the same items twice.
 */
export function useGuestMigrationOnSignIn() {
  const user = useAuthStore((s) => s.user);
  const guestHasData = useGuestStore((s) =>
    hasGuestData({
      pantry: s.pantry,
      mealPlans: s.mealPlans,
      groceryLists: s.groceryLists,
      recipes: s.recipes,
      allergies: s.allergies,
    })
  );
  const qc = useQueryClient();
  const ranRef = useRef(false);

  useEffect(() => {
    if (!user) {
      ranRef.current = false;
      return;
    }
    if (!guestHasData || ranRef.current) return;
    ranRef.current = true;
    void migrateGuestData(qc)
      .then(() => {
        // If anything is still waiting (items failed, or the session check
        // aborted the run), arm the hook to retry on the next sign-in
        // instead of swallowing the failure.
        if (
          hasGuestData({
            pantry: useGuestStore.getState().pantry,
            mealPlans: useGuestStore.getState().mealPlans,
            groceryLists: useGuestStore.getState().groceryLists,
            recipes: useGuestStore.getState().recipes,
            allergies: useGuestStore.getState().allergies,
          })
        ) {
          ranRef.current = false;
        }
      })
      .catch((err) => {
        // Migration is best-effort; a failure must never break sign-in.
        console.warn('[guest migration] failed:', err);
        ranRef.current = false;
      });
  }, [user, guestHasData, qc]);
}
