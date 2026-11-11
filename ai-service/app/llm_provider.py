"""Unified, pluggable LLM and embedding provider interface.

Supports:
1. Google Gemini (default, via :py:mod:`app.gemini`)
2. Azure OpenAI Service (REST / standard Azure endpoints)
3. OpenAI (direct / compatible endpoints like vLLM, Ollama, Groq)
4. Mock Provider (for deterministic offline unit tests and evaluation)

Configured via ``LLM_PROVIDER`` environment variable (values: ``gemini``,
``azure_openai``, ``openai``, ``mock``).
"""

from __future__ import annotations

import abc
import json
import logging
import os
import re
from typing import Any

import httpx

from . import gemini
from .cache import get_cache, make_key
from .metrics import record_llm_call

_logger = logging.getLogger(__name__)


class LLMProvider(abc.ABC):
    """Abstract contract for LLM and Embedding services."""

    @property
    @abc.abstractmethod
    def name(self) -> str:
        """Provider identifier (e.g. 'gemini', 'azure_openai', 'openai', 'mock')."""
        ...

    @abc.abstractmethod
    def is_available(self) -> bool:
        """Return True if credentials and configuration are set."""
        ...

    @abc.abstractmethod
    def generate_text(
        self,
        user: str,
        system: str = "You are a helpful assistant.",
        temperature: float = 0.4,
        json_mode: bool = False,
    ) -> str | None:
        """Single-shot completion."""
        ...

    @abc.abstractmethod
    def generate_chat(
        self,
        *,
        system: str,
        history: list[dict[str, str]],
        user_message: str,
        temperature: float = 0.6,
        json_mode: bool = False,
    ) -> str | None:
        """Multi-turn chat completion."""
        ...

    @abc.abstractmethod
    def embed_text(self, text: str) -> list[float] | None:
        """Return a dense embedding vector for given text."""
        ...

    def embed_texts(self, texts: list[str]) -> list[list[float] | None]:
        """Batch embedding with fallback to iterative single calls."""
        return [self.embed_text(t) for t in texts]


class GeminiProvider(LLMProvider):
    """Google Gemini provider delegating to :py:mod:`app.gemini`."""

    @property
    def name(self) -> str:
        return "gemini"

    def is_available(self) -> bool:
        return gemini.is_available()

    def generate_text(
        self,
        user: str,
        system: str = "You are a helpful assistant.",
        temperature: float = 0.4,
        json_mode: bool = False,
    ) -> str | None:
        return gemini.generate_text(
            user=user, system=system, temperature=temperature, json_mode=json_mode
        )

    def generate_chat(
        self,
        *,
        system: str,
        history: list[dict[str, str]],
        user_message: str,
        temperature: float = 0.6,
        json_mode: bool = False,
    ) -> str | None:
        return gemini.generate_chat(
            system=system,
            history=history,
            user_message=user_message,
            temperature=temperature,
            json_mode=json_mode,
        )

    def embed_text(self, text: str) -> list[float] | None:
        return gemini.embed_text(text)

    def embed_texts(self, texts: list[str]) -> list[list[float] | None]:
        if hasattr(gemini, "embed_texts"):
            return gemini.embed_texts(texts)  # type: ignore[no-any-return]
        return super().embed_texts(texts)


