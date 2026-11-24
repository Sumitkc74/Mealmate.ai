import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage';
import { api } from '@/lib/api';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

const mockedPost = api.post as unknown as ReturnType<typeof vi.fn>;

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ForgotPasswordPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    mockedPost.mockReset();
    mockedPost.mockResolvedValue({
      data: { success: true, message: 'If an account exists for that email, a reset link is on its way.' },
    });
  });

  it('sends a reset link and shows the generic confirmation', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText('Email'), 'reset@example.com');
    await user.click(screen.getByRole('button', { name: /Send reset link/i }));
    expect(mockedPost).toHaveBeenCalledWith('/auth/forgot-password', {
      email: 'reset@example.com',
    });
    expect(
      await screen.findByText(/If an account exists for that email/i)
    ).toBeInTheDocument();
  });

  it('links to the locked-out deletion request page', () => {
    renderPage();
    const link = screen.getByRole('link', { name: /Request account deletion/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toBe('/request-deletion');
  });

  it('rejects an invalid email without calling the API', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: /Send reset link/i }));
    expect(mockedPost).not.toHaveBeenCalled();
    expect(screen.getByText(/valid email address/i)).toBeInTheDocument();
  });
});
