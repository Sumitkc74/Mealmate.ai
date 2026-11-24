import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RequestDeletionPage } from '@/pages/RequestDeletionPage';
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
        <RequestDeletionPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('RequestDeletionPage', () => {
  beforeEach(() => {
    mockedPost.mockReset();
    mockedPost.mockResolvedValue({
      data: { success: true, message: 'Request received.' },
    });
  });

  it('submits the request with Leave as the default recipe choice', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText('Email you signed up with'), 'deleter@example.com');
    await user.type(screen.getByLabelText('Email we can reach you at'), 'reachme@example.com');
    await user.type(screen.getByLabelText('Your name'), 'Deleter');
    await user.type(screen.getByLabelText(/A recipe you created/), 'Deleter Soup');
    await user.click(screen.getByRole('button', { name: /Request account deletion/i }));
    expect(mockedPost).toHaveBeenCalledWith('/auth/request-deletion', {
      email: 'deleter@example.com',
      contactEmail: 'reachme@example.com',
      name: 'Deleter',
      recipe: 'Deleter Soup',
      deleteRecipes: false,
      cannotAccessEmail: false,
    });
    expect(await screen.findByText(/Request received/i)).toBeInTheDocument();
  });

  it('sends the lost-email path and the Delete choice when picked', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText('Email you signed up with'), 'deleter@example.com');
    await user.type(screen.getByLabelText('Email we can reach you at'), 'reachme@example.com');
    await user.type(screen.getByLabelText('Your name'), 'Deleter');
    await user.click(screen.getByRole('radio', { name: /^Delete/ }));
    await user.click(screen.getByLabelText(/I can't access this email/i));
    await user.click(screen.getByRole('button', { name: /Request account deletion/i }));
    expect(mockedPost).toHaveBeenCalledWith('/auth/request-deletion', {
      email: 'deleter@example.com',
      contactEmail: 'reachme@example.com',
      name: 'Deleter',
      recipe: undefined,
      deleteRecipes: true,
      cannotAccessEmail: true,
    });
  });

  it('rejects an invalid account email without calling the API', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText('Email you signed up with'), 'not-an-email');
    await user.type(screen.getByLabelText('Email we can reach you at'), 'reachme@example.com');
    await user.type(screen.getByLabelText('Your name'), 'Deleter');
    await user.click(screen.getByRole('button', { name: /Request account deletion/i }));
    expect(mockedPost).not.toHaveBeenCalled();
    expect(
      screen.getByText('Please enter the email you signed up with.')
    ).toBeInTheDocument();
  });
});
