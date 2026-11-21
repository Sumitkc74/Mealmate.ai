import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecipeVerificationModal } from '@/components/recipes/RecipeVerificationModal';
import type { VerifyRecipeResponse } from '@/hooks/useRecipes';

describe('RecipeVerificationModal', () => {
  it('does not render when isOpen is false', () => {
    const { container } = render(
      <RecipeVerificationModal
        isOpen={false}
        onClose={vi.fn()}
        onConfirmPublish={vi.fn()}
        isLoading={false}
        verification={null}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders loading state when isLoading is true', () => {
    render(
      <RecipeVerificationModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirmPublish={vi.fn()}
        isLoading={true}
        verification={null}
        recipeTitle="Garlic Herb Pasta"
      />
    );

    expect(screen.getByText(/Analyzing recipe with AI/i)).toBeInTheDocument();
    expect(screen.getByText('Garlic Herb Pasta')).toBeInTheDocument();
  });

  it('renders verified verdict and allows publishing', async () => {
    const user = userEvent.setup();
    const onConfirmPublish = vi.fn();
    const onClose = vi.fn();

    const mockVerification: VerifyRecipeResponse = {
      success: true,
      is_valid: true,
      score: 95,
      verdict: 'verified',
      summary: 'Excellent balanced recipe with clear culinary steps.',
      issues: [],
      detected_allergens: ['dairy', 'gluten'],
      suggestions: ['Add a pinch of fresh basil before serving.'],
    };

    render(
      <RecipeVerificationModal
        isOpen={true}
        onClose={onClose}
        onConfirmPublish={onConfirmPublish}
        isLoading={false}
        verification={mockVerification}
        recipeTitle="Garlic Herb Pasta"
      />
    );

    expect(screen.getByText(/Recipe Verified & Safe/i)).toBeInTheDocument();
    expect(screen.getByText(/Score: 95\/100/i)).toBeInTheDocument();
    expect(screen.getByText('dairy')).toBeInTheDocument();
    expect(screen.getByText('gluten')).toBeInTheDocument();
    expect(screen.getByText(/Add a pinch of fresh basil/i)).toBeInTheDocument();

    const publishBtn = screen.getByRole('button', { name: /Confirm & Publish/i });
    await user.click(publishBtn);
    expect(onConfirmPublish).toHaveBeenCalledTimes(1);
  });

  it('renders rejected status and disables publishing when unsafe', () => {
    const mockRejected: VerifyRecipeResponse = {
      success: true,
      is_valid: false,
      score: 30,
      verdict: 'rejected',
      summary: 'Contains non-food or dangerous ingredients.',
      issues: [
        {
          severity: 'error',
          category: 'safety',
          message: 'Raw wild mushrooms of unknown variety may be toxic.',
        },
      ],
      detected_allergens: [],
      suggestions: [],
    };

    render(
      <RecipeVerificationModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirmPublish={vi.fn()}
        isLoading={false}
        verification={mockRejected}
      />
    );

    expect(screen.getByText(/Potential Issues Detected/i)).toBeInTheDocument();
    expect(screen.getByText(/Raw wild mushrooms of unknown variety/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Confirm & Publish/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Close & Edit/i })).toBeInTheDocument();
  });

  it('renders needs_review with Publish Anyway and the needs-review tag notice', async () => {
    const user = userEvent.setup();
    const onConfirmPublish = vi.fn();

    const mockReview: VerifyRecipeResponse = {
      success: true,
      is_valid: true,
      score: 60,
      verdict: 'needs_review',
      summary: 'Recipe looks plausible but has areas that could be improved before sharing.',
      issues: [
        {
          severity: 'warning',
          category: 'coherence',
          message: 'Title names chicken but no chicken appears in the ingredients.',
        },
      ],
      detected_allergens: [],
      suggestions: [],
    };

    render(
      <RecipeVerificationModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirmPublish={onConfirmPublish}
        isLoading={false}
        verification={mockReview}
      />
    );

    expect(screen.getByText(/Review Recommendations/i)).toBeInTheDocument();
    expect(screen.getByText(/Title names chicken/i)).toBeInTheDocument();
    expect(screen.getByText(/needs-review/i)).toBeInTheDocument();
    expect(
      screen.getByText(/so other users know it didn.t fully pass verification/i)
    ).toBeInTheDocument();

    const publishBtn = screen.getByRole('button', { name: /Publish Anyway/i });
    await user.click(publishBtn);
    expect(onConfirmPublish).toHaveBeenCalledTimes(1);
  });
});

