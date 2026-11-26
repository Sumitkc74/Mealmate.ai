"""Tests for the /plan/week endpoint and the heuristic planner."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app._text import Recipe
from app.main import app
from app.planner import _violates_allergy, generate_heuristic, generate_plan
from app.recommender import RecommenderService


def _service() -> RecommenderService:
    s = RecommenderService()
    s.load()
    return s


def test_heuristic_returns_seven_days_with_three_meals():
    s = _service()
    plan = generate_heuristic(s, pantry=["tomato", "pasta"], prefs=["vegetarian"], allergies=[])
    assert plan.strategy == "heuristic"
    assert len(plan.days) == 7
    expected_days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    assert [d.day for d in plan.days] == expected_days
    for d in plan.days:
        slots = [m.slot for m in d.meals]
        assert slots == ["breakfast", "lunch", "dinner"]


def test_heuristic_respects_allergies():
    s = _service()
    plan = generate_heuristic(
        s,
        pantry=["tomato", "garlic"],
        prefs=[],
        allergies=["peanut", "shrimp"],
    )
    for d in plan.days:
        for m in d.meals:
            recipe = next(r for r in s.recipes if r.recipe_id == m.recipe_id)
            ings = " ".join(recipe.ingredients).lower()
            assert "peanut" not in ings
            assert "shrimp" not in ings


def test_heuristic_caps_repeats():
    s = _service()
    plan = generate_heuristic(
        s, pantry=["tomato"], prefs=[], allergies=[], max_repeats=2
    )
    counts: dict[str, int] = {}
    for d in plan.days:
        for m in d.meals:
            counts[m.recipe_id] = counts.get(m.recipe_id, 0) + 1
    assert all(c <= 2 for c in counts.values()), counts


def test_heuristic_is_deterministic():
    s = _service()
    a = generate_heuristic(s, pantry=["tomato", "garlic"], prefs=["vegetarian"], allergies=[])
    b = generate_heuristic(s, pantry=["tomato", "garlic"], prefs=["vegetarian"], allergies=[])
    a_ids = [(d.day, m.slot, m.recipe_id) for d in a.days for m in d.meals]
    b_ids = [(d.day, m.slot, m.recipe_id) for d in b.days for m in d.meals]
    assert a_ids == b_ids


def test_generate_plan_falls_back_when_llm_unavailable(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    s = _service()
    plan = generate_plan(s, pantry=["rice"], prefs=[], allergies=[], use_llm=True)
    assert plan.strategy == "heuristic"
    assert len(plan.days) == 7


def test_dairy_allergy_blocks_fluffy_pancakes():
    s = _service()
    pancakes = s.get_recipe("pancakes")
    assert pancakes is not None
    assert pancakes.title == "Fluffy Pancakes"
    assert "milk" in pancakes.ingredients and "butter" in pancakes.ingredients
    # Group allergy expands to its members: dairy must catch milk/butter.
    assert _violates_allergy(pancakes, ["dairy"]) is True
    # A saved member allergy still catches the member ingredient.
    assert _violates_allergy(pancakes, ["milk"]) is True
    # A recipe with no dairy ingredient still passes a dairy allergy.
    ratatouille = s.get_recipe("ratatouille")
    assert ratatouille is not None
    assert _violates_allergy(ratatouille, ["dairy"]) is False
    assert _violates_allergy(ratatouille, ["milk"]) is False


def test_dairy_allergy_does_not_block_plant_milk_recipes():
    s = _service()
    # Thai Green Curry / Chickpea Coconut Curry contain only coconut milk.
    thai_curry = s.get_recipe("thai-green-curry")
    assert thai_curry is not None
    assert thai_curry.title == "Thai Green Curry"
    assert "coconut milk" in thai_curry.ingredients
    assert _violates_allergy(thai_curry, ["dairy"]) is False
    assert _violates_allergy(thai_curry, ["milk"]) is False
    chickpea_curry = s.get_recipe("chickpea-curry")
    assert chickpea_curry is not None
    assert _violates_allergy(chickpea_curry, ["dairy"]) is False
    # Other plant milks are not dairy either.
    oat_smoothie = Recipe(
        "oat-smoothie", "Oat Smoothie",
        ("oat milk", "banana", "oats"), ("vegan",), "american",
    )
    assert _violates_allergy(oat_smoothie, ["dairy"]) is False
    almond_smoothie = Recipe(
        "almond-smoothie", "Almond Smoothie",
        ("almond milk", "banana"), ("vegan",), "american",
    )
    assert _violates_allergy(almond_smoothie, ["dairy"]) is False
    # ... but a recipe with plant milk AND real milk is still blocked.
    mixed = Recipe(
        "mixed-curry", "Mixed Curry",
        ("coconut milk", "milk", "rice"), ("dinner",), "thai",
    )
    assert _violates_allergy(mixed, ["dairy"]) is True
    # ... and a saved "soy" allergy still catches "soy milk".
    soy_drink = Recipe(
        "soy-drink", "Soy Drink",
        ("soy milk", "sugar"), ("vegan",), "american",
    )
    assert _violates_allergy(soy_drink, ["soy"]) is True
    assert _violates_allergy(soy_drink, ["dairy"]) is False


def test_heuristic_plan_excludes_dairy_for_dairy_allergy():
    s = _service()
    plan = generate_heuristic(
        s, pantry=["tomato", "garlic"], prefs=[], allergies=["dairy"]
    )
    assert len(plan.days) == 7  # non-dairy recipes still fill the week
    for d in plan.days:
        for m in d.meals:
            assert m.recipe_id != "pancakes"
            recipe = next(r for r in s.recipes if r.recipe_id == m.recipe_id)
            # Plant-milk-aware check: a coconut-milk recipe is dairy-free,
            # so a raw "milk" substring check would falsely fail it.
            assert not _violates_allergy(recipe, ["dairy"]), m.recipe_id


def test_plan_endpoint_returns_full_week():
    client = TestClient(app)
    resp = client.post(
        "/plan/week",
        json={
            "ingredients": ["tomato", "garlic", "basil"],
            "dietary_preferences": ["vegetarian"],
            "allergies": [],
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["strategy"] == "heuristic"
    assert len(body["days"]) == 7
