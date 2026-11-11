import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RecipesPage } from '../pages/RecipesPage';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/lib/api';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: { get: vi.fn(), post: vi.fn() },
  };
});

const mockedGet = api.get as unknown as ReturnType<typeof vi.fn>;
const mockedPost = api.post as unknown as ReturnType<typeof vi.fn>;

function makeRecipe(id: string, overrides: Record<string, unknown> = {}) {
  return {
    _id: id,
    slug: `slug-${id}`,
    title: `Recipe ${id}`,
    description: `Tasty ${id}`,
    ingredients: [{ name: 'salt' }],
    instructions: ['cook'],
    prepTime: 5,
    cookTime: 10,
    servings: 2,
    tags: ['quick'],
    difficulty: 'easy',
    ...overrides,
  };
}

function renderPage(initial = '/recipes') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter
        initialEntries={[initial]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/recipes" element={<RecipesPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('RecipesPage', () => {
  beforeEach(() => {
    mockedGet.mockReset();
    mockedPost.mockReset();
    // SuggestedRecipes calls POST /ai/recipes/recommend; resolve to empty so the
    // panel renders quietly without affecting other assertions.
    mockedPost.mockResolvedValue({ data: { success: true, count: 0, results: [] } });
    useAuthStore.setState({
      token: 'fake',
      user: {
        id: 'u1',
        name: 'Test',
        email: 't@x.com',
        role: 'user',
        pantry: [],
        dietaryPreferences: [],
        allergies: [],
      },
    });
  });

  it('renders recipe cards from the API', async () => {
    mockedGet.mockResolvedValueOnce({
      data: {
        success: true,
        page: 1,
        limit: 12,
        total: 2,
        pages: 1,
        items: [makeRecipe('a', { title: 'Pancakes' }), makeRecipe('b', { title: 'Spaghetti' })],
      },
    });

    renderPage();

    expect(await screen.findByText('Pancakes')).toBeInTheDocument();
    expect(screen.getByText('Spaghetti')).toBeInTheDocument();
    expect(screen.getByText('2 recipes')).toBeInTheDocument();
  });

  it('shows an empty state when no recipes', async () => {
    mockedGet.mockResolvedValueOnce({
      data: { success: true, page: 1, limit: 12, total: 0, pages: 1, items: [] },
    });

    renderPage();
    expect(await screen.findByRole('heading', { name: /no recipes yet/i })).toBeInTheDocument();
  });

  it('passes search query to the API after debounce', async () => {
    mockedGet.mockResolvedValue({
      data: { success: true, page: 1, limit: 12, total: 0, pages: 1, items: [] },
    });

    renderPage();
    const user = userEvent.setup();
    const searchBox = await screen.findByLabelText(/search recipes/i);
    await user.type(searchBox, 'chicken');

    await waitFor(
      () => {
        const calls = mockedGet.mock.calls;
        const last = calls[calls.length - 1];
        expect(last?.[1]?.params?.q).toBe('chicken');
      },
      { timeout: 2000 }
    );
  });
});
