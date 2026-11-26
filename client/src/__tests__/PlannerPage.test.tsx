import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PlannerPage } from '../pages/PlannerPage';
import { useAuthStore } from '@/stores/authStore';
import { useGuestStore } from '@/stores/guestStore';
import { api } from '@/lib/api';
import { startOfWeekMondayUTC, toIsoDate } from '@/lib/week';
import type { Recipe } from '@/types';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } };
});

const get = api.get as unknown as ReturnType<typeof vi.fn>;
const post = api.post as unknown as ReturnType<typeof vi.fn>;

function renderPlanner() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter
        initialEntries={['/planner']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/planner" element={<PlannerPage />} />
          <Route path="/grocery/:id" element={<div>Grocery page</div>} />
          <Route path="/login" element={<div>Login page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('PlannerPage', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    useAuthStore.setState({
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
    useGuestStore.setState({ recipes: [], mealPlans: [], pantry: [], groceryLists: [] });
  });

  it('shows empty slots when there is no plan for the current week', async () => {
    get.mockImplementation((url: string) => {
      if (url === '/mealplans') return Promise.resolve({ data: { items: [] } });
      return Promise.resolve({ data: { items: [], total: 0, pages: 1, page: 1, limit: 12 } });
    });

    renderPlanner();
    // Slots are always visible; no plan means all 21 are empty (no recipe titles)
    const slots = await screen.findAllByTestId(/^slot-/);
    expect(slots).toHaveLength(21);
    // No "Create week plan" button should appear
    expect(screen.queryByRole('heading', { name: /no plan for this week yet/i })).not.toBeInTheDocument();
  });

  it('renders 7 days × 3 slot grid when a plan exists', async () => {
    const weekIso = toIsoDate(startOfWeekMondayUTC());
    const plan = {
      id: 'p1',
      user: 'u1',
      weekStartDate: weekIso,
      days: [
        { day: 'Monday', breakfast: { id: 'r1', title: 'Pancakes', prepTime: 5, cookTime: 5, servings: 2 } },
        { day: 'Tuesday' },
        { day: 'Wednesday' },
        { day: 'Thursday' },
        { day: 'Friday' },
        { day: 'Saturday' },
        { day: 'Sunday' },
      ],
    };
    get.mockImplementation((url: string) => {
      if (url === '/mealplans') return Promise.resolve({ data: { items: [plan] } });
      if (url.startsWith('/mealplans/')) return Promise.resolve({ data: { plan } });
      return Promise.resolve({ data: { items: [], total: 0, pages: 1, page: 1, limit: 25 } });
    });

    renderPlanner();
    expect(await screen.findByText('Pancakes')).toBeInTheDocument();
    // 21 slots (7 days × 3 slots)
    const slots = await screen.findAllByTestId(/^slot-/);
    expect(slots).toHaveLength(21);
  });

  it('clears a filled slot when × is clicked', async () => {
    const weekIso = toIsoDate(startOfWeekMondayUTC());
    const plan = {
      id: 'p1',
      user: 'u1',
      weekStartDate: weekIso,
      days: [
        { day: 'Monday', dinner: { id: 'r1', title: 'Pasta', prepTime: 5, cookTime: 10, servings: 2 } },
      ],
    };
    get.mockImplementation((url: string) => {
      if (url === '/mealplans') return Promise.resolve({ data: { items: [plan] } });
      if (url.startsWith('/mealplans/')) return Promise.resolve({ data: { plan } });
      return Promise.resolve({ data: { items: [], total: 0, pages: 1, page: 1, limit: 25 } });
    });
    post.mockResolvedValue({
      data: { plan: { ...plan, days: [{ day: 'Monday' }] } },
    });

    renderPlanner();
    const clearBtn = await screen.findByRole('button', { name: /clear dinner on monday/i });
    await userEvent.setup().click(clearBtn);

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith(
        '/mealplans/p1/assign',
        expect.objectContaining({ day: 'Monday', slot: 'dinner', recipeId: null })
      );
    });
  });

  it('lets guests browse the grid and sends them to sign in to generate a week', async () => {
    useAuthStore.setState({ user: null });
    get.mockImplementation((url: string) => {
      if (url === '/ai/capabilities') {
        return Promise.resolve({
          data: {
            success: true,
            llm: { provider: 'gemini', model: 'gemini-1.5-flash', available: true },
            features: {
              recommend: true,
              similar: true,
              plan_week: true,
              chat: true,
              pantry_parse: true,
            },
          },
        });
      }
      return Promise.resolve({ data: { items: [], total: 0, pages: 1, page: 1, limit: 12 } });
    });

    renderPlanner();
    expect(await screen.findByText(/trying MealMate as a guest/i)).toBeInTheDocument();
    const slots = await screen.findAllByTestId(/^slot-/);
    expect(slots).toHaveLength(21);
    expect(get).not.toHaveBeenCalledWith('/mealplans', expect.anything());

    const generateBtn = await screen.findByRole('button', { name: /generate my week/i });
    await userEvent.setup().click(generateBtn);
    expect(await screen.findByText('Login page')).toBeInTheDocument();
  });

  it('still shows guests the Generate button when the AI service is offline', async () => {
    useAuthStore.setState({ user: null });
    get.mockImplementation((url: string) => {
      if (url === '/ai/capabilities') {
        return Promise.reject(new Error('service down'));
      }
      return Promise.resolve({ data: { items: [], total: 0, pages: 1, page: 1, limit: 12 } });
    });

    renderPlanner();
    expect(await screen.findByText(/trying MealMate as a guest/i)).toBeInTheDocument();
    // A guest click only ever navigates to login, so the button must render
    // even though the AI service is unreachable (no "AI planner offline" wall).
    const generateBtn = await screen.findByRole('button', { name: /generate my week/i });
    await userEvent.setup().click(generateBtn);
    expect(await screen.findByText('Login page')).toBeInTheDocument();
  });

  describe('manual add allergy warn-and-confirm', () => {
    const weekIso = toIsoDate(startOfWeekMondayUTC());
    const emptyPlan = {
      id: 'p1',
      user: 'u1',
      weekStartDate: weekIso,
      days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(
        (day) => ({ day })
      ),
    };
    const pancakes = {
      id: 'r1',
      title: 'Fluffy Pancakes',
      slug: 'fluffy-pancakes',
      ingredients: [
        { name: 'flour' },
        { name: 'milk' },
        { name: 'egg' },
        { name: 'butter' },
        { name: 'sugar' },
      ],
      instructions: ['Mix and cook.'],
      prepTime: 5,
      cookTime: 10,
      servings: 2,
      tags: [],
      difficulty: 'easy',
    };
    const stirFry = {
      id: 'r2',
      title: 'Veggie Stir Fry',
      slug: 'veggie-stir-fry',
      ingredients: [{ name: 'rice' }, { name: 'tomato' }, { name: 'garlic' }],
      instructions: ['Stir and fry.'],
      prepTime: 5,
      cookTime: 10,
      servings: 2,
      tags: [],
      difficulty: 'easy',
    };

    function mockPlannerGets(picked: typeof pancakes | typeof stirFry) {
      get.mockImplementation((url: string) => {
        if (url === '/mealplans') return Promise.resolve({ data: { items: [emptyPlan] } });
        if (url.startsWith('/mealplans/')) return Promise.resolve({ data: { plan: emptyPlan } });
        if (url === `/recipes/${picked.id}`) return Promise.resolve({ data: { recipe: picked } });
        if (url === '/recipes') {
          return Promise.resolve({
            data: { items: [picked], total: 1, pages: 1, page: 1, limit: 20 },
          });
        }
        return Promise.resolve({ data: { items: [], total: 0, pages: 1, page: 1, limit: 25 } });
      });
      post.mockResolvedValue({ data: { plan: emptyPlan } });
    }

    function setAllergies(allergies: string[]) {
      useAuthStore.setState({
        user: {
          id: 'u1',
          name: 'Test',
          email: 't@x.com',
          role: 'user',
          pantry: [],
          dietaryPreferences: [],
          allergies,
        },
      });
    }

    async function pickRecipeFromSlot(title: RegExp) {
      const user = userEvent.setup();
      renderPlanner();
      await screen.findAllByTestId(/^slot-/);
      const slot = screen.getByTestId('slot-Monday-breakfast');
      await user.click(within(slot).getByRole('button', { name: '+ Add' }));
      const pickBtn = await screen.findByRole('button', { name: title });
      await user.click(pickBtn);
      return user;
    }

    it('shows the allergy warning and does NOT add the recipe when cancelled', async () => {
      setAllergies(['dairy']);
      mockPlannerGets(pancakes);
      const user = await pickRecipeFromSlot(/fluffy pancakes/i);

      const dialog = await screen.findByRole('dialog', { name: /allergy warning/i });
      expect(dialog).toHaveTextContent(/contains milk/i);
      expect(dialog).toHaveTextContent(/dairy allergy/i);
      // Nothing has been written to the plan yet.
      expect(post).not.toHaveBeenCalled();

      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: /allergy warning/i })).not.toBeInTheDocument();
      });
      // Cancelling leaves the slot untouched — no assign call at all.
      expect(post).not.toHaveBeenCalled();
    });

    it('adds the recipe when the warning is confirmed', async () => {
      setAllergies(['dairy']);
      mockPlannerGets(pancakes);
      const user = await pickRecipeFromSlot(/fluffy pancakes/i);

      const dialog = await screen.findByRole('dialog', { name: /allergy warning/i });
      await user.click(within(dialog).getByRole('button', { name: 'Add anyway' }));

      await waitFor(() => {
        expect(post).toHaveBeenCalledWith(
          '/mealplans/p1/assign',
          expect.objectContaining({ day: 'Monday', slot: 'breakfast', recipeId: 'r1' })
        );
      });
    });

    it('adds a safe recipe with no warning', async () => {
      setAllergies(['dairy']);
      mockPlannerGets(stirFry);
      await pickRecipeFromSlot(/veggie stir fry/i);

      await waitFor(() => {
        expect(post).toHaveBeenCalledWith(
          '/mealplans/p1/assign',
          expect.objectContaining({ day: 'Monday', slot: 'breakfast', recipeId: 'r2' })
        );
      });
      expect(screen.queryByRole('dialog', { name: /allergy warning/i })).not.toBeInTheDocument();
    });
  });

  describe('guest manual add allergy warn-and-confirm', () => {
    const pancakes: Recipe = {
      id: 'r1',
      slug: 'fluffy-pancakes',
      title: 'Fluffy Pancakes',
      ingredients: [
        { name: 'flour' },
        { name: 'milk' },
        { name: 'egg' },
        { name: 'butter' },
        { name: 'sugar' },
      ],
      instructions: ['Mix and cook.'],
      prepTime: 5,
      cookTime: 10,
      servings: 2,
      tags: [],
      difficulty: 'easy',
    };
    const stirFry: Recipe = {
      id: 'r2',
      slug: 'veggie-stir-fry',
      title: 'Veggie Stir Fry',
      ingredients: [{ name: 'rice' }, { name: 'tomato' }, { name: 'garlic' }],
      instructions: ['Stir and fry.'],
      prepTime: 5,
      cookTime: 10,
      servings: 2,
      tags: [],
      difficulty: 'easy',
    };

    function seedGuest(allergies: string[], recipes: Recipe[]) {
      useAuthStore.setState({ user: null });
      useGuestStore.setState({
        allergies,
        recipes,
        mealPlans: [],
        pantry: [],
        groceryLists: [],
      });
      get.mockImplementation((url: string) => {
        if (url === '/ai/capabilities') {
          return Promise.resolve({
            data: {
              success: true,
              llm: { provider: 'gemini', model: 'gemini-1.5-flash', available: true },
              features: { recommend: true, similar: true, plan_week: true, chat: true, pantry_parse: true },
            },
          });
        }
        return Promise.resolve({ data: { items: [], total: 0, pages: 1, page: 1, limit: 25 } });
      });
    }

    async function pickGuestRecipe(title: RegExp) {
      const user = userEvent.setup();
      renderPlanner();
      await screen.findAllByTestId(/^slot-/);
      const slot = screen.getByTestId('slot-Monday-breakfast');
      await user.click(within(slot).getByRole('button', { name: '+ Add' }));
      const pickBtn = await screen.findByRole('button', { name: title });
      await user.click(pickBtn);
      return user;
    }

    function guestMondayBreakfast() {
      const plans = useGuestStore.getState().mealPlans;
      const monday = plans[0]?.days.find((d) => d.day === 'Monday');
      const slot = monday?.breakfast;
      return slot && typeof slot === 'object' ? (slot as { title?: string }).title : undefined;
    }

    it('warns a guest with a dairy allergy and does NOT add the recipe when cancelled', async () => {
      seedGuest(['dairy'], [pancakes]);
      const user = await pickGuestRecipe(/fluffy pancakes/i);

      const dialog = await screen.findByRole('dialog', { name: /allergy warning/i });
      expect(dialog).toHaveTextContent(/contains milk/i);
      expect(dialog).toHaveTextContent(/dairy allergy/i);

      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: /allergy warning/i })).not.toBeInTheDocument();
      });
      // Cancelling leaves the guest plan untouched — no plan was created.
      expect(useGuestStore.getState().mealPlans).toHaveLength(0);
      expect(post).not.toHaveBeenCalled();
    });

    it('adds the recipe to the guest plan when the warning is confirmed', async () => {
      seedGuest(['dairy'], [pancakes]);
      const user = await pickGuestRecipe(/fluffy pancakes/i);

      const dialog = await screen.findByRole('dialog', { name: /allergy warning/i });
      await user.click(within(dialog).getByRole('button', { name: 'Add anyway' }));

      await waitFor(() => {
        expect(guestMondayBreakfast()).toBe('Fluffy Pancakes');
      });
      expect(post).not.toHaveBeenCalled();
    });

    it('adds a safe recipe to the guest plan with no warning', async () => {
      seedGuest(['dairy'], [stirFry]);
      await pickGuestRecipe(/veggie stir fry/i);

      await waitFor(() => {
        expect(guestMondayBreakfast()).toBe('Veggie Stir Fry');
      });
      expect(screen.queryByRole('dialog', { name: /allergy warning/i })).not.toBeInTheDocument();
      expect(post).not.toHaveBeenCalled();
    });
  });
});
