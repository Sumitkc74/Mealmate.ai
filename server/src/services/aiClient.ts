/** Thin axios client for the Python AI microservice. */
import axios, { type AxiosInstance } from 'axios';
import { env } from '../config/env';
import { logger } from '../config/logger';

let client: AxiosInstance | undefined;

function getClient(): AxiosInstance {
  if (!client) {
    client = axios.create({
      baseURL: env.AI_SERVICE_URL,
      timeout: 8000,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return client;
}

export interface SignalContribution {
  name: 'tfidf' | 'lsa' | 'collab';
  score: number;
  weight: number;
}

export type RecommendStrategy = 'tfidf' | 'lsa' | 'collab' | 'hybrid';
export type PlannerObjective = 'balanced' | 'eco' | 'budget' | 'pantry';

export interface RecommendedRecipe {
  recipe_id: string;
  title: string;
  score: number;
  matched_ingredients: string[];
  reason: string;
  signals?: SignalContribution[];
}

export interface RecommendResponse {
  success: boolean;
  strategy: RecommendStrategy;
  count: number;
  results: RecommendedRecipe[];
}

export async function getRecommendations(payload: {
  ingredients: string[];
  dietary_preferences?: string[];
  allergies?: string[];
  top_k?: number;
  strategy?: RecommendStrategy;
  liked_recipe_ids?: string[];
}): Promise<RecommendResponse> {
  try {
    const { data } = await getClient().post<RecommendResponse>('/recommend', payload);
    return data;
  } catch (err) {
    logger.error({ err }, 'AI service recommend call failed');
    throw err;
  }
}

export interface SimilarResponse {
  success: boolean;
  recipe_id: string;
  strategy: RecommendStrategy;
  count: number;
  results: RecommendedRecipe[];
}

export async function getSimilarRecipes(
  recipeId: string,
  topK = 5,
  strategy: RecommendStrategy = 'tfidf'
): Promise<SimilarResponse> {
  try {
    const { data } = await getClient().post<SimilarResponse>(
      `/similar/${encodeURIComponent(recipeId)}`,
      { top_k: topK, strategy }
    );
    return data;
  } catch (err) {
    logger.error({ err, recipeId }, 'AI service similar call failed');
    throw err;
  }
}

export interface MealPlanSlot {
  slot: string;
  recipe_id: string;
  title: string;
  tags: string[];
  co2_kg?: number;
  cost_usd?: number;
  eco_score?: number;
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

export async function generateWeekPlan(payload: {
  ingredients: string[];
  dietary_preferences: string[];
  allergies: string[];
  use_llm?: boolean;
  objective?: PlannerObjective;
  weights?: Record<string, number>;
}): Promise<MealPlanResponse> {
  try {
    const { data } = await getClient().post<MealPlanResponse>('/plan/week', payload, {
      // The LLM path can be slow; allow more time when it's enabled.
      timeout: payload.use_llm ? 30_000 : 10_000,
    });
    return data;
  } catch (err) {
    logger.error({ err }, 'AI service plan/week call failed');
    throw err;
  }
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

/** Structured side-effect the AI assistant wants to apply. */
export interface ChatAction {
  type: 'add_to_plan';
  recipe_query: string;
  day: string;
  slot: string;
  week_offset?: number;
}

export interface ChatResponse {
  success: boolean;
  reply: string;
  strategy: 'llm' | 'fallback';
  suggestions: ChatSuggestion[];
  /** Raw actions requested by the model (the server applies these). */
  actions?: ChatAction[];
}

export async function getAssistantReply(payload: {
  messages: ChatMessage[];
  pantry: string[];
  dietary_preferences: string[];
  allergies: string[];
  recipe_context?: string;
}): Promise<ChatResponse> {
  try {
    const { data } = await getClient().post<ChatResponse>('/chat', payload, {
      timeout: 30_000,
    });
    return data;
  } catch (err) {
    logger.error({ err }, 'AI service chat call failed');
    throw err;
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

export async function parsePantryText(text: string): Promise<PantryParseResponse> {
  try {
    const { data } = await getClient().post<PantryParseResponse>(
      '/pantry/parse',
      { text },
      { timeout: 20_000 }
    );
    return data;
  } catch (err) {
    logger.error({ err }, 'AI service pantry/parse call failed');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// LLM recipe generator (used as fallback when the user asks the assistant to
// add a dish that doesn't yet exist in the Recipe collection).
// ---------------------------------------------------------------------------

export interface GeneratedRecipeIngredient {
  name: string;
  quantity?: number | null;
  unit?: string | null;
}

export interface GeneratedRecipeNutrition {
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  fiber?: number | null;
  sugar?: number | null;
  sodium?: number | null;
}

export interface GeneratedRecipe {
  title: string;
  description: string;
  cuisine?: string | null;
  tags: string[];
  ingredients: GeneratedRecipeIngredient[];
  instructions: string[];
  prep_time: number;
  cook_time: number;
  servings: number;
  nutrition: GeneratedRecipeNutrition;
  difficulty: 'easy' | 'medium' | 'hard';
  image_url?: string | null;
  source: string;
}

export interface GenerateRecipeResponse {
  success: boolean;
  strategy: 'llm' | 'unavailable';
  recipe?: GeneratedRecipe | null;
  message?: string | null;
}

export async function generateRecipe(payload: {
  query: string;
  dietary_preferences?: string[];
  allergies?: string[];
}): Promise<GenerateRecipeResponse> {
  try {
    const { data } = await getClient().post<GenerateRecipeResponse>(
      '/recipes/generate',
      {
        query: payload.query,
        dietary_preferences: payload.dietary_preferences ?? [],
        allergies: payload.allergies ?? [],
      },
      { timeout: 45_000 } // LLM + Wikipedia image lookup may take a few seconds
    );
    return data;
  } catch (err) {
    logger.error({ err, query: payload.query }, 'AI service recipes/generate call failed');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Capabilities (used to advertise LLM availability to the client)
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

export async function getCapabilities(): Promise<AiCapabilities> {
  try {
    const { data } = await getClient().get<AiCapabilities>('/capabilities', {
      timeout: 4000,
    });
    return data;
  } catch (err) {
    logger.warn({ err }, 'AI capabilities probe failed');
    return {
      success: false,
      llm: { provider: null, model: null, available: false },
      features: {
        recommend: false,
        similar: false,
        plan_week: false,
        chat: false,
        pantry_parse: false,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Vision-based pantry capture
// ---------------------------------------------------------------------------

export interface PantryVisionResponse {
  success: boolean;
  available: boolean;
  items: ParsedPantryItem[];
  message?: string | null;
}

export async function parsePantryImage(payload: {
  image_base64: string;
  hint?: string;
}): Promise<PantryVisionResponse> {
  try {
    const { data } = await getClient().post<PantryVisionResponse>(
      '/pantry/vision',
      payload,
      { timeout: 30_000, maxContentLength: 25 * 1024 * 1024 }
    );
    return data;
  } catch (err) {
    logger.error({ err }, 'AI service pantry/vision call failed');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Sustainability footprint
// ---------------------------------------------------------------------------

export interface IngredientFootprintOut {
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
  breakdown: IngredientFootprintOut[];
}

export async function getRecipeFootprint(recipeId: string): Promise<RecipeFootprintResponse> {
  try {
    const { data } = await getClient().get<RecipeFootprintResponse>(
      `/recipes/${encodeURIComponent(recipeId)}/footprint`,
      { timeout: 4000 }
    );
    return data;
  } catch (err) {
    logger.error({ err, recipeId }, 'AI service footprint call failed');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Interaction recording (powers the collaborative model)
// ---------------------------------------------------------------------------

export interface InteractionRecordResponse {
  success: boolean;
  pairs: number;
}

export async function recordInteractions(recipeIds: string[]): Promise<InteractionRecordResponse> {
  try {
    const { data } = await getClient().post<InteractionRecordResponse>(
      '/interactions/record',
      { recipe_ids: recipeIds },
      { timeout: 4000 }
    );
    return data;
  } catch (err) {
    logger.error({ err }, 'AI service interactions/record call failed');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// RAG recipe suggester
// ---------------------------------------------------------------------------

export interface RAGRecipe {
  id: string;
  title: string;
  cuisine: string;
  ingredients: string[];
  tags: string[];
  similarity_score: number;
}

export interface RAGSuggestResponse {
  success: boolean;
  suggestion: string;
  recipes: RAGRecipe[];
  method: string;
  rag_available: boolean;
}

export async function ragSuggest(payload: {
  pantry: string[];
  dietary_preferences?: string[];
  allergies?: string[];
  top_k?: number;
}): Promise<RAGSuggestResponse> {
  try {
    const { data } = await getClient().post<RAGSuggestResponse>(
      '/rag/suggest',
      payload,
      { timeout: 30_000 }
    );
    return data;
  } catch (err) {
    logger.error({ err }, 'AI service rag/suggest call failed');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// RAG recipe Q&A
// ---------------------------------------------------------------------------

export interface RAGQueryResponse {
  success: boolean;
  answer: string;
  recipes: RAGRecipe[];
  method: string;
  rag_available: boolean;
}

export async function ragQuery(payload: {
  question: string;
  top_k?: number;
}): Promise<RAGQueryResponse> {
  try {
    const { data } = await getClient().post<RAGQueryResponse>(
      '/rag/query',
      payload,
      { timeout: 30_000 }
    );
    return data;
  } catch (err) {
    logger.error({ err }, 'AI service rag/query call failed');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// RAG index sync — push MongoDB recipes into ChromaDB
// ---------------------------------------------------------------------------

export interface RAGIndexResponse {
  success: boolean;
  indexed: number;
}

export async function ragIndex(recipes: {
  id: string;
  title: string;
  cuisine?: string;
  ingredients: string[];
  tags: string[];
}[]): Promise<RAGIndexResponse> {
  try {
    const { data } = await getClient().post<RAGIndexResponse>(
      '/rag/index',
      { recipes },
      { timeout: 60_000 }
    );
    return data;
  } catch (err) {
    logger.error({ err }, 'AI service rag/index call failed');
    throw err;
  }
}
