import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
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
  // If an update for the same itemId is already in queue, merge patch
  const existingIdx = queue.findIndex((q) => q.listId === listId && q.itemId === itemId);
  if (existingIdx >= 0) {
    queue[existingIdx] = {
      ...queue[existingIdx]!,
      patch: { ...queue[existingIdx]!.patch, ...patch },
      timestamp: Date.now(),
    };
  } else {
    queue.push({
      id: `${listId}-${itemId}-${Date.now()}`,
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
    localStorage.setItem(`${CACHE_PREFIX}${list.id}`, JSON.stringify(list));
  } catch (err) {
    console.warn('Could not cache grocery list in localStorage', err);
  }
}

export function getCachedGroceryList(listId: string): GroceryList | null {
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${listId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function flushOfflineGroceryQueue(): Promise<number> {
  const queue = getOfflineGroceryQueue();
  if (queue.length === 0) return 0;

  const remaining: PendingGroceryUpdate[] = [];
  let synced = 0;

  for (const item of queue) {
    try {
      await api.patch(`/grocery/${item.listId}/items`, {
        itemId: item.itemId,
        ...item.patch,
      });
      synced++;
    } catch (err) {
      console.warn('Failed to sync offline item, will retry later:', item, err);
      remaining.push(item);
    }
  }

  saveOfflineGroceryQueue(remaining);
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
