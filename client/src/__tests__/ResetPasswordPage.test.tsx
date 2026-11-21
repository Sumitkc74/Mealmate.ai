import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ResetPasswordPage } from '@/pages/ResetPasswordPage';
import { api } from '@/lib/api';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

const mockedPost = api.post as unknown as ReturnType<typeof vi.fn>;

function renderPage(entry: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter
        initialEntries={[entry]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <ResetPasswordPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    mockedPost.mockReset();
    mockedPost.mockResolvedValue({
      data: { success: true, message: 'Password reset. Sign in with your new password.' },
    });
  });

  it('resets with matching passwords and shows success', async () => {
    const user = userEvent.setup();
    renderPage('/reset-password?token=abc123');
    await user.type(screen.getByLabelText('New password'), 'newpassword123');
    await user.type(screen.getByLabelText('Confirm new password'), 'newpassword123');
    await user.click(screen.getByRole('button', { name: /Reset password/i }));
    expect(mockedPost).toHaveBeenCalledWith('/auth/reset-password', {
      token: 'abc123',
      password: 'newpassword123',
    });
    expect(await screen.findByText(/Password reset\. Sign in/i)).toBeInTheDocument();
  });

  it('shows an error when the passwords do not match', async () => {
    const user = userEvent.setup();
    renderPage('/reset-password?token=abc123');
    await user.type(screen.getByLabelText('New password'), 'newpassword123');
    await user.type(screen.getByLabelText('Confirm new password'), 'differentpass123');
    await user.click(screen.getByRole('button', { name: /Reset password/i }));
    expect(mockedPost).not.toHaveBeenCalled();
    expect(screen.getByText(/do not match/i)).toBeInTheDocument();
  });

  it('shows an error for a short password', async () => {
    const user = userEvent.setup();
    renderPage('/reset-password?token=abc123');
    await user.type(screen.getByLabelText('New password'), 'short');
    await user.type(screen.getByLabelText('Confirm new password'), 'short');
    await user.click(screen.getByRole('button', { name: /Reset password/i }));
    expect(mockedPost).not.toHaveBeenCalled();
    expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
  });

  it('shows the missing-token message without a token', () => {
    renderPage('/reset-password');
    expect(screen.getByText(/missing its token/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Reset password/i })
    ).not.toBeInTheDocument();
  });
});
