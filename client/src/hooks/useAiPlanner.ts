import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';

// ---------------------------------------------------------------------------
// Shared union types matching the AI service
// ---------------------------------------------------------------------------

export type RecommendStrategy = 'tfidf' | 'lsa' | 'collab' | 'hybrid';
export type PlannerObjective = 'balanced' | 'eco' | 'budget' | 'pantry';

export interface SignalContribution {
  name: string;
  score: number;
  weight: number;
}

export interface SimilarRecipe {
  recipe_id: string;
  title: string;
  score: number;
  matched_ingredients: string[];
  reason: string;
  signals?: SignalContribution[];
  /** Mongo _id when the recipe has been seeded into the local DB. */
  _id?: string;
}

export interface SimilarResponse {
  success: boolean;
  recipe_id: string;
  count: number;
  strategy: RecommendStrategy;
  results: SimilarRecipe[];
}

/**
 * Fetch similar recipes by slug from the AI service. Returns an empty array
 * gracefully when the recipe is not in the AI dataset (404).
 */
export function useSimilarRecipes(
  slug: string | undefined,
  topK = 5,
  strategy: RecommendStrategy = 'tfidf'
) {
  return useQuery({
    queryKey: ['similar', slug, topK, strategy],
    enabled: Boolean(slug),
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<SimilarResponse> => {
      try {
        const { data } = await api.post<SimilarResponse>(
          `/ai/recipes/${encodeURIComponent(slug ?? '')}/similar`,
          { top_k: topK, strategy }
        );
        return data;
      } catch (err) {
        // 404 (recipe not in AI dataset) is expected for user-created recipes.
        const status = (err as { response?: { status?: number } }).response?.status;
        if (status === 404) {
          return { success: true, recipe_id: slug ?? '', count: 0, strategy, results: [] };
        }
        throw err;
      }
    },
  });
}

export interface MealPlanSlot {
  slot: string;
  recipe_id: string;
  title: string;
  tags: string[];
  co2_kg?: number;
  cost_usd?: number;
  eco_score?: number;
  _id?: string;
}

export interface MealPlanDay {
  day: string;
  meals: MealPlanSlot[];
  co2_kg?: number;
  cost_usd?: number;
}

export interface SustainabilitySummary {
  co2_kg: number;
  cost_usd: number;
  eco_score: number;
  meals: number;
}

export interface MealPlanResponse {
  success: boolean;
  strategy: 'heuristic' | 'llm';
  objective?: PlannerObjective;
  weights?: Record<string, number>;
  days: MealPlanDay[];
  sustainability?: SustainabilitySummary;
}

/** Generate a 7-day meal plan based on the user's pantry / preferences. */
export function useGenerateWeekPlan() {
  return useMutation({
    mutationFn: async (vars: {
      useLlm?: boolean;
      objective?: PlannerObjective;
      weights?: Record<string, number>;
    }): Promise<MealPlanResponse> => {
      const { data } = await api.post<MealPlanResponse>('/ai/plan/week', {
        use_llm: vars.useLlm ?? false,
        objective: vars.objective ?? 'balanced',
        weights: vars.weights,
        useProfile: true,
      });
      return data;
    },
  });
}

// ---------------------------------------------------------------------------
// Cooking-assistant chat
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatSuggestion {
  label: string;
  prompt: string;
}

/** Ingredient row inside an `AppliedAction.recipe`. */
export interface AppliedActionIngredient {
  name: string;
  quantity?: number;
  unit?: string;
}

/** Result of the server applying an `add_to_plan` action to MongoDB. */
export interface AppliedAction {
  type: 'add_to_plan';
  status: 'applied' | 'recipe_not_found' | 'invalid' | 'error';
  requested: {
    recipe_query: string;
    day: string;
    slot: string;
    week_offset: number;
  };
  recipe?: {
    id: string;
    slug: string;
    title: string;
    calories: number | null;
    ingredients: AppliedActionIngredient[];
    imageUrl?: string;
    /** True when this recipe was newly drafted by the AI for this request. */
    generated?: boolean;
  };
  mealPlanId?: string;
  weekStartDate?: string;
  message?: string;
}

export interface ChatResponse {
  success: boolean;
  reply: string;
  strategy: 'llm' | 'fallback';
  suggestions: ChatSuggestion[];
  /** Server-applied side-effects (e.g. recipes added to the plan). */
  applied_actions?: AppliedAction[];
}

export function useAssistantChat() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      messages: ChatMessage[];
      recipe_context?: string;
    }): Promise<ChatResponse> => {
      const { data } = await api.post<ChatResponse>('/ai/chat', {
        messages: vars.messages,
        recipe_context: vars.recipe_context,
        useProfile: true,
      });
      return data;
    },
    onSuccess: (data) => {
      // If the assistant successfully applied any plan mutation, refresh
      // the affected queries so the Planner page reflects the change.
      if (data.applied_actions?.some((a) => a.status === 'applied')) {
        queryClient.invalidateQueries({ queryKey: ['mealplans'] });
        queryClient.invalidateQueries({ queryKey: ['mealplan'] });
        queryClient.invalidateQueries({ queryKey: ['grocery'] });
        // If the AI generated a new recipe, the recipes list also changed.
        if (data.applied_actions.some((a) => a.recipe?.generated)) {
          queryClient.invalidateQueries({ queryKey: ['recipes'] });
        }
      }
    },
  });
}

