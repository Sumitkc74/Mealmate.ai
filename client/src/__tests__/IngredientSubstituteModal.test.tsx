import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { IngredientSubstituteModal } from '@/components/recipes/IngredientSubstituteModal';
import { api } from '@/lib/api';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

const mockedGet = api.get as unknown as ReturnType<typeof vi.fn>;

function axiosFailure(status?: number) {
  const err = new Error(
    status ? `Request failed with status code ${status}` : 'timeout of 30000ms exceeded'
  ) as Error & { isAxiosError: boolean; code?: string; response?: { status: number } };
  err.isAxiosError = true;
  if (status) err.response = { status };
  return err;
}

describe('IngredientSubstituteModal', () => {
  beforeEach(() => {
    mockedGet.mockReset();
  });

  function renderOpen() {
    return render(
      <IngredientSubstituteModal isOpen onClose={vi.fn()} initialIngredient="egg" />
    );
  }

  it('shows substitutions when the service answers', async () => {
    mockedGet.mockResolvedValue({
      data: {
        success: true,
        ingredient: 'egg',
        substitutions: [
          {
            target: 'egg',
            substitute: 'flax egg',
            ratio: '1:1',
            context: 'vegan',
            notes: 'Mix and rest.',
          },
        ],
      },
    });

    renderOpen();

    expect(await screen.findByText('flax egg')).toBeInTheDocument();
  });

  it('says the service is waking up when the request fails without a response', async () => {
    mockedGet.mockRejectedValue(axiosFailure());

    renderOpen();

    expect(await screen.findByText(/waking up or unavailable/i)).toBeInTheDocument();
  });

  it('says the service is waking up on a 503 from the server', async () => {
    mockedGet.mockRejectedValue(axiosFailure(503));

    renderOpen();

    expect(await screen.findByText(/waking up or unavailable/i)).toBeInTheDocument();
  });

  it('keeps the no-substitutions message for a rejected lookup', async () => {
    mockedGet.mockRejectedValue(axiosFailure(400));

    renderOpen();

    expect(await screen.findByText(/No verified substitutions found/i)).toBeInTheDocument();
  });

  it('reports an empty knowledge-graph result without an error', async () => {
    mockedGet.mockResolvedValue({
      data: { success: true, ingredient: 'egg', substitutions: [] },
    });

    renderOpen();

    expect(await screen.findByText(/No specific swaps in Knowledge Graph/i)).toBeInTheDocument();
  });
});
