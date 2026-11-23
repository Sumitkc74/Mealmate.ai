import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRegister } from '@/hooks/useAuth';
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
  name: 'Register Test',
  email: 'register@example.com',
  role: 'user',
  pantry: [],
  dietaryPreferences: [],
  allergies: [],
};

// Probe: a button that runs the register mutation.
function Probe() {
  const register = useRegister();
  return (
    <button
      type="button"
      onClick={() =>
        void register.mutate({
          name: 'Register Test',
          email: 'register@example.com',
          password: 'Register1!x',
          termsAccepted: true,
          dietaryConsent: true,
        })
      }
    >
      register
    </button>
  );
}

describe('useRegister session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: null, authedAt: null });
  });

  it('sets the user and marks the session just-established on success', async () => {
    mockedPost.mockResolvedValue({ data: { success: true, user: testUser } });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <Probe />
      </QueryClientProvider>
    );
    fireEvent.click(screen.getByText('register'));
    await waitFor(() => expect(useAuthStore.getState().user).toEqual(testUser));
    // authedAt is set by setAuth: a 401 from the immediate post-register
    // /me validation must not destroy this session (post-auth grace).
    const authedAt = useAuthStore.getState().authedAt;
    expect(authedAt).not.toBeNull();
    expect(Date.now() - (authedAt as number)).toBeLessThan(5000);
  });
});
