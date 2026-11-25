"""Unit tests for the TF-IDF recommender."""

from __future__ import annotations

from app.recommender import Recipe, RecommenderService


def _make_service() -> RecommenderService:
    s = RecommenderService()
    s.load()
    return s


def test_recommender_loads_and_indexes_recipes():
    s = _make_service()
    assert s.is_loaded
    assert s.recipe_count >= 10


def test_pantry_match_ranks_relevant_recipes_first():
    s = _make_service()
    results = s.recommend(
        ingredients=["spaghetti", "tomato", "garlic", "basil"],
        dietary_preferences=[],
        top_k=3,
    )
    assert len(results) == 3
    # Tomato Basil Pasta is the obvious top result for these pantry items.
    assert results[0].recipe_id == "tomato-pasta"
    assert results[0].score > 0
    assert "tomato" in results[0].matched_ingredients
    assert "spaghetti" in results[0].matched_ingredients


def test_dietary_preference_boosts_matching_tags():
    s = _make_service()
    results = s.recommend(
        ingredients=["onion", "garlic"],
        dietary_preferences=["vegan"],
        top_k=5,
    )
    assert len(results) > 0
    # Top result must have the vegan tag (boost + soft penalty for non-matches).
    top_ids = {r.recipe_id for r in results[:3]}
    vegan_ids = {"lentil-soup", "chickpea-curry", "ratatouille", "miso-soup", "quinoa-bowl"}
    assert top_ids & vegan_ids, f"Expected a vegan recipe in top 3, got {top_ids}"


def test_allergy_filter_excludes_recipes():
    s = _make_service()
    results = s.recommend(
        ingredients=["tomato", "garlic"],
        dietary_preferences=[],
        allergies=["cheese"],
        top_k=20,
    )
    # No returned recipe should contain "cheese" in ingredients.
    for r in results:
        # Re-fetch the recipe and check
        recipe = next(rec for rec in s._recipes if rec.recipe_id == r.recipe_id)
        for ing in recipe.ingredients:
            assert "cheese" not in ing.lower(), f"{r.recipe_id} should be filtered for allergy"


def test_results_are_deterministic():
    s = _make_service()
    a = s.recommend(ingredients=["chicken", "rice", "soy sauce"], dietary_preferences=[], top_k=5)
    b = s.recommend(ingredients=["chicken", "rice", "soy sauce"], dietary_preferences=[], top_k=5)
    assert [(r.recipe_id, r.score) for r in a] == [(r.recipe_id, r.score) for r in b]


def test_empty_query_returns_empty():
    s = _make_service()
    results = s.recommend(ingredients=[], dietary_preferences=[], top_k=5)
    assert results == []


def test_reason_string_includes_matched_pantry():
    s = _make_service()
    results = s.recommend(
        ingredients=["tomato", "spaghetti", "garlic"],
        dietary_preferences=["vegetarian"],
        top_k=1,
    )
    assert results
    reason = results[0].reason
    assert "pantry" in reason.lower()
    assert "vegetarian" in reason.lower()


def test_fit_rejects_empty_dataset():
    s = RecommenderService()
    try:
        s.fit([])
    except ValueError:
        return
    assert False, "Expected ValueError when fitting empty recipe set"


def test_custom_recipes_can_be_fitted():
    s = RecommenderService()
    s.fit(
        [
            Recipe("a", "Apple Pie", ("apple", "sugar", "flour", "butter"), ("dessert",), "american"),
            Recipe("b", "Apple Salad", ("apple", "walnut", "yogurt"), ("snack",), "american"),
        ]
    )
    out = s.recommend(ingredients=["apple", "yogurt"], dietary_preferences=[], top_k=2)
    assert out[0].recipe_id == "b"


def test_dairy_allergy_excludes_fluffy_pancakes():
    s = _make_service()
    query = ["flour", "milk", "egg", "butter", "sugar", "maple syrup"]
    results = s.recommend(
        ingredients=query,
        dietary_preferences=[],
        allergies=["dairy"],
        top_k=20,
    )
    assert "pancakes" not in {r.recipe_id for r in results}
    # Without the allergy the same query does return Fluffy Pancakes,
    # so the exclusion is the allergy filter, not the ranking.
    unfiltered = s.recommend(
        ingredients=query, dietary_preferences=[], top_k=20
    )
    assert "pancakes" in {r.recipe_id for r in unfiltered}


def test_milk_allergy_still_catches_milk():
    s = _make_service()
    results = s.recommend(
        ingredients=["flour", "milk", "egg", "butter", "sugar", "maple syrup"],
        dietary_preferences=[],
        allergies=["milk"],
        top_k=20,
    )
    assert "pancakes" not in {r.recipe_id for r in results}


def test_dairy_allergy_still_returns_non_dairy_recipes():
    s = _make_service()
    results = s.recommend(
        ingredients=["tomato", "garlic", "zucchini", "eggplant"],
        dietary_preferences=[],
        allergies=["dairy"],
        top_k=20,
    )
    assert results
    assert "ratatouille" in {r.recipe_id for r in results}
