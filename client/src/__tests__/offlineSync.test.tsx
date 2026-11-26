import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import {
  cacheGroceryList,
  clearGroceryCache,
  flushOfflineGroceryQueue,
  getCachedGroceryList,
  getOfflineGroceryQueue,
  queueOfflineGroceryUpdate,
  useNetworkStatus,
} from '@/lib/offlineSync';
import type { GroceryList, User } from '@/types';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const patch = api.patch as unknown as ReturnType<typeof vi.fn>;

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    value,
    configurable: true,
  });
}

function makeUser(id: string): User {
  return {
    id,
    name: `User ${id}`,
    email: `${id}@example.com`,
    role: 'user',
    pantry: [],
    dietaryPreferences: [],
    allergies: [],
  };
}

function sampleList(): GroceryList {
  return {
    id: 'g1',
    user: 'user-a',
    mealPlan: 'p1',
    items: [{ _id: 'i1', ingredient: 'tomato', category: 'produce', checked: false, quantity: 1 }],
  };
}

function cacheKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('mealmate_grocery_cache_')) keys.push(key);
  }
  return keys;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('offline grocery queue flush', () => {
  beforeEach(() => {
    localStorage.clear();
    patch.mockReset();
    patch.mockResolvedValue({ data: {} });
    setOnline(true);
    useAuthStore.setState({ user: null, authedAt: null });
  });

  afterEach(() => {
    setOnline(true);
  });

  it('flushOfflineGroceryQueue sends the queued PATCH and clears the queue', async () => {
    queueOfflineGroceryUpdate('list-1', 'item-1', { checked: true });
    expect(getOfflineGroceryQueue()).toHaveLength(1);

    const synced = await flushOfflineGroceryQueue();

    expect(synced).toBe(1);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith('/grocery/list-1/items', {
      itemId: 'item-1',
      checked: true,
    });
    expect(getOfflineGroceryQueue()).toHaveLength(0);
  });

  it('useNetworkStatus flushes a queued edit on mount when online', async () => {
    queueOfflineGroceryUpdate('list-1', 'item-1', { checked: true });

    const { unmount } = renderHook(() => useNetworkStatus());

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledWith('/grocery/list-1/items', {
      itemId: 'item-1',
      checked: true,
    });
    await waitFor(() => expect(getOfflineGroceryQueue()).toHaveLength(0));
    unmount();
  });

  it('useNetworkStatus flushes a queued edit on reconnect (online event)', async () => {
    setOnline(false);
    queueOfflineGroceryUpdate('list-1', 'item-1', { checked: true });

    const { result, unmount } = renderHook(() => useNetworkStatus());
    expect(result.current.isOnline).toBe(false);
    // Still offline: nothing is sent yet.
    expect(patch).not.toHaveBeenCalled();

    setOnline(true);
    window.dispatchEvent(new Event('online'));

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledWith('/grocery/list-1/items', {
      itemId: 'item-1',
      checked: true,
    });
    await waitFor(() => expect(getOfflineGroceryQueue()).toHaveLength(0));
    expect(result.current.isOnline).toBe(true);
    unmount();
  });
});

describe('grocery cache is scoped per account (Fix 3)', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({ user: null, authedAt: null });
  });

  it('cache key differs per user: user B cannot read user A’s cached list', () => {
    useAuthStore.setState({ user: makeUser('user-a') });
    cacheGroceryList(sampleList());
    expect(getCachedGroceryList('g1')).toEqual(sampleList());

    useAuthStore.setState({ user: makeUser('user-b') });
    expect(getCachedGroceryList('g1')).toBeNull();

    // Switching back to A restores access to A's own entry.
    useAuthStore.setState({ user: makeUser('user-a') });
    expect(getCachedGroceryList('g1')).toEqual(sampleList());
  });

  it('a guest-scoped entry is not readable as a signed-in user (and vice versa)', () => {
    useAuthStore.setState({ user: null });
    cacheGroceryList(sampleList());
    expect(getCachedGroceryList('g1')).toEqual(sampleList());

    useAuthStore.setState({ user: makeUser('user-a') });
    expect(getCachedGroceryList('g1')).toBeNull();

    // A signed-in entry is not readable as a guest either.
    cacheGroceryList({ ...sampleList(), id: 'g2' });
    expect(getCachedGroceryList('g2')).not.toBeNull();
    useAuthStore.setState({ user: null });
    expect(getCachedGroceryList('g2')).toBeNull();
    // The guest's own entry is untouched by the signed-in caching.
    expect(getCachedGroceryList('g1')).toEqual(sampleList());
  });

  it('clearGroceryCache removes scoped and legacy unscoped keys but keeps the queue', () => {
    useAuthStore.setState({ user: makeUser('user-a') });
    cacheGroceryList(sampleList());
    // Legacy key from before per-account scoping (list id only, no scope).
    localStorage.setItem('mealmate_grocery_cache_g1', JSON.stringify(sampleList()));
    localStorage.setItem('unrelated-key', 'keep-me');
    queueOfflineGroceryUpdate('list-1', 'item-1', { checked: true });

    clearGroceryCache();

    expect(cacheKeys()).toHaveLength(0);
    expect(localStorage.getItem('unrelated-key')).toBe('keep-me');
    // The offline queue is deliberately NOT cleared by the cache sweep.
    expect(getOfflineGroceryQueue()).toHaveLength(1);
  });
});

