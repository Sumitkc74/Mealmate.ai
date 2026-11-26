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


def test_dairy_allergy_does_not_block_plant_milk_recipe():
    # Thai Green Curry's only "milk" is coconut milk: not dairy.
    recipe = _recipe(
        "chicken breast", "green curry paste", "coconut milk",
        "bamboo shoots", "basil", "fish sauce", "rice",
    )
    assert _violates_allergy(recipe, ["dairy"]) is None
    assert _violates_allergy(recipe, ["milk"]) is None
    # Other plant milks are not dairy either.
    assert _violates_allergy(_recipe("oat milk", "banana"), ["dairy"]) is None
    assert _violates_allergy(_recipe("almond milk", "banana"), ["dairy"]) is None
    # ... but a recipe with plant milk AND real milk is still blocked.
    assert _violates_allergy(_recipe("coconut milk", "milk", "rice"), ["dairy"]) is not None


def test_soy_allergy_still_blocks_soy_milk():
    recipe = _recipe("soy milk", "sugar")
    assert _violates_allergy(recipe, ["soy"]) is not None
    # Soy milk is not dairy, so a dairy allergy must not block it.
    assert _violates_allergy(recipe, ["dairy"]) is None
