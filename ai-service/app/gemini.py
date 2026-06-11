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
from typing import Any

from .cache import get_cache, make_key
from .metrics import record_llm_call

DEFAULT_MODEL = "models/gemini-1.5-flash"

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


def is_available() -> bool:
    """Cheap check used by routes to advertise feature availability."""
    return bool(os.environ.get("GEMINI_API_KEY"))


def _model_name() -> str:
    return os.environ.get("GEMINI_MODEL", DEFAULT_MODEL)


def _embed_model_name() -> str:
    return os.environ.get("GEMINI_EMBED_MODEL", "text-embedding-004")


def _configure() -> Any | None:
    """Return a configured ``google.generativeai`` module or ``None``."""
    if not is_available():
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
) -> str | None:
    """Single-shot generation. Returns the text reply, or ``None`` on failure."""
    cache = get_cache("text")
    key = make_key("text", _model_name(), system, user, temperature, json_mode)
    cached_val = cache.get(key)
    if cached_val is not None:
        return cached_val  # type: ignore[no-any-return]

    genai = _configure()
    if genai is None:
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
        resp = model.generate_content(user, generation_config=config)
    except Exception as exc:  # pragma: no cover - network path
        quota = _maybe_quota_error(exc, _model_name())
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
) -> str | None:
    """Multi-turn chat. ``history`` items are ``{"role": "user"|"assistant", "content": str}``.

    Cached on the (model, system, history, user_message, temperature, json_mode)
    tuple, so identical turns from the same conversation return instantly.
    When ``json_mode`` is true the model is forced to return a JSON object —
    callers should pair this with :func:`parse_json` to decode it.
    """
    cache = get_cache("chat")
    key = make_key(
        "chat", _model_name(), system, history, user_message, temperature, json_mode
    )
    cached_val = cache.get(key)
    if cached_val is not None:
        return cached_val  # type: ignore[no-any-return]

    genai = _configure()
    if genai is None:
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
        resp = chat.send_message(user_message, generation_config=config)
    except Exception as exc:  # pragma: no cover - network path
        # Surface quota errors distinctly so the UI can show a precise
        # "daily limit hit, retry in N s" message instead of misleading
        # "try rephrasing" advice that doesn't apply.
        quota = _maybe_quota_error(exc, _model_name())
        if quota is not None:
            _logger.warning(
                "gemini.generate_chat quota exceeded (retry_after=%ss): %s",
                quota.retry_after,
                quota,
            )
            record_llm_call("chat", "quota_exceeded")
            raise quota from exc
        # Log the underlying SDK error so we can actually diagnose chat
        # failures instead of seeing a silent "api_error" counter bump.
        _logger.warning(
            "gemini.generate_chat failed: %s: %s",
            type(exc).__name__,
            exc,
        )
        record_llm_call("chat", "api_error")
        return None
    # `resp.text` is a convenience accessor that raises when the response has
    # no usable text part (e.g. blocked by safety, finish_reason != STOP).
    # Mirror the candidates-fallback in `generate_text` so chat is just as
    # robust as one-shot generation.
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
        # Surface the finish reason so logs make the failure debuggable.
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


def embed_text(text: str) -> list[float] | None:
    """Return a unit-norm embedding for ``text``, or ``None`` if Gemini is unavailable.

    Uses the configured ``GEMINI_EMBED_MODEL`` (default ``text-embedding-004``).
    Results are cached for the duration of the configured TTL.
    """
    if not text or not text.strip():
        return None
    cache = get_cache("embed")
    key = make_key("embed", _embed_model_name(), text)
    cached_val = cache.get(key)
    if cached_val is not None:
        return cached_val  # type: ignore[no-any-return]

    genai = _configure()
    if genai is None:
        record_llm_call("embed", "no_sdk_or_key")
        return None
    try:
        resp = genai.embed_content(model=_embed_model_name(), content=text)
    except Exception:  # pragma: no cover - network path
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
