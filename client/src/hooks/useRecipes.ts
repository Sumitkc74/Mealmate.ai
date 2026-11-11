import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Recipe, Difficulty } from '@/types';

export interface ListRecipesParams {
  q?: string;
  cuisine?: string;
  tag?: string;
  maxPrepTime?: number;
  difficulty?: Difficulty;
  sort?: 'recent' | 'fastest' | 'relevance';
  page?: number;
  limit?: number;
}

export interface ListRecipesResponse {
  success: true;
  page: number;
  limit: number;
  total: number;
  pages: number;
  items: Recipe[];
}

// The server returns lean documents with `_id`; normalize to `id` for the UI.
function normalize<T extends { _id?: string; id?: string }>(doc: T): T & { id: string } {
  const id = doc.id ?? doc._id ?? '';
  return { ...doc, id };
}

export function useRecipes(params: ListRecipesParams) {
  return useQuery({
    queryKey: ['recipes', params],
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<ListRecipesResponse> => {
      const cleaned: Record<string, string | number> = {};
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== '' && v !== null) cleaned[k] = v as string | number;
      }
      const { data } = await api.get<ListRecipesResponse>('/recipes', { params: cleaned });
      return { ...data, items: data.items.map(normalize) };
    },
  });
}

export function useRecipe(id: string | undefined) {
  return useQuery({
    queryKey: ['recipe', id],
    enabled: Boolean(id),
    queryFn: async (): Promise<Recipe> => {
      const { data } = await api.get<{ recipe: Recipe }>(`/recipes/${id}`);
      return normalize(data.recipe);
    },
  });
}

export interface RecipeInput {
  title: string;
  description?: string;
  ingredients: { name: string; quantity?: number; unit?: string; notes?: string }[];
  instructions: string[];
  prepTime: number;
  cookTime: number;
  servings: number;
  cuisine?: string;
  tags?: string[];
  difficulty?: Difficulty;
  nutrition?: Recipe['nutrition'];
  imageUrl?: string;
}

export function useCreateRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: RecipeInput): Promise<Recipe> => {
      const { data } = await api.post<{ recipe: Recipe }>('/recipes', input);
      return normalize(data.recipe);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recipes'] });
    },
  });
}

export interface BulkCreateRecipesResult {
  success: true;
  count: number;
  recipes: Recipe[];
}

export function useBulkCreateRecipes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (recipes: RecipeInput[]): Promise<BulkCreateRecipesResult> => {
      const { data } = await api.post<BulkCreateRecipesResult>('/recipes/bulk', { recipes });
      return {
        ...data,
        recipes: data.recipes.map(normalize),
      };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recipes'] });
    },
  });
}

export function useUpdateRecipe(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<RecipeInput>): Promise<Recipe> => {
      const { data } = await api.patch<{ recipe: Recipe }>(`/recipes/${id}`, input);
      return normalize(data.recipe);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recipes'] });
      qc.invalidateQueries({ queryKey: ['recipe', id] });
    },
  });
}

export function useDeleteRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/recipes/${id}`);
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recipes'] });
    },
  });
}

export interface GenerateRecipeInput {
  query: string;
  dietaryPreferences?: string[];
  allergies?: string[];
  save?: boolean;
}

export interface GenerateRecipeResult {
  recipe: Recipe;
  /** The query the AI service actually used (may differ from the input if
   * a compound request was simplified on retry). */
  usedQuery: string;
  generated: true;
}

/**
 * AI-driven recipe generation. Called from the planner's recipe picker
 * ("Generate with AI" button) and any future "Create with AI" flow.
 *
 * On success the new recipe is persisted server-side and added to the
 * cache; the returned object includes its real MongoDB id so the caller
 * can immediately assign it to a meal slot.
 */
export function useGenerateRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: GenerateRecipeInput): Promise<GenerateRecipeResult> => {
      const { data } = await api.post<{
        success: true;
        recipe: Recipe;
        usedQuery: string;
        generated: true;
      }>('/recipes/generate', input, { timeout: 60_000 });
      return {
        recipe: normalize(data.recipe),
        usedQuery: data.usedQuery,
        generated: true,
      };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recipes'] });
    },
  });
}

export interface RecipeVerificationIssue {
  severity: 'error' | 'warning' | 'info';
  category: 'safety' | 'edibility' | 'coherence' | 'instructions' | 'completeness' | 'allergen';
  message: string;
  field?: string;
}

export interface VerifyRecipeInput {
  title: string;
  description?: string;
  cuisine?: string;
  ingredients: Array<{ name: string; quantity?: number; unit?: string }>;
  instructions: string[];
  prepTime?: number;
  cookTime?: number;
  servings?: number;
}

export interface VerifyRecipeResponse {
  success: boolean;
  is_valid: boolean;
  score: number;
  verdict: 'verified' | 'needs_review' | 'rejected';
  summary: string;
  issues: RecipeVerificationIssue[];
  detected_allergens: string[];
  suggestions: string[];
}

export function useVerifyRecipe() {
  return useMutation({
    mutationFn: async (input: VerifyRecipeInput): Promise<VerifyRecipeResponse> => {
      const { data } = await api.post<VerifyRecipeResponse>('/recipes/verify', input);
      return data;
    },
  });
}

export interface EstimateNutritionInput {
  title?: string;
  ingredients: Array<{ name: string; quantity?: number; unit?: string }>;
  servings?: number;
}

export interface EstimateNutritionResponse {
  success: boolean;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
  sodium?: number;
  servings: number;
}

export function useEstimateNutrition() {
  return useMutation({
    mutationFn: async (input: EstimateNutritionInput): Promise<EstimateNutritionResponse> => {
      const { data } = await api.post<EstimateNutritionResponse>('/recipes/estimate-nutrition', input);
      return data;
    },
  });
}


