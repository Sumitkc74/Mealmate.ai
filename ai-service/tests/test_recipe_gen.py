"""Tests for the LLM recipe generator's allergy enforcement."""

from app.recipe_gen import _violates_allergy
from app.schemas import GeneratedIngredient, GeneratedRecipe


def _recipe(*ingredient_names: str) -> GeneratedRecipe:
    return GeneratedRecipe(
        title="Test Dish",
        ingredients=[GeneratedIngredient(name=n) for n in ingredient_names],
        instructions=["Mix and cook."],
        prep_time=10,
        cook_time=10,
        servings=2,
    )


def test_dairy_allergy_blocks_generated_recipe_with_milk_and_butter():
    recipe = _recipe("flour", "milk", "egg", "butter", "sugar")
    # Group allergy expands to its members: dairy must catch milk/butter.
    bad = _violates_allergy(recipe, ["dairy"])
    assert bad is not None
    assert bad in {"milk", "butter", "dairy"}


def test_member_allergy_still_catches_member_ingredient():
    recipe = _recipe("flour", "milk", "egg", "butter", "sugar")
    assert _violates_allergy(recipe, ["milk"]) is not None
    assert _violates_allergy(recipe, ["butter"]) is not None


def test_safe_recipe_passes_dairy_allergy():
    recipe = _recipe("rice", "tomato", "garlic", "olive oil")
    assert _violates_allergy(recipe, ["dairy"]) is None
    assert _violates_allergy(recipe, ["milk"]) is None


def test_no_allergies_passes_any_recipe():
    recipe = _recipe("flour", "milk", "egg", "butter", "sugar")
    assert _violates_allergy(recipe, []) is None
