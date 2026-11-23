import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMe } from '@/hooks/useAuth';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/lib/api';
import type { User } from '@/types';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

const mockedGet = api.get as unknown as ReturnType<typeof vi.fn>;

const testUser: User = {
  id: 'u1',
  name: 'Restore Test',
  email: 'restore@example.com',
  role: 'user',
  pantry: [],
  dietaryPreferences: [],
  allergies: [],
};

// Minimal probe: renders useMe so the query runs.
function Probe() {
  const { isLoading } = useMe();
  return <div>{isLoading ? 'loading' : 'done'}</div>;
}

function renderProbe() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Probe />
    </QueryClientProvider>
  );
}

describe('useMe session restore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: null });
  });

  it('calls /auth/me and restores the user even when no user is persisted', async () => {
    mockedGet.mockResolvedValue({ data: { user: testUser } });
    renderProbe();
    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith('/auth/me'));
    await waitFor(() => expect(useAuthStore.getState().user).toEqual(testUser));
    expect(screen.getByText('done')).toBeInTheDocument();
  });

  it('stays a guest when /auth/me rejects (no cookie / invalid cookie)', async () => {
    mockedGet.mockRejectedValue({ response: { status: 401 } });
    renderProbe();
    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith('/auth/me'));
    // One call only: the query does not retry a guest 401.
    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().user).toBeNull();
  });
});
