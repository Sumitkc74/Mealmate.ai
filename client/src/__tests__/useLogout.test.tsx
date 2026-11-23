import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useLogout } from '@/hooks/useAuth';
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

const mockedPost = api.post as unknown as ReturnType<typeof vi.fn>;

const testUser: User = {
  id: 'u1',
  name: 'Logout Test',
  email: 'logout@example.com',
  role: 'user',
  pantry: [],
  dietaryPreferences: [],
  allergies: [],
};

// Probe: a button that runs the logout returned by useLogout.
function Probe() {
  const logout = useLogout();
  return (
    <button type="button" onClick={() => void logout()}>
      sign out
    </button>
  );
}

describe('useLogout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: testUser, authedAt: null });
  });

  it('awaits the server logout POST before clearing local state', async () => {
    // The POST resolves only when we release it, so we can observe the
    // ordering: the user must stay set until the server has cleared the
    // cookie, otherwise a useMe refetch in between would see a valid
    // cookie and resurrect the session (seen live after sign-out).
    let release!: () => void;
    const pending = new Promise<{ data: { success: boolean } }>((resolve) => {
      release = () => resolve({ data: { success: true } });
    });
    mockedPost.mockReturnValueOnce(pending);

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <Probe />
      </QueryClientProvider>
    );
    fireEvent.click(screen.getByText('sign out'));

    // POST fired, but not yet resolved: the user must still be set.
    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith('/auth/logout'));
    expect(useAuthStore.getState().user).toEqual(testUser);

    // Release the POST: now the local user is cleared.
    release();
    await waitFor(() => expect(useAuthStore.getState().user).toBeNull());
  });

  it('clears local state even when the logout POST fails', async () => {
    mockedPost.mockRejectedValueOnce(new Error('network down'));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <Probe />
      </QueryClientProvider>
    );
    fireEvent.click(screen.getByText('sign out'));
    await waitFor(() => expect(useAuthStore.getState().user).toBeNull());
  });
});
