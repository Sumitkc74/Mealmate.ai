/**
 * Thin wrapper around useAiCapabilities that exposes two simple booleans
 * consumed throughout the UI to show/hide AI-dependent features and their
 * manual fallbacks.
 *
 *  - serviceOnline: the AI service process is reachable at all
 *  - llmOnline:     the service is up AND an LLM key is configured
 */
import { useAiCapabilities } from './useAiPlanner';

export interface AiStatus {
  /** True while the capabilities query is still loading. */
  loading: boolean;
  /** AI service process is reachable. */
  serviceOnline: boolean;
  /** AI service is up AND an LLM (Gemini / OpenAI) key is configured. */
  llmOnline: boolean;
  /** Individual feature flags — safe to read even when offline (all false). */
  features: {
    recommend: boolean;
    similar: boolean;
    planWeek: boolean;
    chat: boolean;
    pantryParse: boolean;
    pantryVision: boolean;
  };
}

export function useAiStatus(): AiStatus {
  const { data, isLoading, isError } = useAiCapabilities();

  if (isLoading) {
    return {
      loading: true,
      serviceOnline: false,
      llmOnline: false,
      features: {
        recommend: false,
        similar: false,
        planWeek: false,
        chat: false,
        pantryParse: false,
        pantryVision: false,
      },
    };
  }

  // Query errored (service unreachable) or explicitly returned success:false
  if (isError || !data?.success) {
    return {
      loading: false,
      serviceOnline: false,
      llmOnline: false,
      features: {
        recommend: false,
        similar: false,
        planWeek: false,
        chat: false,
        pantryParse: false,
        pantryVision: false,
      },
    };
  }

  const f = data.features;
  return {
    loading: false,
    serviceOnline: true,
    llmOnline: data.llm.available,
    features: {
      recommend: f.recommend,
      similar: f.similar,
      planWeek: f.plan_week,
      chat: f.chat,
      pantryParse: f.pantry_parse,
      pantryVision: f.pantry_vision ?? false,
    },
  };
}

