"""Unit tests for the recipe verifier safety and culinary guardrails."""

import pytest
from app.recipe_verifier import deterministic_verify, estimate_recipe_nutrition
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

