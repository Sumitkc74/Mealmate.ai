"""Weekly meal-plan generator (multi-objective).

Two strategies:

1. **Heuristic** (default, always available) — uses the trained TF-IDF
   recommender to score recipes against the user's pantry / preferences /
   allergies, then assembles a 7-day plan that:
     - matches each meal slot to recipes tagged for that slot
       (breakfast / lunch / dinner) when possible,
     - prefers recipes that maximise a user-tunable **multi-objective utility**
       (similarity to the user's pantry / preferences, sustainability,
        cost, pantry utilisation, weekly variety),
     - de-duplicates so no recipe repeats more than ``max_repeats`` times,
     - falls back to general recommendations when no slot-tagged options remain.

2. **LLM (Google Gemini)** (opt-in) — when ``GEMINI_API_KEY`` is set, the
   ``generate_with_llm`` function delegates to Gemini with a structured JSON
   prompt, then validates the response back into our schema. If the call fails
   for any reason, we transparently fall back to the heuristic — so the feature
   is always available.

The heuristic is fully deterministic given the same inputs (no RNG); the LLM
strategy is non-deterministic by nature but constrained by the schema.

Multi-objective utility
-----------------------
We score every (recipe, slot) candidate with a weighted sum of normalised
sub-scores in ``[0, 1]``::

    U = w_sim * similarity
      + w_eco * eco_score
      + w_cost * cost_score
      + w_pantry * pantry_utilisation
      + w_variety * variety_score

Each sub-score is min-max normalised across the candidate pool so the
weights themselves are directly interpretable. Presets are exposed via the
``PlannerObjective`` enum (``balanced`` / ``eco`` / ``budget`` / ``pantry``)
and the caller can override individual weights via ``MealPlanRequest.weights``.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from typing import Any, Mapping

from . import gemini
from ._text import Recipe, normalize, normalize_list
from .knowledge_graph import get_knowledge_graph
from .recommender import RecommenderService
from .schemas import (
    MealPlanDay,
    MealPlanResponse,
    MealPlanSlot,
    PlannerObjective,
    SustainabilitySummary,
)
from .sustainability import (
    RecipeFootprint,
    compute_recipe_footprint,
    summarize_week,
)

DAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
SLOTS: tuple[str, ...] = ("breakfast", "lunch", "dinner")


# ---------------------------------------------------------------------------
# Objective presets — directly interpretable weights for the multi-objective
# utility used by ``_score_candidate``. Each preset sums to ~1.0 for
# comparability across runs.
# ---------------------------------------------------------------------------
OBJECTIVE_PRESETS: dict[PlannerObjective, dict[str, float]] = {
    "balanced": {"similarity": 0.40, "eco": 0.20, "cost": 0.15, "pantry": 0.15, "variety": 0.10},
    "eco":      {"similarity": 0.20, "eco": 0.55, "cost": 0.05, "pantry": 0.10, "variety": 0.10},
    "budget":   {"similarity": 0.20, "eco": 0.05, "cost": 0.55, "pantry": 0.10, "variety": 0.10},
    "pantry":   {"similarity": 0.30, "eco": 0.10, "cost": 0.10, "pantry": 0.40, "variety": 0.10},
}


def resolve_weights(
    objective: PlannerObjective,
    override: Mapping[str, float] | None,
) -> dict[str, float]:
    """Merge the preset with any user override and normalise to sum to 1.0."""
    base = dict(OBJECTIVE_PRESETS.get(objective, OBJECTIVE_PRESETS["balanced"]))
    if override:
        for k, v in override.items():
            if k in base and v is not None and v >= 0:
                base[k] = float(v)
    total = sum(base.values())
    if total <= 0:
        return dict(OBJECTIVE_PRESETS["balanced"])
    return {k: round(v / total, 4) for k, v in base.items()}


def _has_tag(recipe: Recipe, slot: str) -> bool:
    slot_norm = slot.lower()
    return any(t.lower() == slot_norm for t in recipe.tags)


# Plant-based milks are NOT dairy milk: a saved "dairy" (or "milk")
# allergy must not block a recipe whose only "milk" is a plant milk
# ("coconut milk", "almond milk", ...). The "milk" term still matches
# real milk, and a saved "soy" allergy still catches "soy milk"
# because the "soy" term itself matches. Keep this list and rule
# identical in planner.py, recommender.py, recipe_gen.py, rag.py,
# server/src/utils/allergens.ts and client/src/lib/allergens.ts.
# Do not change the 11-group allergen hierarchy.
PLANT_MILK_QUALIFIERS: tuple[str, ...] = (
    "almond", "cashew", "coconut", "flax", "hazelnut", "hemp",
    "macadamia", "oat", "pea", "pecan", "pistachio", "rice",
    "soy", "sunflower", "walnut",
)
_PLANT_MILK_RE = re.compile(
    r"\b(?:" + "|".join(PLANT_MILK_QUALIFIERS) + r")[-\s]+milks?\b"
)


def _strip_plant_milks(text: str) -> str:
    """Remove plant-milk phrases from ``text`` so a bare "milk" match only
    sees real (dairy) milk. A recipe with both plant milk and real milk
    still matches, because only the plant-milk phrase is removed."""
    return _PLANT_MILK_RE.sub(" ", text)


def _term_matches_ingredient(term: str, ingredient: str) -> bool:
    """Substring match of an allergen term against one (lowercased)
    ingredient, except a bare "milk" term never matches a plant milk.
    A saved plural term ("sulfites") also matches its singular form
    ("sulfite"), mirroring the client/server whole-word stemmer — but
    only at a word boundary, so "nuts" -> "nut" does not match inside
    "coconut"."""
    if term == "milk":
        return "milk" in _strip_plant_milks(ingredient)
    if term in ingredient:
        return True
    if term.endswith("s") and len(term) > 3:
        singular = term[:-1]
        return re.search(r"\b" + re.escape(singular) + r"\b", ingredient) is not None
    return False


def _violates_allergy(recipe: Recipe, allergies: list[str]) -> bool:
    if not allergies:
        return False
    # Expand group terms (e.g. "dairy") to their concrete members
    # (milk, butter, cheese, yogurt, cream, ...) before matching, so a
    # saved group allergy blocks recipes containing a member ingredient.
    # expand_allergens() also keeps the original term, so a saved "milk"
    # still catches milk. Used by both the heuristic pool filter and the
    # LLM-path validation below.
    expanded = get_knowledge_graph().expand_allergens(allergies)
    norm = [a for a in (a.lower().strip() for a in expanded) if a]
    for ing in recipe.ingredients:
        ing_l = ing.lower()
        if any(_term_matches_ingredient(a, ing_l) for a in norm):
            return True
    return False


def _pantry_utilisation(recipe: Recipe, pantry_norm: set[str]) -> float:
    if not pantry_norm or not recipe.ingredients:
        return 0.0
    ings = {normalize(i) for i in recipe.ingredients}
    overlap = len(pantry_norm & ings)
    return overlap / max(1, len(ings))


def _build_pool_with_scores(
    rec: RecommenderService,
    pantry: list[str],
    prefs: list[str],
    allergies: list[str],
) -> tuple[list[Recipe], dict[str, float]]:
    """Rank the entire corpus by relevance to the user; drop allergens."""
    similarity: dict[str, float] = {}
    if pantry or prefs:
        ranked = rec.recommend(
            ingredients=pantry or ["water"],
            dietary_preferences=prefs,
            top_k=rec.recipe_count,
            allergies=allergies,
            strategy="hybrid",
        )
        for hit in ranked:
            similarity[hit.recipe_id] = float(hit.score)

    pool: list[Recipe] = []
    seen: set[str] = set()
    for r in rec.recipes:
        if _violates_allergy(r, allergies):
            continue
        if r.recipe_id in seen:
            continue
        pool.append(r)
        seen.add(r.recipe_id)
        similarity.setdefault(r.recipe_id, 0.0)
    return pool, similarity


def _normalise_dict(values: dict[str, float], *, invert: bool = False) -> dict[str, float]:
    """Min-max normalise into [0,1]. If ``invert``, smaller raw values get higher score."""
    if not values:
        return {}
    vs = list(values.values())
    lo, hi = min(vs), max(vs)
    if hi - lo < 1e-9:
        return {k: 0.5 for k in values}
    out: dict[str, float] = {}
    for k, v in values.items():
        n = (v - lo) / (hi - lo)
        out[k] = 1.0 - n if invert else n
    return out


def generate_heuristic(
    rec: RecommenderService,
    pantry: list[str],
    prefs: list[str],
    allergies: list[str],
    *,
    objective: PlannerObjective = "balanced",
    weights_override: Mapping[str, float] | None = None,
    max_repeats: int = 2,
) -> MealPlanResponse:
    """Build a 7-day × 3-meal plan via multi-objective utility maximisation."""
    pool, similarity = _build_pool_with_scores(rec, pantry, prefs, allergies)
    if not pool:
        weights = resolve_weights(objective, weights_override)
        return MealPlanResponse(
            strategy="heuristic",
            objective=objective,
            weights=weights,
            days=[],
            sustainability=SustainabilitySummary(co2_kg=0.0, cost_usd=0.0, eco_score=0.0, meals=0),
        )

    weights = resolve_weights(objective, weights_override)
    pantry_norm = {normalize(p) for p in pantry}

    # Precompute sustainability + pantry signals for every candidate.
    footprints: dict[str, RecipeFootprint] = {
        r.recipe_id: compute_recipe_footprint(r) for r in pool
    }
    cost_raw = {rid: f.cost_usd for rid, f in footprints.items()}
    co2_raw = {rid: f.co2_kg for rid, f in footprints.items()}
    pantry_raw = {r.recipe_id: _pantry_utilisation(r, pantry_norm) for r in pool}

    # Lower is better for CO2 and cost, so invert before adding.
    eco_norm = _normalise_dict(co2_raw, invert=True)
    cost_norm = _normalise_dict(cost_raw, invert=True)
    sim_norm = _normalise_dict(similarity)
    pantry_norm_score = _normalise_dict(pantry_raw)

    used: Counter[str] = Counter()
    chosen_footprints: list[RecipeFootprint] = []

    def utility(r: Recipe) -> float:
        variety = 1.0 - min(used[r.recipe_id], max_repeats) / max(1, max_repeats)
        return (
            weights["similarity"] * sim_norm.get(r.recipe_id, 0.0)
            + weights["eco"] * eco_norm.get(r.recipe_id, 0.0)
            + weights["cost"] * cost_norm.get(r.recipe_id, 0.0)
            + weights["pantry"] * pantry_norm_score.get(r.recipe_id, 0.0)
            + weights["variety"] * variety
        )

    def pick(slot: str) -> Recipe | None:
        candidates: list[Recipe] = []
        for require_tag in (True, False):
            for r in pool:
                if used[r.recipe_id] >= max_repeats:
                    continue
                if require_tag and not _has_tag(r, slot):
                    continue
                candidates.append(r)
            if candidates:
                break
        if not candidates:
            candidates = pool
        candidates.sort(key=lambda x: (-utility(x), used[x.recipe_id], x.recipe_id))
        choice = candidates[0]
        used[choice.recipe_id] += 1
        return choice

    days: list[MealPlanDay] = []
    for day in DAYS:
        slots: list[MealPlanSlot] = []
        day_co2 = 0.0
        day_cost = 0.0
        for slot in SLOTS:
            r = pick(slot)
            if r is None:
                continue
            fp = footprints[r.recipe_id]
            chosen_footprints.append(fp)
            day_co2 += fp.co2_kg
            day_cost += fp.cost_usd
            slots.append(
                MealPlanSlot(
                    slot=slot,
                    recipe_id=r.recipe_id,
                    title=r.title,
                    tags=list(r.tags),
                    co2_kg=round(fp.co2_kg, 3),
                    cost_usd=round(fp.cost_usd, 2),
                    eco_score=round(fp.eco_score, 3),
                )
            )
        days.append(
            MealPlanDay(
                day=day,
                meals=slots,
                co2_kg=round(day_co2, 3),
                cost_usd=round(day_cost, 2),
            )
        )
    summary_dict = summarize_week(chosen_footprints)
    summary = SustainabilitySummary(
        co2_kg=summary_dict["co2_kg"],
        cost_usd=summary_dict["cost_usd"],
        eco_score=summary_dict["eco_score"],
        meals=int(summary_dict["meals"]),
    )
    return MealPlanResponse(
        strategy="heuristic",
        objective=objective,
        weights=weights,
        days=days,
        sustainability=summary,
    )


# ---------------------------------------------------------------------------
# Gemini LLM strategy
# ---------------------------------------------------------------------------


def generate_with_llm(
    rec: RecommenderService,
    pantry: list[str],
    prefs: list[str],
    allergies: list[str],
    *,
    objective: PlannerObjective = "balanced",
    weights_override: Mapping[str, float] | None = None,
) -> MealPlanResponse | None:
    """Generate a weekly plan via Gemini.

    Returns ``None`` when the API key is missing, the SDK is not installed,
    the call fails, or the response is too sparse — callers should then fall
    back to the heuristic strategy. Sustainability metrics are computed
    post-hoc from the model's recipe choices.
    """
    if not gemini.is_available():
        return None

    weights = resolve_weights(objective, weights_override)

    catalogue = [
        {"recipe_id": r.recipe_id, "title": r.title, "tags": list(r.tags)}
        for r in rec.recipes
    ]

    system = (
        "You are MealMate's meal-planning assistant. Build a balanced 7-day "
        "meal plan (Monday–Sunday) with breakfast, lunch and dinner each day. "
        "Choose ONLY recipe_ids from the provided catalogue. Honour the user's "
        "dietary preferences and avoid any recipes that contain their allergens. "
        "Vary cuisines across the week and avoid repeating any recipe more than "
        "twice. The user's objective preset is '" + str(objective) + "': prefer "
        "low-emission recipes when 'eco', cheap recipes when 'budget', and "
        "recipes that use the user's pantry items when 'pantry'. "
        "Respond with strict JSON: "
        '{"days": [{"day": "monday", "meals": [{"slot": "breakfast", "recipe_id": "<id>"}, ...]}, ...]}'
    )
    user = json.dumps(
        {
            "pantry": pantry,
            "dietary_preferences": prefs,
            "allergies": allergies,
            "objective": objective,
            "weights": weights,
            "catalogue": catalogue,
        }
    )

    text = gemini.generate_text(system=system, user=user, temperature=0.4, json_mode=True)
    if not text:
        return None
    data: Any = gemini.parse_json(text)
    if not isinstance(data, dict):
        return None

    by_id = {r.recipe_id: r for r in rec.recipes}
    days: list[MealPlanDay] = []
    chosen_footprints: list[RecipeFootprint] = []
    for d in data.get("days", []):
        slots: list[MealPlanSlot] = []
        day_co2 = 0.0
        day_cost = 0.0
        for m in d.get("meals", []) or []:
            rid = str(m.get("recipe_id", ""))
            recipe = by_id.get(rid)
            if not recipe or _violates_allergy(recipe, allergies):
                continue
            fp = compute_recipe_footprint(recipe)
            chosen_footprints.append(fp)
            day_co2 += fp.co2_kg
            day_cost += fp.cost_usd
            slots.append(
                MealPlanSlot(
                    slot=str(m.get("slot", "")),
                    recipe_id=recipe.recipe_id,
                    title=recipe.title,
                    tags=list(recipe.tags),
                    co2_kg=round(fp.co2_kg, 3),
                    cost_usd=round(fp.cost_usd, 2),
                    eco_score=round(fp.eco_score, 3),
                )
            )
        if slots:
            days.append(
                MealPlanDay(
                    day=str(d.get("day", "")),
                    meals=slots,
                    co2_kg=round(day_co2, 3),
                    cost_usd=round(day_cost, 2),
                )
            )

    if len(days) < 5:
        return None
    summary_dict = summarize_week(chosen_footprints)
    return MealPlanResponse(
        strategy="llm",
        objective=objective,
        weights=weights,
        days=days,
        sustainability=SustainabilitySummary(
            co2_kg=summary_dict["co2_kg"],
            cost_usd=summary_dict["cost_usd"],
            eco_score=summary_dict["eco_score"],
            meals=int(summary_dict["meals"]),
        ),
    )


def generate_plan(
    rec: RecommenderService,
    pantry: list[str],
    prefs: list[str],
    allergies: list[str],
    use_llm: bool = False,
    *,
    objective: PlannerObjective = "balanced",
    weights_override: Mapping[str, float] | None = None,
) -> MealPlanResponse:
    """Public entry point used by the FastAPI route."""
    if use_llm:
        plan = generate_with_llm(
            rec, pantry, prefs, allergies,
            objective=objective,
            weights_override=weights_override,
        )
        if plan is not None:
            return plan
    return generate_heuristic(
        rec, pantry, prefs, allergies,
        objective=objective,
        weights_override=weights_override,
    )
