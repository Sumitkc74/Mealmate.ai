import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import type { GroceryList } from '@/types';

export interface PendingGroceryUpdate {
  id: string;
  listId: string;
  itemId: string;
  patch: { checked?: boolean; quantity?: number; unit?: string; category?: string };
  timestamp: number;
}

const QUEUE_KEY = 'mealmate_offline_grocery_queue';
const CACHE_PREFIX = 'mealmate_grocery_cache_';
const GUEST_SCOPE = 'guest';

let idCounter = 0;

/**
 * Unique id for a queued edit. crypto.randomUUID() is the codebase's
 * established pattern (see guestStore.newGuestId); the counter + timestamp
 * fallback keeps ids unique even where randomUUID is unavailable or two
 * enqueues land in the same millisecond.
 */
export function newPendingUpdateId(): string {
  idCounter += 1;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `pending-${Date.now().toString(36)}-${idCounter}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

/**
 * Scope for the grocery cache key: the signed-in user's id, or 'guest'
 * when nobody is signed in. Scoping by account means one account's cached
 * list can never be read as another account's (previously the key was the
 * list id alone, so after an account switch a stale cached copy of the
 * previous account's list could be served).
 */
function cacheScope(): string {
  return useAuthStore.getState().user?.id ?? GUEST_SCOPE;
}

function cacheKey(listId: string): string {
  return `${CACHE_PREFIX}${cacheScope()}:${listId}`;
}

/**
 * Remove every grocery-cache key (all scopes, including legacy unscoped
 * keys written before per-account scoping). Called on sign-out so a cached
 * list never survives into the next account's session. The offline queue
 * is deliberately NOT cleared here — unsynced edits must survive sign-out.
 */
export function clearGroceryCache(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(CACHE_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch (err) {
    console.warn('Could not clear grocery cache in localStorage', err);
  }
}

export function getOfflineGroceryQueue(): PendingGroceryUpdate[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveOfflineGroceryQueue(queue: PendingGroceryUpdate[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch (err) {
    console.error('Failed to save offline grocery queue', err);
  }
}

export function queueOfflineGroceryUpdate(
  listId: string,
  itemId: string,
  patch: { checked?: boolean; quantity?: number; unit?: string; category?: string }
): void {
  const queue = getOfflineGroceryQueue();
  // If an update for the same itemId is already in queue, merge patch.
  // The merged entry MUST get a fresh id: the old entry may be mid-flush,
  // and the flush removes entries by id once their PATCH succeeds — if the
  // merge kept the old id, removing the synced old id would delete the
  // newer merged patch that was never sent.
  const existingIdx = queue.findIndex((q) => q.listId === listId && q.itemId === itemId);
  if (existingIdx >= 0) {
    queue[existingIdx] = {
      ...queue[existingIdx]!,
      id: newPendingUpdateId(),
      patch: { ...queue[existingIdx]!.patch, ...patch },
      timestamp: Date.now(),
    };
  } else {
    queue.push({
      id: newPendingUpdateId(),
      listId,
      itemId,
      patch,
      timestamp: Date.now(),
    });
  }
  saveOfflineGroceryQueue(queue);

  // Also update local cached list if available
  const cached = getCachedGroceryList(listId);
  if (cached) {
    cached.items = cached.items.map((it) =>
      it._id === itemId ? ({ ...it, ...patch } as typeof it) : it
    );
    cacheGroceryList(cached);
  }
}

export function cacheGroceryList(list: GroceryList): void {
  try {
    localStorage.setItem(cacheKey(list.id), JSON.stringify(list));
  } catch (err) {
    console.warn('Could not cache grocery list in localStorage', err);
  }
}

export function getCachedGroceryList(listId: string): GroceryList | null {
  try {
    const raw = localStorage.getItem(cacheKey(listId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Shared in-flight flush promise: two concurrent flushes (e.g. a mount
 * sync racing an online-event sync) share one pass instead of each
 * snapshotting the queue and clobbering the other's removals.
 */
let flushInFlight: Promise<number> | null = null;

export function flushOfflineGroceryQueue(): Promise<number> {
  if (flushInFlight) return flushInFlight;
  flushInFlight = runFlushOfflineGroceryQueue().finally(() => {
    flushInFlight = null;
  });
  return flushInFlight;
}

async function runFlushOfflineGroceryQueue(): Promise<number> {
  let synced = 0;
  // Ids attempted in this flush call. A failed entry stays queued for a
  // later trigger and must NOT be retried in a tight loop within this call.
  const attempted = new Set<string>();

  // Loop: entries enqueued while a pass is awaiting PATCHes are picked up
  // by the next pass, so nothing waits for the next mount / online event.
  // Entries that arrived during a pass have new ids (a merge mints a fresh
  // id), so they are never mistaken for the entry that just synced.
  for (;;) {
    const pending = getOfflineGroceryQueue().filter((item) => !attempted.has(item.id));
    if (pending.length === 0) break;

    const syncedIds = new Set<string>();
    for (const item of pending) {
      attempted.add(item.id);
      try {
        await api.patch(`/grocery/${item.listId}/items`, {
          itemId: item.itemId,
          ...item.patch,
        });
        synced++;
        syncedIds.add(item.id);
      } catch (err) {
        console.warn('Failed to sync offline item, will retry later:', item, err);
      }
    }

    // Remove ONLY the entries that synced, from the CURRENT stored queue —
    // never overwrite the stored queue with this pass's snapshot, or an
    // edit enqueued during the awaits would be erased.
    if (syncedIds.size > 0) {
      const current = getOfflineGroceryQueue();
      saveOfflineGroceryQueue(current.filter((item) => !syncedIds.has(item.id)));
    }
  }

  return synced;
}

export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' && 'onLine' in navigator ? navigator.onLine : true
  );
  const [pendingCount, setPendingCount] = useState<number>(() => getOfflineGroceryQueue().length);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [lastSyncCount, setLastSyncCount] = useState<number | null>(null);

  const sync = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    setIsSyncing(true);
    try {
      const count = await flushOfflineGroceryQueue();
      setPendingCount(getOfflineGroceryQueue().length);
      if (count > 0) {
        setLastSyncCount(count);
        setTimeout(() => setLastSyncCount(null), 4000);
      }
    } finally {
      setIsSyncing(false);
    }
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      sync();
    };
    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial sync check on mount if online and has pending
    if (navigator.onLine && getOfflineGroceryQueue().length > 0) {
      sync();
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [sync]);

  const recordOfflineUpdate = (
    listId: string,
    itemId: string,
    patch: { checked?: boolean; quantity?: number; unit?: string }
  ) => {
    queueOfflineGroceryUpdate(listId, itemId, patch);
    setPendingCount(getOfflineGroceryQueue().length);
  };

  return {
    isOnline,
    pendingCount,
    isSyncing,
    lastSyncCount,
    sync,
    recordOfflineUpdate,
  };
}
