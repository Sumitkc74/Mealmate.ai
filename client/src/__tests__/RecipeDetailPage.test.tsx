import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RecipeDetailPage } from '@/pages/RecipeDetailPage';
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
const mockedPatch = api.patch as unknown as ReturnType<typeof vi.fn>;

const mockRecipe = {
  id: 'r1',
  title: 'Garlic Butter Pasta',
  description: 'Classic rich garlic pasta.',
  prepTime: 10,
  cookTime: 15,
  servings: 2,
  difficulty: 'easy',
  cuisine: 'Italian',
  ingredients: [
    { name: 'Pasta', quantity: 200, unit: 'g' },
    { name: 'Garlic cloves', quantity: 4, unit: 'pcs' },
    { name: 'Butter', quantity: 50, unit: 'g' },
  ],
  instructions: [
    'Boil salted water and cook pasta for 10 minutes until al dente.',
    'Melt butter in a pan and sauté garlic for 3 mins.',
    'Toss pasta with garlic butter and serve.',
  ],
  nutrition: {
    calories: 450,
    protein: 12,
    carbs: 60,
    fat: 18,
  },
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/recipes/r1']}>
        <Routes>
          <Route path="/recipes/:id" element={<RecipeDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('RecipeDetailPage Enhancements', () => {
  beforeEach(() => {
    mockedGet.mockReset();
    mockedPatch.mockReset();
    mockedGet.mockResolvedValue({ data: { recipe: mockRecipe } });

    useAuthStore.setState({
      token: 'valid-token',
      user: {
        id: 'u1',
        name: 'Chef Tester',
        email: 'tester@example.com',
        role: 'user',
        pantry: [
          { ingredient: 'garlic cloves', quantity: '10', unit: 'pcs' },
          { ingredient: 'butter', quantity: '200', unit: 'g' },
          { ingredient: 'soy sauce' },
        ],
        cookingHistory: [
          {
            recipeId: 'r1',
            recipeTitle: 'Garlic Butter Pasta',
            cookedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
            servingsCooked: 2,
            rating: 5,
            notes: 'Turned out amazing with extra garlic!',
          },
        ],
        dietaryPreferences: [],
        allergies: [],
      },
    });
  });

  it('renders recipe details, servings, and scaled ingredients', async () => {
    renderPage();

    expect(await screen.findByText('Garlic Butter Pasta')).toBeInTheDocument();
    expect(screen.getAllByText(/2 servings/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('200 g')).toBeInTheDocument();
    expect(screen.getByText('4 pcs')).toBeInTheDocument();
  });

  it('displays user cooking history badge and chef notes', async () => {
    renderPage();

    await screen.findByText('Garlic Butter Pasta');

    // Header badge
    expect(screen.getByText(/Cooked 1x/i)).toBeInTheDocument();

    // History card and personal notes
    expect(screen.getByText(/You've cooked this 1 time!/i)).toBeInTheDocument();
    expect(screen.getByText(/Turned out amazing with extra garlic!/i)).toBeInTheDocument();
  });

  it('dynamically scales ingredients when adjusting the servings stepper', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Garlic Butter Pasta');

    // Default is 2 servings. Increase to 3 servings (ratio 1.5x)
    const plusBtn = screen.getByRole('button', { name: /increase servings/i });
    await user.click(plusBtn);

    // 200g * 1.5 = 300g, 4 * 1.5 = 6 pcs
    expect(screen.getByText('300 g')).toBeInTheDocument();
    expect(screen.getByText('6 pcs')).toBeInTheDocument();

    // Reset button should be visible
    const resetBtn = screen.getByText(/Reset \(2\)/i);
    await user.click(resetBtn);
    expect(screen.getByText('200 g')).toBeInTheDocument();
  });

  it('renders interactive in-instruction timer chips and starts timer widget', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Garlic Butter Pasta');

    // Check timer button generated from "cook pasta for 10 minutes"
    const timerBtn = screen.getByRole('button', { name: /Start 10 minutes timer/i });
    expect(timerBtn).toBeInTheDocument();

    await user.click(timerBtn);

    // Floating active timer widget should now appear
    expect(screen.getByText(/Step 1 \(10 minutes\)/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pause/i })).toBeInTheDocument();
  });

  it('opens Kitchen Mode modal when clicking Kitchen Mode button', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Garlic Butter Pasta');

    const kitchenBtn = screen.getByRole('button', { name: /Kitchen Mode/i });
    await user.click(kitchenBtn);

    // Check modal appears
    expect(screen.getByRole('dialog', { name: /Kitchen Cooking Mode/i })).toBeInTheDocument();
  });

  it('opens "I Cooked This!" modal and logs cooking history and deducts pantry items', async () => {
    const user = userEvent.setup();
    mockedPatch.mockResolvedValue({
      data: {
        user: {
          id: 'u1',
          name: 'Chef Tester',
          email: 'tester@example.com',
          role: 'user',
          pantry: [{ ingredient: 'soy sauce' }],
          cookingHistory: [],
          dietaryPreferences: [],
          allergies: [],
        },
      },
    });

    renderPage();

    await screen.findByText('Garlic Butter Pasta');

    const cookedBtn = screen.getByRole('button', { name: /I Cooked This!/i });
    await user.click(cookedBtn);

    // Check modal opened
    const dialog = screen.getByRole('dialog', { name: /I Cooked This Recipe!/i });
    expect(dialog).toBeInTheDocument();

    // Check detected matching pantry items inside modal
    expect(within(dialog).getByText(/garlic cloves/i)).toBeInTheDocument();
    expect(within(dialog).getByText('butter')).toBeInTheDocument();

    // Enter personal notes
    const notesInput = within(dialog).getByPlaceholderText(/Added extra garlic/i);
    await user.type(notesInput, 'Added extra parmesan on top');

    const deductBtn = within(dialog).getByRole('button', { name: /Deduct 2 Items & Log/i });
    await user.click(deductBtn);

    expect(mockedPatch).toHaveBeenCalledWith(
      '/auth/me',
      expect.objectContaining({
        pantry: [{ ingredient: 'soy sauce' }],
        cookingHistory: expect.arrayContaining([
          expect.objectContaining({
            recipeId: 'r1',
            recipeTitle: 'Garlic Butter Pasta',
            notes: 'Added extra parmesan on top',
          }),
        ]),
      })
    );
  });
});

