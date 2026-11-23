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
    void migrateGuestData(qc).catch((err) => {
      // Migration is best-effort; a failure must never break sign-in.
      console.warn('[guest migration] failed:', err);
    });
  }, [user, guestHasData, qc]);
}
