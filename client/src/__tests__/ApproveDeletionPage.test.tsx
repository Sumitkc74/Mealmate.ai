import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApproveDeletionPage } from '@/pages/ApproveDeletionPage';
import { api } from '@/lib/api';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

const mockedPost = api.post as unknown as ReturnType<typeof vi.fn>;

// One constant for the link token, used in both the URL and the assertion,
// so the two can never drift apart.
const TOKEN = 'approve-test-token';

function renderPage(entry: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter
        initialEntries={[entry]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <ApproveDeletionPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ApproveDeletionPage', () => {
  beforeEach(() => {
    // mockClear (not mockReset): see ConfirmDeletionPage.test.tsx — the
    // approve call fires from a mount effect, and mockReset breaks
    // toHaveBeenCalledWith deep-equality on the recorded call.
    mockedPost.mockClear();
  });

  it('approves with the token from the link and shows the deletion date', async () => {
    mockedPost.mockResolvedValue({
      data: {
        success: true,
        message: 'Deletion approved.',
        deleteAt: '2026-12-23T12:00:00.000Z',
      },
    });
    renderPage(`/approve-deletion?token=${TOKEN}`);
    expect(await screen.findByText(/Deletion approved/i)).toBeInTheDocument();
    // Assert on the recorded call directly: toHaveBeenCalledWith fails
    // deep-equality on this mount-effect call even though the recorded
    // args are identical (see ConfirmDeletionPage.test.tsx).
    expect(mockedPost.mock.calls).toHaveLength(1);
    expect(mockedPost.mock.calls[0]![0]).toBe('/auth/approve-deletion');
    expect((mockedPost.mock.calls[0]![1] as { token: string }).token).toBe(TOKEN);
    expect(screen.getByText(/December 23, 2026/)).toBeInTheDocument();
  });

  it('shows the invalid-or-expired message when approval fails', async () => {
    mockedPost.mockRejectedValue(new Error('Invalid or expired approval link'));
    renderPage(`/approve-deletion?token=${TOKEN}`);
    expect(
      await screen.findByText(/Invalid or expired approval link/i)
    ).toBeInTheDocument();
  });

  it('shows the missing-token message when the link has no token', async () => {
    renderPage('/approve-deletion');
    expect(await screen.findByText(/missing its token/i)).toBeInTheDocument();
    expect(mockedPost).not.toHaveBeenCalled();
  });
});