class AzureOpenAIProvider(LLMProvider):
    """Azure OpenAI Service provider using Azure REST API.

    Requires:
    - ``AZURE_OPENAI_ENDPOINT``: e.g. https://my-resource.openai.azure.com/
    - ``AZURE_OPENAI_API_KEY``: API key
    - ``AZURE_OPENAI_DEPLOYMENT``: Model deployment name (e.g. gpt-4o-mini)
    - ``AZURE_OPENAI_API_VERSION``: API version (default: 2024-06-01)
    - ``AZURE_OPENAI_EMBEDDING_DEPLOYMENT``: (optional) e.g. text-embedding-3-small
    """

    def __init__(
        self,
        endpoint: str | None = None,
        api_key: str | None = None,
        deployment: str | None = None,
        embedding_deployment: str | None = None,
        api_version: str = "2024-06-01",
    ) -> None:
        self.endpoint = (endpoint or os.environ.get("AZURE_OPENAI_ENDPOINT", "")).rstrip("/")
        self.api_key = api_key or os.environ.get("AZURE_OPENAI_API_KEY", "")
        self.deployment = deployment or os.environ.get("AZURE_OPENAI_DEPLOYMENT", "gpt-4o-mini")
        self.embedding_deployment = embedding_deployment or os.environ.get(
            "AZURE_OPENAI_EMBEDDING_DEPLOYMENT", "text-embedding-3-small"
        )
        self.api_version = os.environ.get("AZURE_OPENAI_API_VERSION", api_version)

    @property
    def name(self) -> str:
        return "azure_openai"

    def is_available(self) -> bool:
        return bool(self.endpoint and self.api_key)

    def _chat_url(self) -> str:
        return f"{self.endpoint}/openai/deployments/{self.deployment}/chat/completions?api-version={self.api_version}"

    def _embedding_url(self) -> str:
        return f"{self.endpoint}/openai/deployments/{self.embedding_deployment}/embeddings?api-version={self.api_version}"

    def _headers(self) -> dict[str, str]:
        return {
            "api-key": self.api_key,
            "Content-Type": "application/json",
        }

    def generate_text(
        self,
        user: str,
        system: str = "You are a helpful assistant.",
        temperature: float = 0.4,
        json_mode: bool = False,
    ) -> str | None:
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]
        return self._post_chat(messages, temperature=temperature, json_mode=json_mode)

    def generate_chat(
        self,
        *,
        system: str,
        history: list[dict[str, str]],
        user_message: str,
        temperature: float = 0.6,
        json_mode: bool = False,
    ) -> str | None:
        messages = [{"role": "system", "content": system}]
        messages.extend(history)
        messages.append({"role": "user", "content": user_message})
        return self._post_chat(messages, temperature=temperature, json_mode=json_mode)

    def _post_chat(
        self,
        messages: list[dict[str, str]],
        temperature: float = 0.6,
        json_mode: bool = False,
    ) -> str | None:
        if not self.is_available():
            record_llm_call("azure_chat", "no_sdk_or_key")
            return None

        cache = get_cache("chat")
        key = make_key("azure_chat", self.deployment, messages, temperature, json_mode)
        cached_val = cache.get(key)
        if cached_val is not None:
            return cached_val  # type: ignore[no-any-return]

        payload: dict[str, Any] = {
            "messages": messages,
            "temperature": temperature,
        }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}

        try:
            with httpx.Client(timeout=25.0) as client:
                res = client.post(self._chat_url(), headers=self._headers(), json=payload)
                res.raise_for_status()
                data = res.json()
                text = data["choices"][0]["message"]["content"]
                cache.set(key, text)
                record_llm_call("azure_chat", "ok")
                return str(text)
        except Exception as exc:
            _logger.warning("Azure OpenAI chat call failed: %s", exc)
            record_llm_call("azure_chat", "api_error")
            return None

    def embed_text(self, text: str) -> list[float] | None:
        if not text or not text.strip() or not self.is_available():
            return None

        cache = get_cache("embed")
        key = make_key("azure_embed", self.embedding_deployment, text)
        cached_val = cache.get(key)
        if cached_val is not None:
            return cached_val  # type: ignore[no-any-return]

        try:
            with httpx.Client(timeout=15.0) as client:
                res = client.post(
                    self._embedding_url(),
                    headers=self._headers(),
                    json={"input": text},
                )
                res.raise_for_status()
                data = res.json()
                vec = data["data"][0]["embedding"]
                cache.set(key, vec)
                record_llm_call("azure_embed", "ok")
                return list(vec)
        except Exception as exc:
            _logger.warning("Azure OpenAI embed call failed: %s", exc)
            record_llm_call("azure_embed", "api_error")
            return None


