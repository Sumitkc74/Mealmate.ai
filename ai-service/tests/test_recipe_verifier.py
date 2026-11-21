"""Unit tests for the recipe verifier safety and culinary guardrails."""

import pytest
from app import recipe_verifier as rv
from app.recipe_verifier import deterministic_verify, estimate_recipe_nutrition, verify_recipe_with_ai
from app.schemas import EstimateNutritionRequest, VerifyRecipeRequest


def test_verify_valid_recipe():
    req = VerifyRecipeRequest(
        title="Classic Margherita Pizza",
        description="Fresh basil, mozzarella, and tomato pizza baked to perfection.",
        cuisine="Italian",
        ingredients=[
            {"name": "pizza dough", "quantity": 1, "unit": "ball"},
            {"name": "crushed tomatoes", "quantity": 200, "unit": "g"},
            {"name": "fresh mozzarella", "quantity": 150, "unit": "g"},
            {"name": "fresh basil leaves", "quantity": 10, "unit": "leaves"},
            {"name": "olive oil", "quantity": 1, "unit": "tbsp"},
        ],
        instructions=[
            "Preheat your oven to 450F (230C).",
            "Roll out the dough into a 12-inch circle on a baking sheet.",
            "Spread the crushed tomatoes evenly and top with mozzarella slices.",
            "Bake for 12-15 minutes until the crust is golden and cheese is bubbly.",
            "Garnish with fresh basil and a drizzle of olive oil before slicing and serving.",
        ],
        prep_time=20,
        cook_time=15,
        servings=4,
    )
    result = deterministic_verify(req)
    assert result.success is True
    assert result.is_valid is True
    assert result.verdict in ("verified", "needs_review")
    assert result.score >= 70
    assert "dairy" in result.detected_allergens


def test_verify_hazardous_ingredient_rejected():
    req = VerifyRecipeRequest(
        title="Spicy Bleach Cocktail",
        description="A dangerous concoction.",
        ingredients=[
            {"name": "bleach", "quantity": 1, "unit": "cup"},
            {"name": "lemon juice", "quantity": 2, "unit": "tbsp"},
        ],
        instructions=[
            "Mix bleach with lemon juice in a glass and serve.",
        ],
    )
    result = deterministic_verify(req)
    assert result.is_valid is False
    assert result.verdict == "rejected"
    assert result.score == 0
    assert any(i.category == "safety" and "Hazardous" in i.message for i in result.issues)


def test_verify_gibberish_rejected():
    req = VerifyRecipeRequest(
        title="qwrtypsdfghjkl",
        description="zxcvbnmasdfghjk",
        ingredients=[
            {"name": "bvcxzlkjhgfdsa", "quantity": 100, "unit": "g"},
        ],
        instructions=[
            "mnbvcxzlkjhgfdsapoiuytrewq.",
        ],
    )
    result = deterministic_verify(req)
    assert result.is_valid is False
    assert result.verdict == "rejected"
    assert any(i.category == "coherence" for i in result.issues)


def test_verify_missing_cooking_action_warning():
    req = VerifyRecipeRequest(
        title="Apple Plate",
        description="Fresh apple slices.",
        ingredients=[
            {"name": "apple", "quantity": 2, "unit": "pieces"},
            {"name": "cinnamon", "quantity": 1, "unit": "pinch"},
        ],
        instructions=[
            "Put them on a plate and look at them nicely.",
        ],
    )
    result = deterministic_verify(req)
    # Shouldn't be rejected as toxic, but should flag warning for instructions
    assert any(i.category == "instructions" for i in result.issues)
    assert len(result.suggestions) > 0


@pytest.mark.asyncio
async def test_verify_title_ingredient_mismatch_flagged_for_review(monkeypatch):
    """A vegan mushroom dish titled 'Chicken Biryani' must be flagged, not verified.

    The AI prompt instructs the model to check title-vs-ingredients coherence;
    a clear contradiction lowers the score so the verdict is needs_review
    (published only with a needs-review tag), not verified.
    """
    captured: dict[str, str] = {}

    def fake_generate_json(prompt: str) -> dict:
        captured["prompt"] = prompt
        return {
            "is_culinary_valid": True,
            "score": 55,
            "feedback_summary": "The title names chicken but the ingredients contain no chicken.",
            "chef_suggestions": ["Rename the dish to match its ingredients."],
            "concerns": [
                {
                    "severity": "warning",
                    "category": "coherence",
                    "message": "Title names chicken but no chicken appears in the ingredients.",
                }
            ],
        }

    monkeypatch.setattr(rv.gemini, "is_available", lambda: True)
    monkeypatch.setattr(rv.gemini, "generate_json", fake_generate_json)

    req = VerifyRecipeRequest(
        title="Chicken Biryani",
        description="A fragrant vegan biryani with mushrooms and chickpeas.",
        cuisine="indian",
        ingredients=[
            {"name": "basmati rice", "quantity": 2, "unit": "cup"},
            {"name": "cremini mushrooms", "quantity": 300, "unit": "g"},
            {"name": "canned chickpeas", "quantity": 240, "unit": "g"},
        ],
        instructions=[
            "Rinse and soak the basmati rice for 30 minutes, then drain.",
            "Saute mushrooms and chickpeas with spices.",
            "Layer the rice over the mushroom mixture and cook on low heat for 25 minutes.",
        ],
        prep_time=30,
        cook_time=70,
        servings=4,
    )
    result = await verify_recipe_with_ai(req)
    assert result.verdict == "needs_review"
    assert result.is_valid is True
    assert any(
        i.category == "coherence" and "chicken" in i.message.lower()
        for i in result.issues
    )
    # The prompt must actually ask the model to check title-vs-ingredients coherence.
    assert "Title vs ingredients" in captured["prompt"]
    assert "Chicken Biryani" in captured["prompt"]


@pytest.mark.asyncio
async def test_estimate_recipe_nutrition():
    req = EstimateNutritionRequest(
        title="Garlic Butter Pasta",
        ingredients=[
            {"name": "pasta", "quantity": 200, "unit": "g"},
            {"name": "butter", "quantity": 2, "unit": "tbsp"},
            {"name": "parmesan", "quantity": 30, "unit": "g"},
            {"name": "garlic", "quantity": 2, "unit": "cloves"},
        ],
        servings=2,
    )
    result = await estimate_recipe_nutrition(req)
    assert result.success is True
    assert result.calories > 200  # realistic calorie estimate
    assert result.protein > 5     # pasta & parmesan provide protein
    assert result.fat > 5         # butter provides fat
    assert result.carbs > 20      # pasta provides carbs
    assert result.servings == 2

