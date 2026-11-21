import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AiAssistant } from '@/components/ai/AiAssistant';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/lib/api';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

const mockedGet = api.get as unknown as ReturnType<typeof vi.fn>;

function renderAssistantAsGuest() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useAuthStore.setState({ token: null, user: null });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AiAssistant />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('AiAssistant guest access', () => {
  beforeEach(() => {
    mockedGet.mockReset();
    mockedGet.mockRejectedValue(new Error('Network Error'));
  });

  it('tells guests the AI chat needs an account', async () => {
    renderAssistantAsGuest();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /open cooking assistant/i }));

    expect(await screen.findByText('AI chat needs an account')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument();
  });

  it('still offers the Swaps tab to guests', async () => {
    renderAssistantAsGuest();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /open cooking assistant/i }));
    await user.click(screen.getByRole('button', { name: /^swaps$/i }));

    expect(await screen.findByPlaceholderText(/search ingredient/i)).toBeInTheDocument();
    expect(screen.queryByText('AI chat needs an account')).not.toBeInTheDocument();
  });
});
