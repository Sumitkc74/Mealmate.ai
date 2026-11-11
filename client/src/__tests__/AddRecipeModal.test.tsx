import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AddRecipeModal } from '@/components/recipes/AddRecipeModal';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/lib/api';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

const mockedPost = api.post as unknown as ReturnType<typeof vi.fn>;

function renderModal(props: { open: boolean; onClose: () => void; onOpenImport?: () => void; initialPrompt?: string }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AddRecipeModal {...props} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('AddRecipeModal workflow', () => {
  beforeEach(() => {
    mockedPost.mockReset();
    mockNavigate.mockReset();
    useAuthStore.setState({
      token: 'fake',
      user: {
        id: 'u1',
        name: 'Test Chef',
        email: 'chef@example.com',
        role: 'user',
        pantry: [{ ingredient: 'tomato', addedAt: new Date().toISOString() }],
        dietaryPreferences: ['vegetarian'],
        allergies: [],
      },
    });
  });

  it('directly renders recipe creation options: AI generator, manual form, and spreadsheet import on open without database suggestions', () => {
    renderModal({ open: true, onClose: vi.fn() });

    // Directly displays the AI generation option
    expect(screen.getByText('Suggest recipes not present in the system')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/e\.g\. Creamy Tuscan Garlic Salmon/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate with ai/i })).toBeInTheDocument();
    expect(screen.getByText(/AI Suggested Dish Ideas \(Not in system\):/i)).toBeInTheDocument();

    // Directly displays manual form and import spreadsheet cards
    expect(screen.getByText('Fill in manually')).toBeInTheDocument();
    expect(screen.getByText('Import spreadsheet')).toBeInTheDocument();

    // Does NOT render confusing existing database suggestions or empty state
    expect(screen.queryByText('Initial Suggestions (Recipes in your database)')).not.toBeInTheDocument();
    expect(screen.queryByText('Present in database')).not.toBeInTheDocument();
    expect(screen.queryByText(/No matching recipes currently found in your database/i)).not.toBeInTheDocument();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('navigates to manual form or triggers import workflow from creation options', async () => {
    const handleClose = vi.fn();
    const handleOpenImport = vi.fn();
    const user = userEvent.setup();

    renderModal({
      open: true,
      onClose: handleClose,
      onOpenImport: handleOpenImport,
    });

    // Test clicking "Fill in manually"
    const manualBtn = screen.getByText('Fill in manually');
    await user.click(manualBtn);
    expect(handleClose).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/recipes/new');

    // Test clicking "Import spreadsheet"
    const importBtn = screen.getByText('Import spreadsheet');
    await user.click(importBtn);
    expect(handleOpenImport).toHaveBeenCalled();
  });

  it('generates a new recipe and displays the verify review form before saving', async () => {
    mockedPost.mockImplementation(async (url) => {
      if (url.includes('generate')) {
        return {
          data: {
            success: true,
            generated: true,
            saved: false,
            usedQuery: 'Spicy Truffle Risotto',
            recipe: {
              title: 'Spicy Truffle Risotto',
              description: 'Earthy and rich with subtle heat.',
              cuisine: 'italian',
              tags: ['vegetarian', 'dinner'],
              difficulty: 'medium',
              prepTime: 15,
              cookTime: 25,
              servings: 4,
              ingredients: [
                { name: 'arborio rice', quantity: 1, unit: 'cup' },
                { name: 'truffle oil', quantity: 1, unit: 'tbsp' },
              ],
              instructions: ['Toast the rice.', 'Stir in warm broth slowly.', 'Drizzle truffle oil and serve.'],
              nutrition: { calories: 420, protein: 8, carbs: 65, fat: 12 },
            },
          },
        };
      }
      return { data: { success: true, count: 0, results: [] } };
    });

    renderModal({ open: true, onClose: vi.fn() });
    const user = userEvent.setup();

    const input = await screen.findByPlaceholderText(/e\.g\. Creamy Tuscan Garlic Salmon/i);
    await user.type(input, 'Spicy Truffle Risotto');

    const generateBtn = screen.getByRole('button', { name: /generate with ai/i });
    await user.click(generateBtn);

    expect(await screen.findByText('AI Recipe Draft Ready', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Spicy Truffle Risotto')).toBeInTheDocument();
    expect(screen.getByDisplayValue('arborio rice')).toBeInTheDocument();
    expect(screen.getByDisplayValue('truffle oil')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /verify & save recipe/i })).toBeInTheDocument();
  });
});
