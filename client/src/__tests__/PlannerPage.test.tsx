import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PlannerPage } from '../pages/PlannerPage';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/lib/api';
import { startOfWeekMondayUTC, toIsoDate } from '@/lib/week';

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
});
