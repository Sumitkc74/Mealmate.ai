"""Every built-in UI allergen preset must expand and match through the
real planner matching path (Fix 2).

Preset ids mirror client/src/components/pantry/allergenPresets.ts
(saved verbatim by AllergiesSection); the representative ingredients
are the ones from the review spec. Synthetic recipes are used where
the bundled corpus has none. This test fails before the fix for the
presets with no hierarchy key ("tree-nuts", "alliums", "peanuts",
"wheat") and passes after.
"""

from __future__ import annotations

import pytest

from app._text import Recipe
from app.planner import _violates_allergy

# (preset id, representative ingredient) — the same 13 pairs as the
# server/client allergen-preset tests.
PRESET_CASES: list[tuple[str, str]] = [
    ("peanuts", "peanut butter"),
    ("tree-nuts", "almonds"),
    ("dairy", "milk"),
    ("eggs", "egg"),
    ("shellfish", "shrimp"),
    ("fish", "salmon"),
    ("wheat", "barley"),
    ("soy", "tofu"),
    ("sesame", "sesame seeds"),
    ("alliums", "garlic"),
    ("mustard", "mustard"),
    ("celery", "celery"),
    ("sulfites", "sodium sulfite"),
]


@pytest.mark.parametrize("preset,ingredient", PRESET_CASES)
def test_allergen_preset_blocks_representative_ingredient(preset: str, ingredient: str) -> None:
    recipe = Recipe(
        f"preset-{preset}",
        f"Preset {preset} test",
        (ingredient, "rice"),
        ("dinner",),
        "test",
    )
    assert _violates_allergy(recipe, [preset]) is True
    # And a recipe without the ingredient passes the same allergy.
    safe = Recipe(
        "preset-safe", "Safe test", ("rice", "tomato"), ("dinner",), "test"
    )
    assert _violates_allergy(safe, [preset]) is False
