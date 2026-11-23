import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RecipeFormPage } from '@/pages/RecipeFormPage';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <RecipeFormPage mode="create" />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('RecipeFormPage', () => {
  it('associates every visible label with its control', () => {
    renderPage();
    // getByLabelText only finds a control when the <label> is linked to it
    // (htmlFor/id) or the control carries the matching aria-label. Before
    // the a11y fix these threw because Title/Cuisine/etc. had no name/id.
    expect(screen.getByLabelText('Title')).toBeInTheDocument();
    expect(screen.getByLabelText('Cuisine')).toBeInTheDocument();
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
    expect(screen.getByLabelText('Tags (comma-separated)')).toBeInTheDocument();
    expect(screen.getByLabelText('Difficulty')).toBeInTheDocument();
    expect(screen.getByLabelText('Prep time (min)')).toBeInTheDocument();
    expect(screen.getByLabelText('Cook time (min)')).toBeInTheDocument();
    expect(screen.getByLabelText('Servings')).toBeInTheDocument();
    expect(screen.getByLabelText('Image URL')).toBeInTheDocument();
    expect(screen.getByLabelText('Calories')).toBeInTheDocument();
    expect(screen.getByLabelText('Protein (g)')).toBeInTheDocument();
    expect(screen.getByLabelText('Carbs (g)')).toBeInTheDocument();
    expect(screen.getByLabelText('Fat (g)')).toBeInTheDocument();
  });

  it('requires an image URL — recipes without images are not accepted', () => {
    renderPage();
    expect(screen.getByLabelText('Image URL')).toBeRequired();
  });
});