class OpenAIProvider(LLMProvider):
    """Generic OpenAI / Compatible provider (OpenAI, Ollama, Groq, vLLM)."""

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
        embed_model: str | None = None,
    ) -> None:
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY", "")
        self.base_url = (base_url or os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")).rstrip("/")
        self.model = model or os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
        self.embed_model = embed_model or os.environ.get("OPENAI_EMBED_MODEL", "text-embedding-3-small")

    @property
    def name(self) -> str:
        return "openai"

    def is_available(self) -> bool:
        return bool(self.api_key)

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def generate_text(
        self,
        user: str,
        system: str = "You are a helpful assistant.",
        temperature: float = 0.4,
        json_mode: bool = False,
    ) -> str | None:
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]
        return self._post_chat(messages, temperature=temperature, json_mode=json_mode)

    def generate_chat(
        self,
        *,
        system: str,
        history: list[dict[str, str]],
        user_message: str,
        temperature: float = 0.6,
        json_mode: bool = False,
    ) -> str | None:
        messages = [{"role": "system", "content": system}]
        messages.extend(history)
        messages.append({"role": "user", "content": user_message})
        return self._post_chat(messages, temperature=temperature, json_mode=json_mode)

    def _post_chat(
        self,
        messages: list[dict[str, str]],
        temperature: float = 0.6,
        json_mode: bool = False,
    ) -> str | None:
        if not self.is_available():
            record_llm_call("openai_chat", "no_sdk_or_key")
            return None

        cache = get_cache("chat")
        key = make_key("openai_chat", self.model, messages, temperature, json_mode)
        cached = cache.get(key)
        if cached is not None:
            return cached  # type: ignore[no-any-return]

        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
        }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}

        try:
            with httpx.Client(timeout=25.0) as client:
                res = client.post(f"{self.base_url}/chat/completions", headers=self._headers(), json=payload)
                res.raise_for_status()
                data = res.json()
                text = data["choices"][0]["message"]["content"]
                cache.set(key, text)
                record_llm_call("openai_chat", "ok")
                return str(text)
        except Exception as exc:
            _logger.warning("OpenAI chat failed: %s", exc)
            record_llm_call("openai_chat", "api_error")
            return None

    def embed_text(self, text: str) -> list[float] | None:
        if not text or not text.strip() or not self.is_available():
            return None
        cache = get_cache("embed")
        key = make_key("openai_embed", self.embed_model, text)
        cached = cache.get(key)
        if cached is not None:
            return cached  # type: ignore[no-any-return]

        try:
            with httpx.Client(timeout=15.0) as client:
                res = client.post(
                    f"{self.base_url}/embeddings",
                    headers=self._headers(),
                    json={"model": self.embed_model, "input": text},
                )
                res.raise_for_status()
                data = res.json()
                vec = data["data"][0]["embedding"]
                cache.set(key, vec)
                record_llm_call("openai_embed", "ok")
                return list(vec)
        except Exception as exc:
            _logger.warning("OpenAI embedding failed: %s", exc)
            record_llm_call("openai_embed", "api_error")
            return None


class MockLLMProvider(LLMProvider):
    """Deterministic mock provider for offline tests and evaluation."""

    def __init__(self, responses: dict[str, str] | None = None, available: bool = True) -> None:
        self.responses = responses or {}
        self._available = available
        self.call_history: list[dict[str, Any]] = []

    @property
    def name(self) -> str:
        return "mock"

    def is_available(self) -> bool:
        return self._available

    def generate_text(
        self,
        user: str,
        system: str = "You are a helpful assistant.",
        temperature: float = 0.4,
        json_mode: bool = False,
        max_output_tokens: int | None = None,
    ) -> str | None:
        self.call_history.append({"type": "text", "user": user, "system": system, "max_tokens": max_output_tokens})
        if user in self.responses:
            return self.responses[user]
        if json_mode:
            return json.dumps({"reply": f"Mock response to: {user[:30]}"})
        return self.responses.get(user, f"Mock generated text for: {user}")

    def generate_chat(
        self,
        *,
        system: str,
        history: list[dict[str, str]],
        user_message: str,
        temperature: float = 0.6,
        json_mode: bool = False,
        max_output_tokens: int | None = None,
    ) -> str | None:
        self.call_history.append({
            "type": "chat",
            "user_message": user_message,
            "history": history,
            "max_tokens": max_output_tokens,
        })
        if user_message in self.responses:
            return self.responses[user_message]
        if json_mode:
            return json.dumps({
                "reply": f"I can help with {user_message}",
                "actions": [],
                "suggestions": [{"label": "Ask more", "prompt": "Tell me more"}],
            })
        return self.responses.get(user_message, f"Mock chat reply to {user_message}")

    def embed_text(self, text: str) -> list[float] | None:
        # Return deterministic 32-dim vector based on text hash
        val = abs(hash(text)) % 1000
        return [((val + i) % 10) / 10.0 for i in range(32)]


