import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RecipeCard } from '@/components/recipes/RecipeCard';
import { resolveImageUrl } from '@/lib/api';
import type { Recipe } from '@/types';

const RENDER_API = 'https://mealmate-server-utnx.onrender.com/api';

function biryani(imageUrl?: string): Recipe {
  return {
    id: '6a29c8d0d2c5aa3d4148c341',
    slug: 'chicken-biryani',
    title: 'Chicken Biryani',
    ingredients: [{ name: 'chicken', quantity: 500, unit: 'g' }],
    instructions: ['Cook the rice.'],
    prepTime: 20,
    cookTime: 30,
    servings: 4,
    cuisine: 'indian',
    tags: [],
    difficulty: 'hard',
    imageUrl,
  };
}

describe('resolveImageUrl', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', RENDER_API);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('resolves a server-relative image path against the API origin', () => {
    expect(resolveImageUrl('/static/recipe-images/5eca4d3496935b96a97668e7.jpg')).toBe(
      'https://mealmate-server-utnx.onrender.com/static/recipe-images/5eca4d3496935b96a97668e7.jpg',
    );
  });

  it('leaves absolute image URLs unchanged', () => {
    const remote = 'https://images.unsplash.com/photo-1645112411341-6c4fd023714a';
    expect(resolveImageUrl(remote)).toBe(remote);
  });

  it('returns undefined for a missing image URL', () => {
    expect(resolveImageUrl(undefined)).toBeUndefined();
    expect(resolveImageUrl(null)).toBeUndefined();
    expect(resolveImageUrl('')).toBeUndefined();
  });
});

describe('RecipeCard images', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', RENDER_API);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders a server-hosted image from the API origin, not the site origin', () => {
    render(
      <MemoryRouter>
        <RecipeCard recipe={biryani('/static/recipe-images/5eca4d3496935b96a97668e7.jpg')} />
      </MemoryRouter>,
    );
    const img = screen.getByRole('img', { name: 'Chicken Biryani' });
    expect(img.getAttribute('src')).toBe(
      'https://mealmate-server-utnx.onrender.com/static/recipe-images/5eca4d3496935b96a97668e7.jpg',
    );
  });

  it('renders a remote image URL as-is', () => {
    render(
      <MemoryRouter>
        <RecipeCard recipe={biryani('https://images.unsplash.com/photo-1645112411341-6c4fd023714a')} />
      </MemoryRouter>,
    );
    const img = screen.getByRole('img', { name: 'Chicken Biryani' });
    expect(img.getAttribute('src')).toBe('https://images.unsplash.com/photo-1645112411341-6c4fd023714a');
  });

  it('shows the placeholder when the recipe has no image', () => {
    render(
      <MemoryRouter>
        <RecipeCard recipe={biryani(undefined)} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('img', { name: 'Chicken Biryani' })).not.toBeInTheDocument();
    expect(screen.getByText('Recipe preview')).toBeInTheDocument();
  });
});
