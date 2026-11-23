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
const mockedPost = api.post as unknown as ReturnType<typeof vi.fn>;

function renderAssistantAsGuest() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useAuthStore.setState({ user: null });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AiAssistant />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function renderAssistantAsUser() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useAuthStore.setState({
    user: { id: 'u1', name: 'Test', email: 't@x.com', role: 'user', pantry: [], dietaryPreferences: [], allergies: [] },
  });
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
    mockedPost.mockReset();
    mockedPost.mockRejectedValue(new Error('Network Error'));
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

  it('fetches guest substitutions through the api client, not a relative /api path', async () => {
    mockedGet.mockImplementation((url: string) => {
      if (url === '/ai/knowledge/substitutes') {
        return Promise.resolve({
          data: {
            substitutions: [
              { target: 'butter', substitute: 'Olive oil', ratio: '1:0.75', context: 'savoury', notes: 'Great for sauteing.' },
            ],
          },
        });
      }
      return Promise.reject(new Error('Network Error'));
    });
    renderAssistantAsGuest();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /open cooking assistant/i }));
    await user.click(screen.getByRole('button', { name: /^swaps$/i }));
    await user.type(screen.getByPlaceholderText(/search ingredient/i), 'butter');
    await user.click(screen.getByRole('button', { name: /^find$/i }));

    expect(await screen.findByText('Olive oil')).toBeInTheDocument();
    expect(screen.getByText(/Ratio: 1:0.75/)).toBeInTheDocument();
    expect(mockedGet).toHaveBeenCalledWith(
      '/ai/knowledge/substitutes',
      expect.objectContaining({ params: { ingredient: 'butter' } }),
    );
  });

  it('asks recipe questions through the api client, not a relative /api path', async () => {
    mockedPost.mockResolvedValue({
      data: { answer: 'Try a quick pasta with tomato.', recipes: [] },
    });
    renderAssistantAsUser();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /open cooking assistant/i }));
    await user.click(screen.getByRole('button', { name: /^q&a$/i }));
    await user.type(screen.getByLabelText(/recipe question/i), 'What can I make with tomato?');
    await user.click(screen.getByRole('button', { name: /^ask$/i }));

    expect(await screen.findByText('Try a quick pasta with tomato.')).toBeInTheDocument();
    expect(mockedPost).toHaveBeenCalledWith(
      '/ai/rag/query',
      { question: 'What can I make with tomato?', top_k: 5 },
      expect.anything(),
    );
  });
});
