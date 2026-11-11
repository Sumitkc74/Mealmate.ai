import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SuggestedRecipes } from '@/components/recipes/SuggestedRecipes';
import { HomePage } from '@/pages/HomePage';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/lib/api';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

const mockedPost = api.post as unknown as ReturnType<typeof vi.fn>;

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        {ui}
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('SuggestedRecipes & HomePage suggestions flow', () => {
  beforeEach(() => {
    mockedPost.mockReset();
    useAuthStore.setState({
      token: 'test-token',
      user: {
        id: 'u1',
        name: 'Chef Test',
        email: 'chef@test.com',
        role: 'user',
        pantry: [
          { ingredient: 'garlic', addedAt: new Date().toISOString() },
          { ingredient: 'pasta', addedAt: new Date().toISOString() },
        ],
        dietaryPreferences: ['vegetarian'],
        allergies: [],
      },
    });
  });

  it('displays suggestions from recipes present in the system first with catalog badges', async () => {
    mockedPost.mockResolvedValueOnce({
      data: {
        success: true,
        count: 2,
        strategy: 'hybrid',
        results: [
          {
            _id: 'recipe-123',
            recipe_id: 'garlic-pasta',
            title: 'Garlic Butter Spaghetti',
            score: 0.95,
            matched_ingredients: ['garlic', 'pasta'],
            reason: 'Matches garlic & pasta from your pantry',
            prepTime: 10,
            cookTime: 15,
            servings: 2,
            cuisine: 'italian',
            difficulty: 'easy',
            signals: [
              { name: 'tfidf', score: 0.9 },
              { name: 'lsa', score: 0.92 },
            ],
          },
        ],
      },
    });

    renderWithClient(<SuggestedRecipes />);

    expect(await screen.findByText('Garlic Butter Spaghetti')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /suggested for you/i })).toBeInTheDocument();
    expect(screen.getByText('Present in database')).toBeInTheDocument();
    expect(screen.getByText('95%')).toBeInTheDocument();
    expect(screen.getByText(/Matches garlic & pasta from your pantry/i)).toBeInTheDocument();
    expect(screen.getByText(/Not happy with these existing recipe suggestions\?/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /suggest new recipes with ai/i })).toBeInTheDocument();
  });

  it('allows the user to switch to AI generated option mode and explore dishes not in system', async () => {
    mockedPost.mockResolvedValueOnce({
      data: {
        success: true,
        count: 1,
        strategy: 'hybrid',
        results: [
          {
            recipe_id: 'garlic-pasta',
            title: 'Garlic Butter Spaghetti',
            score: 0.9,
            matched_ingredients: [],
            reason: '',
          },
        ],
      },
    });

    renderWithClient(<SuggestedRecipes />);
    const user = userEvent.setup();

    const aiTabBtn = await screen.findByRole('button', { name: /ai generated option/i });
    await user.click(aiTabBtn);

    expect(await screen.findByText(/ai-generated recipes \(not present in database\)/i)).toBeInTheDocument();
    expect(screen.getByText('Garlic Butter Tuscan Salmon')).toBeInTheDocument();
    expect(screen.getByText('15-Min Thai Basil Chicken')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/enter any custom craving/i)).toBeInTheDocument();
  });

  it('opens AddRecipeModal when user chooses to suggest new recipes with AI', async () => {
    mockedPost.mockResolvedValueOnce({
      data: {
        success: true,
        count: 1,
        strategy: 'hybrid',
        results: [
          {
            recipe_id: 'garlic-pasta',
            title: 'Garlic Butter Spaghetti',
            score: 0.9,
            matched_ingredients: [],
            reason: '',
          },
        ],
      },
    });

    renderWithClient(<SuggestedRecipes />);
    const user = userEvent.setup();

    const suggestAiBtn = await screen.findByRole('button', { name: /suggest new recipes with ai/i });
    await user.click(suggestAiBtn);

    expect(await screen.findByText(/suggest recipes not present in the system/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate with ai/i })).toBeInTheDocument();
  });

  it('renders preview on HomePage when user is logged out, and full suggestions when logged in', async () => {
    // 1. Logged out state
    useAuthStore.setState({ token: null, user: null });
    const { unmount } = renderWithClient(<HomePage />);

    expect(await screen.findByRole('heading', { level: 2, name: /suggested for you/i })).toBeInTheDocument();
    expect(screen.getByText(/sign in to view suggestions/i)).toBeInTheDocument();

    unmount();

    // 2. Logged in state
    useAuthStore.setState({
      token: 'active-token',
      user: {
        id: 'u1',
        name: 'Logged Chef',
        email: 'chef@authed.com',
        role: 'user',
        pantry: [{ ingredient: 'garlic', addedAt: new Date().toISOString() }],
        dietaryPreferences: [],
        allergies: [],
      },
    });

    mockedPost.mockResolvedValueOnce({
      data: {
        success: true,
        count: 1,
        strategy: 'hybrid',
        results: [
          {
            recipe_id: 'herb-garlic-bread',
            title: 'Herb Garlic Bread',
            score: 0.92,
            matched_ingredients: ['garlic'],
            reason: 'Delicious garlic bread',
          },
        ],
      },
    });

    renderWithClient(<HomePage />);

    expect(await screen.findByText('Herb Garlic Bread')).toBeInTheDocument();
    expect(screen.getByText('Present in database')).toBeInTheDocument();
    expect(screen.getByText(/Not happy with these existing recipe suggestions\?/i)).toBeInTheDocument();
  });
});
