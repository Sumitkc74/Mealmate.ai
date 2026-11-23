"""Tests for the ai-service shared-secret auth + rate limiting (security.py).

The ai-service was previously unauthenticated: anyone could call /chat,
/recipes/verify, /rag/index, ... directly and burn the shared Gemini quota.
These tests pin the fix: a configured key is required on AI routes, /health
stays public, and a wrong key is rejected.
"""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.security import AiServiceSecurityMiddleware, _windows


def _make_client(api_key: str | None) -> TestClient:
    app = FastAPI()
    app.add_middleware(AiServiceSecurityMiddleware, api_key=api_key)

    @app.get("/health")
    def health() -> dict[str, bool]:
        return {"success": True}

    @app.post("/chat")
    def chat() -> dict[str, bool]:
        return {"success": True}

    return TestClient(app)


def test_health_is_public_even_with_key_configured() -> None:
    client = _make_client("test-secret-key")
    assert client.get("/health").status_code == 200


def test_ai_route_rejects_missing_key() -> None:
    client = _make_client("test-secret-key")
    assert client.post("/chat", json={}).status_code == 401


def test_ai_route_rejects_wrong_key() -> None:
    client = _make_client("test-secret-key")
    assert client.post("/chat", json={}, headers={"X-AI-Service-Key": "wrong"}).status_code == 401


def test_ai_route_accepts_correct_key() -> None:
    client = _make_client("test-secret-key")
    assert client.post("/chat", json={}, headers={"X-AI-Service-Key": "test-secret-key"}).status_code == 200


def test_ai_route_allowed_when_no_key_configured() -> None:
    # Local dev runs without AI_SERVICE_KEY; the middleware must not break
    # it (production is protected by actually setting the key).
    client = _make_client(None)
    assert client.post("/chat", json={}).status_code == 200


def test_rate_limit_blocks_after_max() -> None:
    # Shrink the window to a single request by patching the module constant.
    import app.security as sec

    old_max = sec.RATE_LIMIT_MAX
    sec.RATE_LIMIT_MAX = 1
    _windows.clear()
    try:
        client = _make_client("test-secret-key")
        headers = {"X-AI-Service-Key": "test-secret-key"}
        assert client.post("/chat", json={}, headers=headers).status_code == 200
        assert client.post("/chat", json={}, headers=headers).status_code == 429
    finally:
        sec.RATE_LIMIT_MAX = old_max
        _windows.clear()
