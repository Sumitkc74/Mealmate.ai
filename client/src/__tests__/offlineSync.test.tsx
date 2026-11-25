import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { api } from '@/lib/api';
import {
  flushOfflineGroceryQueue,
  getOfflineGroceryQueue,
  queueOfflineGroceryUpdate,
  useNetworkStatus,
} from '@/lib/offlineSync';

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

describe('offline grocery queue flush', () => {
  beforeEach(() => {
    localStorage.clear();
    patch.mockReset();
    patch.mockResolvedValue({ data: {} });
    setOnline(true);
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