class FailoverLLMProvider(LLMProvider):
    """Cascading multi-provider failover LLM.

    Orchestrates an ordered list of providers (e.g. Gemini -> OpenAI/Groq -> Azure OpenAI).
    If a provider raises an error, times out, hits a quota cap, or returns None,
    execution smoothly fails over to the next configured provider in the cascade.
    """

    def __init__(self, providers: list[LLMProvider] | None = None) -> None:
        self._providers = providers

    @property
    def name(self) -> str:
        return "failover"

    def get_chain(self) -> list[LLMProvider]:
        """Return the list of providers in priority order."""
        if self._providers is not None:
            return self._providers
        chain: list[LLMProvider] = []
        gem = GeminiProvider()
        if gem.is_available():
            chain.append(gem)
        oai = OpenAIProvider()
        if oai.is_available():
            chain.append(oai)
        az = AzureOpenAIProvider()
        if az.is_available():
            chain.append(az)
        return chain

    def is_available(self) -> bool:
        return any(p.is_available() for p in self.get_chain())

    def generate_text(
        self,
        user: str,
        system: str = "You are a helpful assistant.",
        temperature: float = 0.4,
        json_mode: bool = False,
        max_output_tokens: int | None = None,
    ) -> str | None:
        chain = self.get_chain()
        for idx, provider in enumerate(chain):
            try:
                res = provider.generate_text(
                    user=user,
                    system=system,
                    temperature=temperature,
                    json_mode=json_mode,
                    max_output_tokens=max_output_tokens,
                )
                if res is not None:
                    if idx > 0:
                        _logger.info("Failover succeeded with provider '%s' (attempt %d)", provider.name, idx + 1)
                        record_llm_call("failover_text", "ok")
                    return res
                _logger.warning("Provider '%s' returned empty text, failing over...", provider.name)
            except Exception as exc:
                _logger.warning("Provider '%s' failed in generate_text: %s. Failing over...", provider.name, exc)
                record_llm_call("failover_text", f"error_{provider.name}")
        return None

    def generate_chat(
        self,
        *,
        system: str,
        history: list[dict[str, str]],
        user_message: str,
        temperature: float = 0.6,
        json_mode: bool = False,
        max_output_tokens: int | None = None,
    ) -> str | None:
        chain = self.get_chain()
        for idx, provider in enumerate(chain):
            try:
                res = provider.generate_chat(
                    system=system,
                    history=history,
                    user_message=user_message,
                    temperature=temperature,
                    json_mode=json_mode,
                    max_output_tokens=max_output_tokens,
                )
                if res is not None:
                    if idx > 0:
                        _logger.info("Failover succeeded with provider '%s' (attempt %d)", provider.name, idx + 1)
                        record_llm_call("failover_chat", "ok")
                    return res
                _logger.warning("Provider '%s' returned empty chat reply, failing over...", provider.name)
            except Exception as exc:
                _logger.warning("Provider '%s' failed in generate_chat: %s. Failing over...", provider.name, exc)
                record_llm_call("failover_chat", f"error_{provider.name}")
        return None

    def embed_text(self, text: str) -> list[float] | None:
        chain = self.get_chain()
        for provider in chain:
            try:
                res = provider.embed_text(text)
                if res is not None:
                    return res
            except Exception as exc:
                _logger.warning("Provider '%s' failed in embed_text: %s. Failing over...", provider.name, exc)
        return None


def get_fallback_provider() -> LLMProvider | None:
    """Return configured or auto-detected secondary LLM provider.

    Configuration hierarchy:
    1. Explicit FALLBACK_LLM_PROVIDER ('openai', 'azure_openai', 'mock')
    2. Auto-detection:
       - OPENAI_API_KEY (supports OpenAI, Groq, Ollama, OpenRouter, vLLM via OPENAI_BASE_URL)
       - AZURE_OPENAI_API_KEY & AZURE_OPENAI_ENDPOINT
    """
    explicit = os.environ.get("FALLBACK_LLM_PROVIDER", "").strip().lower()
    if explicit:
        return get_llm_provider(explicit)

    if os.environ.get("OPENAI_API_KEY"):
        return get_llm_provider("openai")
    if os.environ.get("AZURE_OPENAI_API_KEY") and os.environ.get("AZURE_OPENAI_ENDPOINT"):
        return get_llm_provider("azure_openai")
    return None


_PROVIDERS: dict[str, LLMProvider] = {}


def get_llm_provider(name: str | None = None) -> LLMProvider:
    """Return configured or requested LLM provider singleton.

    Priority:
    1. Explicit ``name`` parameter
    2. ``LLM_PROVIDER`` environment variable
    3. Default: ``gemini``
    """
    chosen = (name or os.environ.get("LLM_PROVIDER", "gemini")).strip().lower()
    if chosen not in _PROVIDERS:
        if chosen in ("azure_openai", "azure"):
            _PROVIDERS[chosen] = AzureOpenAIProvider()
        elif chosen == "openai":
            _PROVIDERS[chosen] = OpenAIProvider()
        elif chosen == "mock":
            _PROVIDERS[chosen] = MockLLMProvider()
        elif chosen in ("failover", "auto", "cascade"):
            _PROVIDERS[chosen] = FailoverLLMProvider()
        else:
            _PROVIDERS[chosen] = GeminiProvider()
    return _PROVIDERS[chosen]


def parse_json(text: str) -> Any | None:
    """Re-export of JSON parser for convenience across providers."""
    return gemini.parse_json(text)
