# ADR 0004: Pluggable Multi-Cloud LLM Provider Architecture

## Status
Accepted

## Context
Deploying enterprise AI applications across multiple environments requires avoiding vendor lock-in to a single LLM vendor. Some enterprise customers require Azure OpenAI for data sovereignty (EU Data Boundary / FedRAMP), while others utilize Google Gemini or self-hosted OpenAI-compatible inference servers (vLLM, Ollama).

## Decision
We implemented a pluggable provider abstraction in `app/llm_provider.py`:
- `LLMProvider` abstract base class defining `generate_text`, `generate_chat`, `embed_text`, and `embed_texts`.
- `GeminiProvider`: Native Google Generative AI integration with Prometheus metrics and LRU-TTL caching.
- `AzureOpenAIProvider`: Direct Azure OpenAI REST integration with API key/managed identity support and deployment selection.
- `OpenAIProvider`: Standard OpenAI API specification compatible with open-source local servers.
- `MockLLMProvider`: Deterministic offline execution for automated CI test suites.
- Provider selection driven by the `LLM_PROVIDER` environment variable.

## Consequences
### Positive
- Zero code changes required to switch between Azure OpenAI, Gemini, or local models.
- Shared Prometheus metrics (`mealmate_llm_calls_total`) and TTL-LRU caching across all providers.
- Instant, cost-free automated testing using `MockLLMProvider`.

