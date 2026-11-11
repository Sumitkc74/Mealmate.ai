"""Tests for the cooking-assistant chat endpoint and the pantry parser.

These tests run entirely offline — Gemini calls are mocked. The fallback
paths (no API key) are verified end-to-end against the FastAPI app.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app import chat as chat_service
from app import pantry_parser
from app.main import app
from app.schemas import ChatRequest, ChatMessage, PantryParseRequest


def test_chat_falls_back_without_api_key(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    req = ChatRequest(
        messages=[ChatMessage(role="user", content="What can I make with tomatoes?")],
        pantry=["tomato", "garlic"],
        dietary_preferences=["vegetarian"],
        allergies=[],
    )
    resp = chat_service.reply(req)
    assert resp.strategy == "fallback"
    assert "tomato" in resp.reply.lower()
    assert resp.suggestions  # default chips are populated


def test_chat_uses_gemini_when_available(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "fake-key-123")

    captured: dict[str, object] = {}

    def fake_chat(*, system, history, user_message, temperature=0.6, **kwargs):
        captured["system"] = system
        captured["history"] = history
        captured["user"] = user_message
        return "Try a quick caprese: tomato, mozzarella, basil, olive oil. 10 minutes."

    monkeypatch.setattr(chat_service.gemini, "is_available", lambda: True)
    monkeypatch.setattr(chat_service.gemini, "generate_chat", fake_chat)

    req = ChatRequest(
        messages=[
            ChatMessage(role="user", content="Quick lunch?"),
            ChatMessage(role="assistant", content="Sure — what's in your pantry?"),
            ChatMessage(role="user", content="Tomatoes and mozzarella."),
        ],
        pantry=["tomato", "mozzarella"],
        dietary_preferences=["vegetarian"],
        allergies=["peanut"],
    )
    resp = chat_service.reply(req)
    assert resp.strategy == "llm"
    assert "caprese" in resp.reply.lower()
    # System prompt must include allergy warning + pantry context.
    assert "peanut" in str(captured["system"]).lower()
    assert "tomato" in str(captured["system"]).lower()
    # Only prior messages go in history; current message is sent separately.
    assert captured["user"] == "Tomatoes and mozzarella."
    assert len(captured["history"]) == 2  # type: ignore[arg-type]


def test_pantry_parser_heuristic_basic(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    result = pantry_parser.parse(
        PantryParseRequest(
            text="2 tomatoes, half a red onion, 200g chicken breast, leftover rice and a clove of garlic"
        )
    )
    assert result.strategy == "heuristic"
    names = {i.ingredient for i in result.items}
    assert "tomatoes" in names or "tomato" in names
    assert any("onion" in n for n in names)
    assert any("chicken" in n for n in names)
    assert "rice" in names
    assert any("garlic" in n for n in names)
    # quantity / unit extraction
    chicken = next(i for i in result.items if "chicken" in i.ingredient)
    assert chicken.quantity == "200"
    assert chicken.unit == "g"


def test_pantry_parser_uses_llm_when_available(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "fake-key-123")
    monkeypatch.setattr(pantry_parser.gemini, "is_available", lambda: True)
    monkeypatch.setattr(
        pantry_parser.gemini,
        "generate_text",
        lambda **_: '{"items": [{"ingredient": "tomato", "quantity": "2", "unit": null}, '
        '{"ingredient": "rice", "quantity": null, "unit": null}]}',
    )

    result = pantry_parser.parse(PantryParseRequest(text="2 tomatoes and some leftover rice"))
    assert result.strategy == "llm"
    assert [i.ingredient for i in result.items] == ["tomato", "rice"]
    assert result.items[0].quantity == "2"
    assert result.items[1].unit is None


def test_chat_endpoint_returns_200(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    client = TestClient(app)
    resp = client.post(
        "/chat",
        json={
            "messages": [{"role": "user", "content": "Hi"}],
            "pantry": ["tomato"],
            "dietary_preferences": [],
            "allergies": [],
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["strategy"] == "fallback"
    assert isinstance(body["reply"], str) and body["reply"]


def test_pantry_parse_endpoint_returns_items(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    client = TestClient(app)
    resp = client.post("/pantry/parse", json={"text": "1 cup flour, 2 eggs, milk"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert any(i["ingredient"] == "flour" for i in body["items"])
    assert any(i["ingredient"] == "eggs" or i["ingredient"] == "egg" for i in body["items"])


def test_capabilities_endpoint(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    client = TestClient(app)
    resp = client.get("/capabilities")
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["llm"]["available"] is False
    assert body["features"]["chat"] is True


def test_chat_stream_falls_back_without_api_key(monkeypatch):
    import json
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    client = TestClient(app)
    resp = client.post(
        "/chat/stream",
        json={
            "messages": [{"role": "user", "content": "What can I cook?"}],
            "pantry": ["rice"],
            "dietary_preferences": [],
            "allergies": [],
        },
    )
    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]
    text = resp.text
    assert "data: " in text
    lines = [line[6:] for line in text.splitlines() if line.startswith("data: ")]
    events = [json.loads(l) for l in lines]
    assert any(e.get("type") == "token" for e in events)
    done_ev = next(e for e in events if e.get("type") == "done")
    assert done_ev["strategy"] == "fallback"
    assert "rice" in done_ev["reply"].lower()


def test_chat_stream_uses_gemini_when_available(monkeypatch):
    import json
    monkeypatch.setenv("GEMINI_API_KEY", "fake-key-123")
    monkeypatch.setattr(chat_service.gemini, "is_available", lambda: True)

    def fake_stream(*args, **kwargs):
        yield '{\n  "reply": "Quick '
        yield 'rice bowl with '
        yield 'vegetables and soy sauce.",\n  "actions": []\n}'

    monkeypatch.setattr(chat_service.gemini, "generate_chat_stream", fake_stream)

    client = TestClient(app)
    resp = client.post(
        "/chat/stream",
        json={
            "messages": [{"role": "user", "content": "Quick dinner?"}],
            "pantry": ["rice"],
            "dietary_preferences": [],
            "allergies": [],
        },
    )
    assert resp.status_code == 200
    text = resp.text
    lines = [line[6:] for line in text.splitlines() if line.startswith("data: ")]
    events = [json.loads(l) for l in lines]
    tokens = [e["chunk"] for e in events if e.get("type") == "token"]
    assert len(tokens) >= 1
    done_ev = next(e for e in events if e.get("type") == "done")
    assert done_ev["strategy"] == "llm"
    assert "rice bowl" in done_ev["reply"].lower()


def test_wikipedia_image_cached_with_httpx(monkeypatch):
    from app import recipe_gen
    from app.cache import get_cache

    cache = get_cache("wiki_images")
    cache.set("biryani", "https://upload.wikimedia.org/test_biryani.jpg")

    url = recipe_gen._fetch_wikipedia_image("biryani")
    assert url == "https://upload.wikimedia.org/test_biryani.jpg"

