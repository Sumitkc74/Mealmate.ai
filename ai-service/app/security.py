"""Service-to-service auth and rate limiting for the AI microservice.

The ai-service is a backend-only service: only the Express server should
call it. It was previously unauthenticated, so anyone on the internet could
call /chat, /recipes/verify, /rag/index, ... directly, burning the shared
Gemini quota and poisoning the RAG index. This module adds:

- A shared-secret check (``X-AI-Service-Key`` header, constant-time
  compare) on every route except /health, /, and the docs. The key is set
  via the ``AI_SERVICE_KEY`` env var on both the ai-service and the server.
  When the key is not configured (local dev), requests are allowed and a
  warning is logged — production must set it.
- A per-IP fixed-window rate limit (defense in depth behind the secret).
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import time
from collections import defaultdict

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

logger = logging.getLogger(__name__)

# Paths that never require the service key (health checks, docs).
PUBLIC_PATHS = {"/", "/health", "/docs", "/redoc", "/openapi.json", "/metrics"}

# Per-IP fixed-window rate limit for AI routes (defense in depth behind the
# shared secret). Generous enough for the Express server's legitimate
# traffic (one IP), tight enough to blunt a single-IP flood.
RATE_LIMIT_WINDOW_S = 15 * 60
RATE_LIMIT_MAX = 300

# ip -> [window_start_epoch, count]
_windows: dict[str, list[float]] = defaultdict(lambda: [0.0, 0])


def _is_public_path(path: str) -> bool:
    return path in PUBLIC_PATHS


def _check_key(request: Request, expected_key: str | None) -> bool:
    """True when the request is allowed by the shared-secret check."""
    if not expected_key:
        return True
    provided = request.headers.get("x-ai-service-key", "")
    # Constant-time compare so the key cannot be guessed byte-by-byte.
    return hmac.compare_digest(provided, expected_key)


def _rate_limited(ip: str) -> bool:
    """True when this IP has exceeded the fixed-window rate limit."""
    now = time.monotonic()
    window_start, count = _windows[ip]
    if now - window_start >= RATE_LIMIT_WINDOW_S:
        _windows[ip] = [now, 1]
        return False
    if count >= RATE_LIMIT_MAX:
        return True
    _windows[ip][1] = count + 1
    return False


def _key_fingerprint(key: str) -> str:
    """A non-secret fingerprint of the key for logs (first 6 hex of SHA-256)."""
    return hashlib.sha256(key.encode()).hexdigest()[:6]


class AiServiceSecurityMiddleware(BaseHTTPMiddleware):
    """Require the shared service key (when configured) and rate-limit by IP."""

    def __init__(self, app, *, api_key: str | None) -> None:
        super().__init__(app)
        self._api_key = api_key
        if not api_key:
            logger.warning(
                "AI_SERVICE_KEY is not set — ai-service accepts unauthenticated "
                "requests. Set AI_SERVICE_KEY in production."
            )
        else:
            logger.info("ai-service key auth enabled (key fingerprint %s)", _key_fingerprint(api_key))

    async def dispatch(self, request: Request, call_next):  # type: ignore[no-untyped-def]
        path = request.url.path
        if not _is_public_path(path):
            if not _check_key(request, self._api_key):
                return JSONResponse(
                    status_code=401,
                    content={"success": False, "message": "Missing or invalid AI service key"},
                )
            ip = request.client.host if request.client else "unknown"
            if _rate_limited(ip):
                return JSONResponse(
                    status_code=429,
                    content={"success": False, "message": "AI service rate limit reached. Please try again shortly."},
                )
        return await call_next(request)