describe('flush does not lose edits made during replay (Fix 4)', () => {
  beforeEach(() => {
    localStorage.clear();
    patch.mockReset();
    patch.mockResolvedValue({ data: {} });
    setOnline(true);
    useAuthStore.setState({ user: null, authedAt: null });
  });

  afterEach(() => {
    setOnline(true);
  });

  it('an edit enqueued during a flush is sent (same flush picks it up) and not lost', async () => {
    const first = deferred<{ data: Record<string, never> }>();
    patch.mockImplementationOnce(() => first.promise);

    queueOfflineGroceryUpdate('list-1', 'item-1', { checked: true });
    const flushing = flushOfflineGroceryQueue();

    // Enqueue a second edit while the first PATCH is still in flight.
    queueOfflineGroceryUpdate('list-1', 'item-2', { checked: true });
    first.resolve({ data: {} });

    const synced = await flushing;

    expect(synced).toBe(2);
    expect(patch).toHaveBeenCalledTimes(2);
    expect(patch).toHaveBeenCalledWith('/grocery/list-1/items', {
      itemId: 'item-2',
      checked: true,
    });
    expect(getOfflineGroceryQueue()).toHaveLength(0);
  });

  it('a merge into an entry being flushed mints a new id and the merged patch is not lost', async () => {
    queueOfflineGroceryUpdate('list-1', 'item-1', { checked: true });
    const originalId = getOfflineGroceryQueue()[0]!.id;

    const first = deferred<{ data: Record<string, never> }>();
    patch.mockImplementationOnce(() => first.promise);
    const flushing = flushOfflineGroceryQueue();

    // Merge a second patch into the entry that is mid-flush.
    queueOfflineGroceryUpdate('list-1', 'item-1', { quantity: 5 });
    const merged = getOfflineGroceryQueue()[0]!;
    expect(merged.id).not.toBe(originalId);
    expect(merged.patch).toEqual({ checked: true, quantity: 5 });

    first.resolve({ data: {} });
    const synced = await flushing;

    // Old patch sent, then the merged patch sent — nothing lost.
    expect(synced).toBe(2);
    expect(patch).toHaveBeenCalledWith('/grocery/list-1/items', {
      itemId: 'item-1',
      checked: true,
      quantity: 5,
    });
    expect(getOfflineGroceryQueue()).toHaveLength(0);
  });

  it('concurrent flushes share one pass: no double-send and no lost entries', async () => {
    queueOfflineGroceryUpdate('list-1', 'item-1', { checked: true });
    queueOfflineGroceryUpdate('list-1', 'item-2', { checked: true });

    const [a, b] = await Promise.all([
      flushOfflineGroceryQueue(),
      flushOfflineGroceryQueue(),
    ]);

    expect(a).toBe(2);
    expect(b).toBe(2);
    expect(patch).toHaveBeenCalledTimes(2);
    expect(patch).toHaveBeenCalledWith('/grocery/list-1/items', {
      itemId: 'item-1',
      checked: true,
    });
    expect(patch).toHaveBeenCalledWith('/grocery/list-1/items', {
      itemId: 'item-2',
      checked: true,
    });
    expect(getOfflineGroceryQueue()).toHaveLength(0);
  });

  it('a failed entry stays queued and is not retried in a tight loop within the flush', async () => {
    patch.mockRejectedValueOnce(new Error('boom'));
    queueOfflineGroceryUpdate('list-1', 'item-1', { checked: true });
    queueOfflineGroceryUpdate('list-1', 'item-2', { checked: true });

    const synced = await flushOfflineGroceryQueue();

    expect(synced).toBe(1);
    expect(patch).toHaveBeenCalledTimes(2);
    const remaining = getOfflineGroceryQueue();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.itemId).toBe('item-1');
  });
});
