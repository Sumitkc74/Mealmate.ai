import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProfilePrivacyPage } from '@/pages/ProfilePrivacyPage';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/lib/api';
import type { User } from '@/types';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

const mockedDelete = api.delete as unknown as ReturnType<typeof vi.fn>;

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

const testUser: User = {
  id: 'u1',
  name: 'Chef Test',
  email: 'chef@test.com',
  role: 'user',
  pantry: [],
  dietaryPreferences: [],
  allergies: [],
};

describe('ProfilePrivacyPage delete-account recipe choice', () => {
  beforeEach(() => {
    mockedDelete.mockReset();
    mockedDelete.mockResolvedValue({ data: { success: true } });
    localStorage.clear();
    useAuthStore.setState({ user: testUser });
  });

  async function openDeleteModal() {
    const user = userEvent.setup();
    renderWithClient(<ProfilePrivacyPage />);
    await user.click(screen.getByRole('button', { name: /delete my account/i }));
    return user;
  }

  it('renders the recipe choice with "leave" as the default', async () => {
    await openDeleteModal();
    const leave = screen.getByRole('radio', { name: /^leave/i });
    const deleteToo = screen.getByRole('radio', { name: /^delete/i });
    expect(leave).toBeChecked();
    expect(deleteToo).not.toBeChecked();
    expect(
      screen.getByText(/my recipes stay in the shared library as community recipes, and anyone signed in can edit them/i)
    ).toBeInTheDocument();
  });

  it('sends deleteRecipes=false by default', async () => {
    const user = await openDeleteModal();
    await user.type(screen.getByLabelText(/type leave to confirm/i), 'LEAVE');
    await user.click(screen.getByRole('button', { name: /permanently delete everything/i }));
    await waitFor(() => {
      expect(mockedDelete).toHaveBeenCalledWith('/auth/me', {
        data: { deleteRecipes: false },
      });
    });
  });

  it('sends deleteRecipes=true when "Delete" is chosen', async () => {
    const user = await openDeleteModal();
    await user.click(screen.getByRole('radio', { name: /^delete/i }));
    await user.type(screen.getByLabelText(/type delete to confirm/i), 'DELETE');
    await user.click(screen.getByRole('button', { name: /permanently delete everything/i }));
    await waitFor(() => {
      expect(mockedDelete).toHaveBeenCalledWith('/auth/me', {
        data: { deleteRecipes: true },
      });
    });
  });
});
