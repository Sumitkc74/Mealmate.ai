import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PantryPage } from '@/pages/PantryPage';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/lib/api';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

const mockedPatch = api.patch as unknown as ReturnType<typeof vi.fn>;

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

describe('PantryPage & Modern Minimalist Pantry UI', () => {
  beforeEach(() => {
    mockedPatch.mockReset();
    useAuthStore.setState({
      token: 'test-token',
      user: {
        id: 'u1',
        name: 'Chef Test',
        email: 'chef@test.com',
        role: 'user',
        pantry: [
          {
            ingredient: 'fresh basil',
            quantity: '1',
            unit: 'bunch',
            category: 'produce',
            addedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
          },
          {
            ingredient: 'parmesan',
            quantity: '200',
            unit: 'g',
            category: 'dairy',
            addedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          },
          {
            ingredient: 'olive oil',
            quantity: '1',
            unit: 'bottle',
            category: 'pantry',
            addedAt: new Date().toISOString(),
          },
        ],
        dietaryPreferences: ['vegetarian'],
        allergies: ['peanuts'],
      },
    });
  });

  it('renders pantry items with clean category headers, count, and chips', async () => {
    renderWithClient(<PantryPage />);

    const pantrySection = screen.getByRole('region', { name: /in your pantry/i });
    const pScreen = within(pantrySection);

    expect(screen.getByRole('heading', { level: 1, name: /pantry & preferences/i })).toBeInTheDocument();
    expect(pScreen.getByRole('heading', { level: 2, name: /in your pantry/i })).toBeInTheDocument();
    expect(pScreen.getByText('3 items')).toBeInTheDocument();

    // Verify items are displayed inside pantry section
    expect(pScreen.getByText('fresh basil')).toBeInTheDocument();
    expect(pScreen.getByText('1 bunch')).toBeInTheDocument();
    expect(pScreen.getByText('parmesan')).toBeInTheDocument();
    expect(pScreen.getByText('200 g')).toBeInTheDocument();
    expect(pScreen.getByText('olive oil')).toBeInTheDocument();
  });

  it('filters pantry items by category when clicking category chips', async () => {
    renderWithClient(<PantryPage />);
    const user = userEvent.setup();

    const pantrySection = screen.getByRole('region', { name: /in your pantry/i });
    const pScreen = within(pantrySection);

    // Click on Produce chip
    const produceBtn = pScreen.getByRole('button', { name: /produce 1/i });
    await user.click(produceBtn);

    // Fresh basil should remain visible, parmesan should not be in the filtered list
    expect(pScreen.getByText('fresh basil')).toBeInTheDocument();
    expect(pScreen.queryByText('parmesan')).not.toBeInTheDocument();
  });

  it('filters pantry items live using search input', async () => {
    renderWithClient(<PantryPage />);
    const user = userEvent.setup();

    const pantrySection = screen.getByRole('region', { name: /in your pantry/i });
    const pScreen = within(pantrySection);

    const searchInput = pScreen.getByPlaceholderText(/search your pantry ingredients/i);
    await user.type(searchInput, 'olive');

    expect(pScreen.getByText('olive oil')).toBeInTheDocument();
    expect(pScreen.queryByText('fresh basil')).not.toBeInTheDocument();
  });

  it('allows switching view mode to List table view', async () => {
    renderWithClient(<PantryPage />);
    const user = userEvent.setup();

    const pantrySection = screen.getByRole('region', { name: /in your pantry/i });
    const pScreen = within(pantrySection);

    // Switch to List view
    const listBtn = pScreen.getByRole('button', { name: /list/i });
    await user.click(listBtn);

    expect(pScreen.getByRole('table')).toBeInTheDocument();
    expect(pScreen.getByText('Freshness Status')).toBeInTheDocument();
  });

  it('displays minimalist dietary preferences toggle pills with 1-click toggling', async () => {
    mockedPatch.mockResolvedValueOnce({
      data: {
        user: {
          ...useAuthStore.getState().user!,
          dietaryPreferences: ['vegetarian', 'keto'],
        },
      },
    });

    renderWithClient(<PantryPage />);
    const user = userEvent.setup();

    expect(screen.getByRole('heading', { level: 2, name: /dietary preferences/i })).toBeInTheDocument();
    expect(screen.getByText('1 active')).toBeInTheDocument();

    // Click on Keto toggle pill
    const ketoBtn = screen.getByRole('button', { name: /keto/i });
    await user.click(ketoBtn);

    expect(mockedPatch).toHaveBeenCalledWith(
      '/auth/me',
      expect.objectContaining({
        dietaryPreferences: ['vegetarian', 'keto'],
      })
    );
  });

  it('displays minimalist allergies toggle pills with 1-click toggling', async () => {
    mockedPatch.mockResolvedValueOnce({
      data: {
        user: {
          ...useAuthStore.getState().user!,
          allergies: ['peanuts', 'shellfish'],
        },
      },
    });

    renderWithClient(<PantryPage />);
    const user = userEvent.setup();

    expect(screen.getByRole('heading', { level: 2, name: /allergies & intolerances/i })).toBeInTheDocument();
    expect(screen.getByText('1 critical allergen')).toBeInTheDocument();

    // Click Shellfish toggle pill
    const shellfishBtn = screen.getByRole('button', { name: /shellfish/i });
    await user.click(shellfishBtn);

    expect(mockedPatch).toHaveBeenCalledWith(
      '/auth/me',
      expect.objectContaining({
        allergies: ['peanuts', 'shellfish'],
      })
    );
  });

  it('displays expiring items alert banner and supports filtering to expiring items', async () => {
    // Set an item that expires in 1 day
    useAuthStore.setState({
      token: 'test-token',
      user: {
        id: 'u1',
        name: 'Chef Test',
        email: 'chef@test.com',
        role: 'user',
        pantry: [
          {
            ingredient: 'ripe avocado',
            category: 'produce',
            expiresAt: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString(),
          },
          {
            ingredient: 'dry pasta',
            category: 'pantry',
            expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
          },
        ],
        dietaryPreferences: [],
        allergies: [],
      },
    });

    renderWithClient(<PantryPage />);
    const user = userEvent.setup();

    const pantrySection = screen.getByRole('region', { name: /in your pantry/i });
    const pScreen = within(pantrySection);

    // Verify alert banner is shown
    expect(pScreen.getByText(/1 item requires attention/i)).toBeInTheDocument();
    expect(pScreen.getAllByText(/ripe avocado/i).length).toBeGreaterThanOrEqual(1);

    // Toggle filter expiring items
    const filterBtn = pScreen.getByRole('button', { name: /Filter Expiring Items/i });
    await user.click(filterBtn);

    // Only ripe avocado should be visible, dry pasta hidden
    expect(pScreen.getAllByText(/ripe avocado/i).length).toBeGreaterThanOrEqual(1);
    expect(pScreen.queryByText('dry pasta')).not.toBeInTheDocument();
  });

  it('allows picking a shelf-life preset when adding an item', async () => {
    mockedPatch.mockResolvedValueOnce({
      data: {
        user: {
          ...useAuthStore.getState().user!,
          pantry: [
            ...useAuthStore.getState().user!.pantry,
            { ingredient: 'fresh salmon', category: 'seafood' },
          ],
        },
      },
    });

    renderWithClient(<PantryPage />);
    const user = userEvent.setup();

    const pantrySection = screen.getByRole('region', { name: /in your pantry/i });
    const pScreen = within(pantrySection);

    const ingInput = pScreen.getByLabelText(/ingredient name/i);
    await user.type(ingInput, 'fresh salmon');

    // Select +3 days preset
    const preset3d = pScreen.getByRole('button', { name: /\+3 days/i });
    await user.click(preset3d);

    const addBtn = pScreen.getByRole('button', { name: /\+ Add/i });
    await user.click(addBtn);

    expect(mockedPatch).toHaveBeenCalledWith(
      '/auth/me',
      expect.objectContaining({
        pantry: expect.arrayContaining([
          expect.objectContaining({
            ingredient: 'fresh salmon',
          }),
        ]),
      })
    );
  });

  it('renders cooking history section with meals, ratings, and notes', async () => {
    useAuthStore.setState({
      token: 'test-token',
      user: {
        id: 'u1',
        name: 'Chef Test',
        email: 'chef@test.com',
        role: 'user',
        pantry: [],
        cookingHistory: [
          {
            recipeId: 'rec-123',
            recipeTitle: 'Creamy Mushroom Risotto',
            cookedAt: new Date(Date.now() - 3600 * 1000).toISOString(),
            servingsCooked: 3,
            rating: 5,
            notes: 'Loved by the whole family!',
          },
        ],
        dietaryPreferences: [],
        allergies: [],
      },
    });

    renderWithClient(<PantryPage />);

    const historySection = screen.getByRole('region', { name: /cooking history/i });
    const hScreen = within(historySection);

    expect(hScreen.getByText(/1 meal cooked/i)).toBeInTheDocument();
    expect(hScreen.getByText('Creamy Mushroom Risotto')).toBeInTheDocument();
    expect(hScreen.getByText(/Loved by the whole family!/i)).toBeInTheDocument();
    expect(hScreen.getByRole('link', { name: /Cook Again/i })).toHaveAttribute('href', '/recipes/rec-123');
  });
});