export async function streamAssistantChat(
  vars: {
    messages: ChatMessage[];
    recipe_context?: string;
  },
  callbacks: {
    onToken: (chunk: string) => void;
    onDone: (data: ChatResponse) => void;
    onError: (err: unknown) => void;
  }
): Promise<void> {
  const token = useAuthStore.getState().token;
  const baseUrl = import.meta.env.VITE_API_URL ?? '/api';
  const response = await fetch(`${baseUrl}/ai/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      messages: vars.messages,
      recipe_context: vars.recipe_context,
      useProfile: true,
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Stream request failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const payload = JSON.parse(line.slice(6));
          if (payload.type === 'token' && typeof payload.chunk === 'string') {
            callbacks.onToken(payload.chunk);
          } else if (payload.type === 'done') {
            callbacks.onDone(payload as ChatResponse);
          }
        } catch {
          // ignore malformed chunk
        }
      }
    }
  } catch (err) {
    callbacks.onError(err);
  }
}

// ---------------------------------------------------------------------------
// Smart pantry parser
// ---------------------------------------------------------------------------

export interface ParsedPantryItem {
  ingredient: string;
  quantity?: string | null;
  unit?: string | null;
}

export interface PantryParseResponse {
  success: boolean;
  strategy: 'llm' | 'heuristic';
  items: ParsedPantryItem[];
}

export function useParsePantry() {
  return useMutation({
    mutationFn: async (text: string): Promise<PantryParseResponse> => {
      const { data } = await api.post<PantryParseResponse>('/ai/pantry/parse', { text });
      return data;
    },
  });
}

// ---------------------------------------------------------------------------
// AI capabilities (probes the live service to know if Gemini is wired up)
// ---------------------------------------------------------------------------

export interface AiCapabilities {
  success: boolean;
  llm: { provider: string | null; model: string | null; available: boolean };
  features: {
    recommend: boolean;
    similar: boolean;
    plan_week: boolean;
    chat: boolean;
    pantry_parse: boolean;
    pantry_vision?: boolean;
    footprint?: boolean;
    interactions?: boolean;
    metrics?: boolean;
    strategies?: RecommendStrategy[];
    planner_objectives?: PlannerObjective[];
  };
}

export function useAiCapabilities() {
  return useQuery({
    queryKey: ['ai', 'capabilities'],
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<AiCapabilities> => {
      const { data } = await api.get<AiCapabilities>('/ai/capabilities');
      return data;
    },
  });
}

// ---------------------------------------------------------------------------
// Pantry vision (Gemini multimodal fridge photo → ingredient list)
// ---------------------------------------------------------------------------

export interface PantryVisionResponse {
  success: boolean;
  available: boolean;
  strategy: 'llm' | 'fallback';
  items: ParsedPantryItem[];
  message?: string;
}

export function useParsePantryImage() {
  return useMutation({
    mutationFn: async (vars: {
      imageBase64: string;
      hint?: string;
    }): Promise<PantryVisionResponse> => {
      const { data } = await api.post<PantryVisionResponse>('/ai/pantry/vision', {
        image_base64: vars.imageBase64,
        hint: vars.hint,
      });
      return data;
    },
  });
}

// ---------------------------------------------------------------------------
// Sustainability footprint for a single recipe
// ---------------------------------------------------------------------------

export interface IngredientFootprint {
  name: string;
  category: string;
  co2_kg: number;
  cost_usd: number;
}

export interface RecipeFootprintResponse {
  success: boolean;
  recipe_id: string;
  title: string;
  co2_kg: number;
  cost_usd: number;
  eco_score: number;
  categories: string[];
  breakdown: IngredientFootprint[];
}

export function useRecipeFootprint(slug: string | undefined) {
  return useQuery({
    queryKey: ['ai', 'footprint', slug],
    enabled: Boolean(slug),
    retry: false,
    staleTime: 60 * 60_000,
    queryFn: async (): Promise<RecipeFootprintResponse | null> => {
      try {
        const { data } = await api.get<RecipeFootprintResponse>(
          `/ai/recipes/${encodeURIComponent(slug ?? '')}/footprint`
        );
        return data;
      } catch (err) {
        const status = (err as { response?: { status?: number } }).response?.status;
        if (status === 404) return null;
        throw err;
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Collaborative-filtering interaction signal
// ---------------------------------------------------------------------------

export interface InteractionRecordResponse {
  success: boolean;
  pairs: number;
}

export function useRecordInteractions() {
  return useMutation({
    mutationFn: async (recipeIds: string[]): Promise<InteractionRecordResponse> => {
      const { data } = await api.post<InteractionRecordResponse>(
        '/ai/interactions/record',
        { recipe_ids: recipeIds }
      );
      return data;
    },
  });
}
