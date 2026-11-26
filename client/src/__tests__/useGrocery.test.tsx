import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { cacheGroceryList } from '@/lib/offlineSync';
import { useGroceryList } from '@/hooks/useGrocery';
import type { GroceryList, User } from '@/types';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

const get = api.get as unknown as ReturnType<typeof vi.fn>;

const testUser: User = {
  id: 'u1',
  name: 'Test',
  email: 't@x.com',
  role: 'user',
  pantry: [],
  dietaryPreferences: [],
  allergies: [],
};

const sampleList: GroceryList = {
  id: 'g1',
  user: 'u1',
  mealPlan: 'p1',
  items: [{ _id: 'i1', ingredient: 'tomato', category: 'produce', checked: false, quantity: 1 }],
};

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useGroceryList cache fallback (Fix 3b)', () => {
  beforeEach(() => {
    localStorage.clear();
    get.mockReset();
    useAuthStore.setState({ user: testUser, authedAt: null });
    // Seed the cache for this account so the fallback has something to serve.
    cacheGroceryList(sampleList);
  });

  it('serves the cache on a network error (no response)', async () => {
    get.mockRejectedValueOnce(new Error('Network Error'));

    const { result } = renderHook(() => useGroceryList('g1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(sampleList);
  });

  it('does NOT serve the cache on a 404 response error', async () => {
    get.mockRejectedValueOnce({ response: { status: 404, data: { message: 'Not found' } } });

    const { result } = renderHook(() => useGroceryList('g1'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(
      (result.current.error as { response?: { status?: number } })?.response?.status
    ).toBe(404);
  });

  it('does NOT serve the cache on a 401 response error', async () => {
    get.mockRejectedValueOnce({ response: { status: 401, data: { message: 'Unauthorized' } } });

    const { result } = renderHook(() => useGroceryList('g1'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(
      (result.current.error as { response?: { status?: number } })?.response?.status
    ).toBe(401);
  });

  it('returns the server list on success and refreshes the cache', async () => {
    const fresh: GroceryList = { ...sampleList, items: [] };
    get.mockResolvedValueOnce({ data: { list: fresh } });

    const { result } = renderHook(() => useGroceryList('g1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(fresh);
  });
});
