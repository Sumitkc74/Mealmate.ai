import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '../App';
import { useAuthStore } from '@/stores/authStore';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: {
      get: vi.fn().mockResolvedValue({ data: { success: true, items: [], mealPlans: [], user: { id: '1', name: 'Test', email: 't@x.com' } } }),
      post: vi.fn().mockResolvedValue({ data: { success: true } }),
    },
  };
});

vi.mock('@/hooks/useAuth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useAuth')>();
  return {
    ...actual,
    useMe: () => ({ isError: false, data: undefined, isLoading: false }),
  };
});

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter
        initialEntries={[path]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <App />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('App routing', () => {
  beforeEach(() => {
    useAuthStore.setState({ token: null, user: null });
    localStorage.clear();
  });

  it('renders the public home page', async () => {
    renderAt('/');
    expect(await screen.findByRole('heading', { level: 1 }, { timeout: 5000 })).toHaveTextContent(/plan smarter/i);
  });

  it('shows the login form on /login', async () => {
    renderAt('/login');
    expect(await screen.findByText(/welcome back/i, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it('shows the register form on /register', async () => {
    renderAt('/register');
    expect(await screen.findByText(/create your account/i, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByLabelText(/full name/i)).toBeInTheDocument();
  });

  it('redirects unauthenticated users away from /planner', async () => {
    renderAt('/planner');
    // Should land on login page.
    expect(await screen.findByText(/welcome back/i, {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it('renders a protected page when authenticated', async () => {
    const authState = {
      token: 'fake-token',
      user: {
        id: '1',
        name: 'Test',
        email: 't@x.com',
        role: 'user' as const,
        pantry: [],
        dietaryPreferences: [],
        allergies: [],
      },
    };
    useAuthStore.setState(authState);
    localStorage.setItem('mealmate.auth', JSON.stringify({ state: authState, version: 0 }));
    renderAt('/planner');
    expect(
      await screen.findByRole('heading', { name: /meal planner/i }, { timeout: 5000 })
    ).toBeInTheDocument();
  });

  it('renders 404 for unknown routes', async () => {
    renderAt('/no-such-page');
    expect(await screen.findByRole('heading', { name: /page not found/i })).toBeInTheDocument();
  });

  it('renders the Privacy Policy on /privacy', async () => {
    renderAt('/privacy');
    expect(await screen.findByRole('heading', { name: /privacy policy/i }, { timeout: 5000 })).toBeInTheDocument();
  });

  it('renders the Terms of Service on /terms', async () => {
    renderAt('/terms');
    expect(await screen.findByRole('heading', { name: /terms of service/i })).toBeInTheDocument();
  });

  it('renders Open Source Attributions on /attributions', async () => {
    renderAt('/attributions');
    expect(await screen.findByRole('heading', { name: /attributions/i })).toBeInTheDocument();
  });

  it('redirects unauthenticated users away from /privacy/manage', async () => {
    renderAt('/privacy/manage');
    expect(await screen.findByText(/welcome back/i)).toBeInTheDocument();
  });

  it('renders Account & Privacy settings on /privacy/manage when authenticated', async () => {
    const authState = {
      token: 'fake-token',
      user: {
        id: '1',
        name: 'Test',
        email: 't@x.com',
        role: 'user' as const,
        pantry: [],
        dietaryPreferences: [],
        allergies: [],
      },
    };
    useAuthStore.setState(authState);
    localStorage.setItem('mealmate.auth', JSON.stringify({ state: authState, version: 0 }));
    renderAt('/privacy/manage');
    expect(await screen.findByRole('heading', { name: /privacy & data management/i })).toBeInTheDocument();
  });
});

