import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  RecommendStrategy,
  SignalContribution,
} from './useAiPlanner';

export interface RecommendedRecipe {
  _id?: string;
  recipe_id: string;
  title: string;
  score: number;
  matched_ingredients: string[];
  missing_ingredients?: string[];
  total_ingredients?: number;
  coverage?: number;
  inDatabase?: boolean;
  reason: string;
  signals?: SignalContribution[];
  imageUrl?: string;
  prepTime?: number;
  cookTime?: number;
  servings?: number;
  cuisine?: string;
  difficulty?: string;
}

export interface RecommendResponse {
  success: boolean;
  count: number;
  strategy: RecommendStrategy | 'database' | 'starter';
  results: RecommendedRecipe[];
}

export interface RecommendParams {
  ingredients?: string[];
  dietary_preferences?: string[];
  top_k?: number;
  usePantry?: boolean;
  strategy?: RecommendStrategy;
  liked_recipe_ids?: string[];
  scope?: 'database' | 'ai' | 'all';
}

/** Fetch recipe suggestions based on database pantry comparison or ML recommender. */
export function useRecommendations(params: RecommendParams = {}, enabled = true) {
  const body = {
    top_k: params.top_k ?? 5,
    usePantry: params.usePantry ?? true,
    strategy: params.strategy ?? 'hybrid',
    ...(params.scope ? { scope: params.scope } : {}),
    ...(params.ingredients ? { ingredients: params.ingredients } : {}),
    ...(params.dietary_preferences ? { dietary_preferences: params.dietary_preferences } : {}),
    ...(params.liked_recipe_ids ? { liked_recipe_ids: params.liked_recipe_ids } : {}),
  };

  return useQuery({
    queryKey: ['recommendations', body],
    enabled,
    retry: false,
    staleTime: 60_000,
    queryFn: async (): Promise<RecommendResponse> => {
      const { data } = await api.post<RecommendResponse>('/ai/recipes/recommend', body);
      return data;
    },
  });
}
