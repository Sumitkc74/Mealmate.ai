"""Shared Google Gemini helpers.

Gemini is an *optional* dependency: the SDK is imported lazily inside each
function so unit tests pass without ``google-generativeai`` installed and the
service still starts when the API key isn't set.

All public helpers return ``None`` on any failure so callers can gracefully
fall back to deterministic strategies (TF-IDF / heuristics).

Every successful network call is recorded as a Prometheus counter and
memoised in a TTL-LRU cache (see :py:mod:`app.cache` and :py:mod:`app.metrics`).
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Iterator

from .cache import get_cache, make_key
from .metrics import record_llm_call

# Free-tier Flash-Lite default (Nov 2026). `gemini-1.5-flash` was retired by
# Google and shut down on the Gemini API on 2025-09-29, so every call to it
# now fails fast with a 404 — which the old code surfaced as a misleading
# "came back empty" chat reply. `gemini-3.8-flash` (the previous default)
# works but its free tier is only 5 RPM / 20 requests a day, which the app
# exhausts by evening — the SDK then retries 429s for minutes and the chat
# crawls. `gemini-3.5-flash-lite` is 15 RPM / 500 requests a day (25x the
# daily allowance) on the same free tier, so the chat stays fast. Override
# with GEMINI_MODEL to pin another supported model.
DEFAULT_MODEL = "models/gemini-3.5-flash-lite"

_logger = logging.getLogger(__name__)


class GeminiQuotaError(RuntimeError):
    """Raised when the Gemini API rejects a call with HTTP 429 (quota / rate-limit).

    Carries the model name and a retry-after hint (seconds) parsed from the
    SDK's ``ResourceExhausted`` exception so the caller can surface an
    accurate message to the end-user instead of generic "try rephrasing"
    advice (which is misleading when the real cause is a hard quota cap).
    """

    def __init__(self, message: str, *, model: str, retry_after: int | None = None) -> None:
        super().__init__(message)
        self.model = model
        self.retry_after = retry_after


class GeminiModelError(RuntimeError):
    """Raised when the configured Gemini model is not available (HTTP 404).

    This is a configuration error, not a transient failure: the model id was
    retired or was never valid for this API version, so no amount of
    rephrasing or retrying will help. Callers should surface an honest
    "model unavailable" message instead of the generic "came back empty"
    fallback, which blames the user's wording for a server-side problem.
    """

    def __init__(self, message: str, *, model: str) -> None:
        super().__init__(message)
        self.model = model


def _maybe_model_error(exc: BaseException, model: str) -> GeminiModelError | None:
    """Detect a 404 / model-not-found from the Gemini SDK and convert it.

    The SDK raises ``google.api_core.exceptions.NotFound`` (or a plain
    ``ClientError`` whose message contains ``404`` / ``not found``) when the
    requested model id no longer exists — e.g. after Google retires it.
    """
    name = type(exc).__name__
    msg = str(exc)
    is_model_error = (
        name == "NotFound"
        or "404" in msg
        or "not found" in msg.lower()
        or "is not supported for generatecontent" in msg.lower()
    )
    if not is_model_error:
        return None
    return GeminiModelError(msg.split("\n", 1)[0], model=model)


def _maybe_quota_error(exc: BaseException, model: str) -> GeminiQuotaError | None:
    """Detect a 429 / ResourceExhausted from the Gemini SDK and convert it.

    The SDK exposes the error as ``google.api_core.exceptions.ResourceExhausted``
    on most installs; on older builds it's a plain string message containing
    ``429``. We sniff both shapes and extract the ``retry_delay { seconds: N }``
    block when present so the UI can show a precise countdown.
    """
    name = type(exc).__name__
    msg = str(exc)
    is_quota = name == "ResourceExhausted" or "429" in msg or "quota" in msg.lower()
    if not is_quota:
        return None
    retry_after: int | None = None
    # Look for ``seconds: 25`` inside the retry_delay block the SDK serialises.
    match = re.search(r"retry_delay\s*\{\s*seconds:\s*(\d+)", msg)
    if match:
        retry_after = int(match.group(1))
    else:
        match = re.search(r"retry[_ ]?after[^\d]*(\d+)", msg, re.IGNORECASE)
        if match:
            retry_after = int(match.group(1))
    return GeminiQuotaError(msg.split("\n", 1)[0], model=model, retry_after=retry_after)


def is_gemini_available() -> bool:
    """Return True if Google Gemini API key is configured."""
    return bool(os.environ.get("GEMINI_API_KEY"))


def _get_fallback_provider() -> Any | None:
    """Lazily load secondary fallback LLM provider to avoid circular imports."""
    try:
        from .llm_provider import get_fallback_provider
        return get_fallback_provider()
    except Exception as exc:
        _logger.debug("Failed to resolve fallback LLM provider: %s", exc)
        return None


def is_available() -> bool:
    """Cheap check used by routes to advertise feature availability.

    Returns True if Gemini is available OR if an alternative fallback
    provider (OpenAI, Groq, Ollama, Azure OpenAI) is configured and ready.
    """
    if is_gemini_available():
        return True
    fb = _get_fallback_provider()
    return bool(fb and fb.is_available())


def _model_name() -> str:
    return os.environ.get("GEMINI_MODEL", DEFAULT_MODEL)


def _embed_model_name() -> str:
    return os.environ.get("GEMINI_EMBED_MODEL", "text-embedding-004")


def _configure() -> Any | None:
    """Return a configured ``google.generativeai`` module or ``None``."""
    if not is_gemini_available():
        return None
    try:
        import google.generativeai as genai  # type: ignore[import-not-found]
    except ImportError:
        return None
    try:
        genai.configure(api_key=os.environ["GEMINI_API_KEY"])
    except Exception:  # pragma: no cover - defensive
        return None
    return genai


def generate_text(
    user: str,
    system: str = "You are a helpful assistant.",
    temperature: float = 0.4,
    json_mode: bool = False,
    max_output_tokens: int | None = None,
) -> str | None:
    """Single-shot generation with automatic multi-provider failover.

    Returns the text reply, or ``None`` on total failure.
    """
    cache = get_cache("text")
    key = make_key("text", _model_name(), system, user, temperature, json_mode, max_output_tokens)
    cached_val = cache.get(key)
    if cached_val is not None:
        return cached_val  # type: ignore[no-any-return]

    genai = _configure()
    if genai is None:
        fallback = _get_fallback_provider()
        if fallback and fallback.is_available():
            _logger.info("Gemini not configured; failing over to %s for generate_text", fallback.name)
            res = fallback.generate_text(
                user=user,
                system=system,
                temperature=temperature,
                json_mode=json_mode,
                max_output_tokens=max_output_tokens,
            )
            if res:
                cache.set(key, res)
                return res
        record_llm_call("text", "no_sdk_or_key")
        return None

    try:
        model = genai.GenerativeModel(
            model_name=_model_name(),
            system_instruction=system,
        )
        config: dict[str, Any] = {"temperature": temperature}
        if json_mode:
            config["response_mime_type"] = "application/json"
        if max_output_tokens is not None:
            config["max_output_tokens"] = max_output_tokens
        resp = model.generate_content(user, generation_config=config)
    except Exception as exc:  # pragma: no cover - network path
        quota = _maybe_quota_error(exc, _model_name())
        _logger.warning("gemini.generate_text failed (%s). Attempting failover to secondary provider...", exc)
        fallback = _get_fallback_provider()
        if fallback and fallback.is_available():
            _logger.info("Failing over generate_text to secondary provider: %s", fallback.name)
            try:
                res = fallback.generate_text(
                    user=user,
                    system=system,
                    temperature=temperature,
                    json_mode=json_mode,
                    max_output_tokens=max_output_tokens,
                )
                if res:
                    cache.set(key, res)
                    record_llm_call("text_failover", "ok")
                    return res
            except Exception as fb_exc:
                _logger.warning("Secondary provider %s also failed in generate_text: %s", fallback.name, fb_exc)

        if quota is not None:
            _logger.warning(
                "gemini.generate_text quota exceeded (retry_after=%ss): %s",
                quota.retry_after,
                quota,
            )
            record_llm_call("text", "quota_exceeded")
            raise quota from exc

        _logger.warning(
            "gemini.generate_text failed: %s: %s",
            type(exc).__name__,
            exc,
        )
        record_llm_call("text", "api_error")
        return None

    text = getattr(resp, "text", None)
    if not text:
        try:
            text = resp.candidates[0].content.parts[0].text  # type: ignore[index]
        except Exception:
            text = None
    if not text:
        fallback = _get_fallback_provider()
        if fallback and fallback.is_available():
            _logger.info("Gemini returned empty text; failing over to %s", fallback.name)
            try:
                res = fallback.generate_text(
                    user=user,
                    system=system,
                    temperature=temperature,
                    json_mode=json_mode,
                    max_output_tokens=max_output_tokens,
                )
                if res:
                    cache.set(key, res)
                    record_llm_call("text_failover", "ok")
                    return res
            except Exception as fb_exc:
                _logger.warning("Secondary provider %s failed on empty gemini text: %s", fallback.name, fb_exc)
        record_llm_call("text", "empty_response")
        return None

    if text:
        cache.set(key, text)
        record_llm_call("text", "ok")
        return text
    return None


def generate_chat(
    *,
    system: str,
    history: list[dict[str, str]],
    user_message: str,
    temperature: float = 0.6,
    json_mode: bool = False,
    max_output_tokens: int | None = None,
) -> str | None:
    """Multi-turn chat with automatic multi-provider failover."""
    cache = get_cache("chat")
    key = make_key(
        "chat", _model_name(), system, history, user_message, temperature, json_mode, max_output_tokens
    )
    cached_val = cache.get(key)
    if cached_val is not None:
        return cached_val  # type: ignore[no-any-return]

    genai = _configure()
    if genai is None:
        fallback = _get_fallback_provider()
        if fallback and fallback.is_available():
            _logger.info("Gemini not configured; failing over to %s for generate_chat", fallback.name)
            res = fallback.generate_chat(
                system=system,
                history=history,
                user_message=user_message,
                temperature=temperature,
                json_mode=json_mode,
                max_output_tokens=max_output_tokens,
            )
            if res:
                cache.set(key, res)
                return res
        record_llm_call("chat", "no_sdk_or_key")
        return None

    try:
        model = genai.GenerativeModel(
            model_name=_model_name(),
            system_instruction=system,
        )
        gemini_history = [
            {
                "role": "model" if h["role"] == "assistant" else "user",
                "parts": [h["content"]],
            }
            for h in history
        ]
        chat = model.start_chat(history=gemini_history)
        config: dict[str, Any] = {"temperature": temperature}
        if json_mode:
            config["response_mime_type"] = "application/json"
        if max_output_tokens is not None:
            config["max_output_tokens"] = max_output_tokens
        resp = chat.send_message(user_message, generation_config=config)
    except Exception as exc:  # pragma: no cover - network path
        quota = _maybe_quota_error(exc, _model_name())
        _logger.warning("gemini.generate_chat failed (%s). Attempting failover to secondary provider...", exc)
        fallback = _get_fallback_provider()
        if fallback and fallback.is_available():
            _logger.info("Failing over generate_chat to secondary provider: %s", fallback.name)
            try:
                res = fallback.generate_chat(
                    system=system,
                    history=history,
                    user_message=user_message,
                    temperature=temperature,
                    json_mode=json_mode,
                    max_output_tokens=max_output_tokens,
                )
                if res:
                    cache.set(key, res)
                    record_llm_call("chat_failover", "ok")
                    return res
            except Exception as fb_exc:
                _logger.warning("Secondary provider %s also failed in generate_chat: %s", fallback.name, fb_exc)

        if quota is not None:
            _logger.warning(
                "gemini.generate_chat quota exceeded (retry_after=%ss): %s",
                quota.retry_after,
                quota,
            )
            record_llm_call("chat", "quota_exceeded")
            raise quota from exc

        model_err = _maybe_model_error(exc, _model_name())
        if model_err is not None:
            # Retired / unknown model id: retrying or rephrasing cannot fix
            # this, so surface it as a configuration error rather than the
            # generic "came back empty" fallback.
            _logger.warning(
                "gemini.generate_chat model unavailable (%s): %s",
                model_err.model,
                model_err,
            )
            record_llm_call("chat", "model_not_found")
            raise model_err from exc

        _logger.warning(
            "gemini.generate_chat failed: %s: %s",
            type(exc).__name__,
            exc,
        )
        record_llm_call("chat", "api_error")
        return None

    text: str | None
    try:
        text = getattr(resp, "text", None)
    except Exception:
        text = None
    if not text:
        try:
            text = resp.candidates[0].content.parts[0].text  # type: ignore[index]
        except Exception:
            text = None
    if not text:
        fallback = _get_fallback_provider()
        if fallback and fallback.is_available():
            _logger.info("Gemini returned empty chat response; failing over to %s", fallback.name)
            try:
                res = fallback.generate_chat(
                    system=system,
                    history=history,
                    user_message=user_message,
                    temperature=temperature,
                    json_mode=json_mode,
                    max_output_tokens=max_output_tokens,
                )
                if res:
                    cache.set(key, res)
                    record_llm_call("chat_failover", "ok")
                    return res
            except Exception as fb_exc:
                _logger.warning("Secondary provider %s failed on empty gemini chat response: %s", fallback.name, fb_exc)

        finish = None
        try:
            finish = getattr(resp.candidates[0], "finish_reason", None)
        except Exception:
            pass
        record_llm_call("chat", f"empty_response:{finish}" if finish else "empty_response")
        return None

    cache.set(key, text)
    record_llm_call("chat", "ok")
    return text


def generate_chat_stream(
    *,
    system: str,
    history: list[dict[str, str]],
    user_message: str,
    temperature: float = 0.6,
    json_mode: bool = False,
    max_output_tokens: int | None = 1024,
) -> Iterator[str]:
    """Yield incremental text chunks for multi-turn chat."""
    genai = _configure()
    if genai is None:
        fallback = _get_fallback_provider()
        if fallback and fallback.is_available():
            _logger.info("Gemini not configured; failing over to %s for generate_chat_stream", fallback.name)
            res = fallback.generate_chat(
                system=system,
                history=history,
                user_message=user_message,
                temperature=temperature,
                json_mode=json_mode,
                max_output_tokens=max_output_tokens,
            )
            if res:
                yield res
            return
        return

    try:
        model = genai.GenerativeModel(
            model_name=_model_name(),
            system_instruction=system,
        )
        gemini_history = [
            {
                "role": "model" if h["role"] == "assistant" else "user",
                "parts": [h["content"]],
            }
            for h in history
        ]
        chat = model.start_chat(history=gemini_history)
        config: dict[str, Any] = {"temperature": temperature}
        if json_mode:
            config["response_mime_type"] = "application/json"
        if max_output_tokens is not None:
            config["max_output_tokens"] = max_output_tokens

        resp = chat.send_message(user_message, generation_config=config, stream=True)
        for chunk in resp:
            text = getattr(chunk, "text", None)
            if text:
                yield text
    except Exception as exc:  # pragma: no cover - network path
        quota = _maybe_quota_error(exc, _model_name())
        if quota is not None:
            raise quota from exc

        _logger.warning("gemini.generate_chat_stream failed: %s. Attempting fallback...", exc)
        fallback = _get_fallback_provider()
        if fallback and fallback.is_available():
            try:
                res = fallback.generate_chat(
                    system=system,
                    history=history,
                    user_message=user_message,
                    temperature=temperature,
                    json_mode=json_mode,
                    max_output_tokens=max_output_tokens,
                )
                if res:
                    yield res
                    return
            except Exception:
                pass
        return


def embed_text(text: str) -> list[float] | None:
    """Return an embedding vector for ``text`` with fallback support."""
    if not text or not text.strip():
        return None
    cache = get_cache("embed")
    key = make_key("embed", _embed_model_name(), text)
    cached_val = cache.get(key)
    if cached_val is not None:
        return cached_val  # type: ignore[no-any-return]

    genai = _configure()
    if genai is None:
        fallback = _get_fallback_provider()
        if fallback and fallback.is_available():
            res = fallback.embed_text(text)
            if res:
                cache.set(key, res)
                return res
        record_llm_call("embed", "no_sdk_or_key")
        return None

    try:
        resp = genai.embed_content(model=_embed_model_name(), content=text)
    except Exception:  # pragma: no cover - network path
        fallback = _get_fallback_provider()
        if fallback and fallback.is_available():
            res = fallback.embed_text(text)
            if res:
                cache.set(key, res)
                return res
        record_llm_call("embed", "api_error")
        return None
    vec = resp.get("embedding") if isinstance(resp, dict) else getattr(resp, "embedding", None)
    if not vec:
        record_llm_call("embed", "empty_response")
        return None
    cache.set(key, list(vec))
    record_llm_call("embed", "ok")
    return list(vec)


def parse_json(text: str) -> Any | None:
    """Best-effort JSON parser that tolerates code fences and stray prose."""
    if not text:
        return None
    cleaned = text.strip()
    # Strip common ```json ... ``` fences.
    fenced = re.match(r"^```(?:json)?\s*(.*?)\s*```$", cleaned, re.DOTALL)
    if fenced:
        cleaned = fenced.group(1)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        # Last-ditch: pull out the first {...} or [...] block.
        match = re.search(r"(\{.*\}|\[.*\])", cleaned, re.DOTALL)
        if not match:
            return None
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            return None


def generate_json(prompt: str) -> Any | None:
    """Generate a JSON object from a prompt, parsed from the model's reply.

    Wraps :func:`generate_text` (JSON mode) with :func:`parse_json`.
    Added because the recipe verifier and nutrition estimation call this
    name; without it the AI verification path raised AttributeError and
    silently fell back to deterministic rules, so the LLM coherence
    checks never ran.
    """
    text = generate_text(prompt, json_mode=True)
    if text is None:
        return None
    return parse_json(text)
