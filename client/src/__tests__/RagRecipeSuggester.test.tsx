import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RagRecipeSuggester } from '@/components/pantry/RagRecipeSuggester';
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

function renderSuggester() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useAuthStore.setState({
    token: 'test-token',
    user: { id: 'u1', name: 'Test', email: 't@x.com', role: 'user', pantry: [], dietaryPreferences: [], allergies: [] },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <RagRecipeSuggester pantry={[{ ingredient: 'tomato' }]} dietaryPreferences={[]} allergies={[]} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('RagRecipeSuggester', () => {
  beforeEach(() => {
    mockedGet.mockReset();
    mockedGet.mockImplementation((url: string) => {
      if (url === '/ai/capabilities') {
        return Promise.resolve({
          data: {
            success: true,
            llm: { provider: 'gemini', model: 'gemini-1.5-flash', available: true },
            features: { recommend: true, similar: true, plan_week: true, chat: true, pantry_parse: true },
          },
        });
      }
      return Promise.resolve({ data: { items: [], total: 0, pages: 1, page: 1, limit: 200 } });
    });
    mockedPost.mockReset();
  });

  it('fetches RAG suggestions through the api client, not a relative /api path', async () => {
    mockedPost.mockResolvedValue({
      data: {
        success: true,
        suggestion: 'Try tomato pasta tonight.',
        recipes: [
          { id: '6a29c8d0d2c5aa3d4148c341', title: 'Chicken Alfredo Pasta', cuisine: 'Italian', ingredients: ['pasta', 'cream'], similarity_score: 0.9 },
        ],
        method: 'rag_gemini',
        rag_available: true,
      },
    });
    renderSuggester();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /find matching recipes/i }));

    expect(await screen.findByText('Try tomato pasta tonight.')).toBeInTheDocument();
    expect(screen.getByText('Chicken Alfredo Pasta')).toBeInTheDocument();
    expect(mockedPost).toHaveBeenCalledWith(
      '/ai/rag/suggest',
      expect.objectContaining({ pantry: ['tomato'], top_k: 5 }),
      expect.anything(),
    );
  });
});
