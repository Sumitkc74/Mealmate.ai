"""Comprehensive tests for RAG recipe suggester, question-answering, and indexing."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.rag import get_rag, init_rag


SAMPLE_RECIPES = [
    {
        "id": "tomato-pasta",
        "title": "Tomato Basil Pasta",
        "cuisine": "italian",
        "ingredients": ["pasta", "tomato", "garlic", "basil", "olive oil", "parmesan"],
        "tags": ["italian", "vegetarian", "quick", "dinner"],
        "instructions": [
            "Boil pasta in salted water.",
            "Saute garlic and tomato in olive oil.",
            "Toss pasta with basil and parmesan.",
        ],
    },
    {
        "id": "chicken-stir-fry",
        "title": "Chicken Stir Fry",
        "cuisine": "asian",
        "ingredients": ["chicken breast", "soy sauce", "broccoli", "ginger", "garlic", "rice"],
        "tags": ["asian", "high-protein", "dinner"],
        "instructions": [
            "Cook rice.",
            "Stir fry chicken with ginger and garlic.",
            "Add broccoli and soy sauce.",
        ],
    },
    {
        "id": "vegan-lentil-soup",
        "title": "Hearty Lentil Soup",
        "cuisine": "mediterranean",
        "ingredients": ["lentils", "carrot", "celery", "onion", "cumin", "vegetable broth"],
        "tags": ["mediterranean", "vegan", "soup", "dinner"],
        "instructions": [
            "Dice veggies.",
            "Simmer lentils and veggies in broth with cumin.",
        ],
    },
    {
        "id": "peanut-noodles",
        "title": "Spicy Peanut Noodles",
        "cuisine": "asian",
        "ingredients": ["noodles", "peanut butter", "chili oil", "scallions", "peanuts"],
        "tags": ["asian", "vegetarian", "quick"],
        "instructions": [
            "Cook noodles.",
            "Whisk peanut butter with chili oil.",
            "Toss noodles and top with crushed peanuts.",
        ],
    },
]


@pytest.fixture(autouse=True)
def mock_gemini(monkeypatch):
    """Mock Gemini offline by default for instant and deterministic tests."""
    monkeypatch.setattr("app.gemini.is_available", lambda: True)
    monkeypatch.setattr(
        "app.gemini.generate_text",
        lambda user, system=None, temperature=0.4, json_mode=False: (
            "Based on our database recipes, I recommend Tomato Basil Pasta! "
            "It takes only 15 minutes and matches your ingredients."
        ),
    )


def test_capabilities_advertises_rag():
    with TestClient(app) as c:
        r = c.get("/capabilities")
        assert r.status_code == 200
        body = r.json()
        assert "rag" in body["features"]
        assert body["features"]["rag"] is True


def test_rag_suggest_basic():
    with TestClient(app) as c:
        init_rag(SAMPLE_RECIPES)
        r = c.post(
            "/rag/suggest",
            json={
                "pantry": ["tomato", "garlic", "basil"],
                "dietary_preferences": ["vegetarian"],
                "allergies": [],
                "top_k": 3,
            },
        )
        assert r.status_code == 200
        body = r.json()
        assert body["success"] is True
        assert len(body["recipes"]) >= 1
        assert body["recipes"][0]["id"] == "tomato-pasta"
        assert body["method"] in ("rag_gemini", "rag_fallback")
        assert "Pasta" in body["suggestion"] or "pasta" in body["suggestion"]


def test_rag_suggest_allergen_filtering():
    with TestClient(app) as c:
        init_rag(SAMPLE_RECIPES)
        # Request with peanut allergy - peanut-noodles MUST be excluded
        r = c.post(
            "/rag/suggest",
            json={
                "pantry": ["noodles", "chili oil"],
                "dietary_preferences": [],
                "allergies": ["peanut"],
                "top_k": 5,
            },
        )
        assert r.status_code == 200
        body = r.json()
        for recipe in body["recipes"]:
            assert recipe["id"] != "peanut-noodles"
            assert "peanut" not in recipe["title"].lower()
            assert "peanut" not in str(recipe.get("ingredients", [])).lower()


def test_rag_suggest_dietary_preferences_vegetarian():
    with TestClient(app) as c:
        init_rag(SAMPLE_RECIPES)
        # Request with vegetarian preference - chicken-stir-fry MUST NOT be recommended
        r = c.post(
            "/rag/suggest",
            json={
                "pantry": ["rice", "garlic", "ginger"],
                "dietary_preferences": ["vegetarian"],
                "allergies": [],
                "top_k": 5,
            },
        )
        assert r.status_code == 200
        body = r.json()
        assert body["success"] is True
        for recipe in body["recipes"]:
            assert recipe["id"] != "chicken-stir-fry"


def test_rag_query_broad_catalog():
    with TestClient(app) as c:
        init_rag(SAMPLE_RECIPES)
        r = c.post(
            "/rag/query",
            json={"question": "What recipes do you have in the database?", "top_k": 5},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["success"] is True
        assert len(body["recipes"]) >= 1


def test_rag_query_exact_title():
    with TestClient(app) as c:
        init_rag(SAMPLE_RECIPES)
        r = c.post(
            "/rag/query",
            json={"question": "How to make Tomato Basil Pasta?", "top_k": 3},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["success"] is True
        assert len(body["recipes"]) == 1
        assert body["recipes"][0]["id"] == "tomato-pasta"


def test_rag_query_ingredient_with_plural_and_punctuation():
    """Ensure 'What can I cook with tomatoes?' does not get rejected by keyword filters."""
    with TestClient(app) as c:
        init_rag(SAMPLE_RECIPES)
        r = c.post(
            "/rag/query",
            json={"question": "What can I cook with tomatoes?", "top_k": 3},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["success"] is True
        assert body["method"] != "rag_rejected"
        assert len(body["recipes"]) >= 1
        assert any(rec["id"] == "tomato-pasta" for rec in body["recipes"])


def test_rag_query_cuisine():
    """Ensure cuisine queries like 'Do you have Italian dishes?' match Italian recipes."""
    with TestClient(app) as c:
        init_rag(SAMPLE_RECIPES)
        r = c.post(
            "/rag/query",
            json={"question": "Do you have Italian dishes?", "top_k": 3},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["success"] is True
        assert body["method"] != "rag_rejected"
        assert any(rec["id"] == "tomato-pasta" for rec in body["recipes"])


def test_rag_query_substring_words_do_not_trigger_broad():
    """Words containing 'all' such as 'meatballs', 'shallots', 'allergy' must not trigger broad catalog dump."""
    with TestClient(app) as c:
        init_rag(SAMPLE_RECIPES)
        r = c.post(
            "/rag/query",
            json={"question": "How do I make meatballs?", "top_k": 3},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["success"] is True
        # Since meatballs don't exist in SAMPLE_RECIPES, it should be rejected, NOT treated as a broad catalogue query
        assert body["method"] == "rag_rejected"


def test_rag_index_and_reindex():
    with TestClient(app) as c:
        new_recipes = [
            {
                "id": "beef-tacos",
                "title": "Crispy Beef Tacos",
                "cuisine": "mexican",
                "ingredients": ["ground beef", "taco shells", "cheese", "salsa"],
                "tags": ["mexican", "dinner"],
                "instructions": ["Brown beef.", "Fill shells.", "Top with salsa and cheese."],
            }
        ]
        r = c.post("/rag/index", json={"recipes": new_recipes})
        assert r.status_code == 200
        body = r.json()
        assert body["success"] is True
        assert body["indexed"] == 1

        # Now query the new recipe
        qr = c.post("/rag/query", json={"question": "Crispy Beef Tacos"})
        assert qr.status_code == 200
        qbody = qr.json()
        assert qbody["success"] is True
        assert len(qbody["recipes"]) == 1
        assert qbody["recipes"][0]["id"] == "beef-tacos"


def test_rag_fallback_when_gemini_unavailable(monkeypatch):
    """When Gemini is unavailable, deterministic fallback provides the suggestion."""
    monkeypatch.setattr("app.gemini.is_available", lambda: False)

    with TestClient(app) as c:
        init_rag(SAMPLE_RECIPES)
        r = c.post(
            "/rag/suggest",
            json={"pantry": ["tomato", "pasta"], "dietary_preferences": [], "allergies": []},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["success"] is True
        assert body["method"] == "rag_fallback"
        assert "Tomato Basil Pasta" in body["suggestion"]


def test_rag_incremental_reindex():
    with TestClient(app) as c:
        init_rag(SAMPLE_RECIPES)
        rag = get_rag()
        assert rag is not None

        # Reindexing with incremental=True
        count = rag.reindex(SAMPLE_RECIPES, incremental=True)
        assert count == len(SAMPLE_RECIPES)

        # Upserting a new recipe
        new_recipe = {
            "id": "lemon-herb-salmon",
            "title": "Lemon Herb Baked Salmon",
            "cuisine": "mediterranean",
            "ingredients": ["salmon", "lemon", "dill", "olive oil"],
            "tags": ["mediterranean", "healthy", "dinner"],
        }
        upsert_count = rag.upsert_recipes([new_recipe])
        assert upsert_count == 1

        # Second upsert with identical content should skip re-embedding
        upsert_count_dup = rag.upsert_recipes([new_recipe])
        assert upsert_count_dup == 0


