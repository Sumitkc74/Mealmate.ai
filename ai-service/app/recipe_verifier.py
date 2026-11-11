"""Culinary verification and safety guardrails for user-submitted recipes.

Provides deterministic validation against:
1. Hazardous, toxic, inedible substances and chemicals
2. Non-culinary gibberish or spam
3. Missing or absurd cooking instructions
4. Allergen detection and constructive chef suggestions

Integrates with Gemini LLM for deeper culinary plausibility analysis when available,
falling back gracefully to deterministic heuristics.
"""

from __future__ import annotations

import re
from typing import Any

from . import gemini
from .logging_config import logger
from .schemas import (
    EstimateNutritionRequest,
    EstimateNutritionResponse,
    RecipeVerificationIssue,
    VerifyRecipeRequest,
    VerifyRecipeResponse,
)

# ---------------------------------------------------------------------------
# Hazardous & Inedible Substances (Hard Rejection)
# ---------------------------------------------------------------------------
HAZARDOUS_SUBSTANCES: set[str] = {
    # Household & cleaning chemicals
    "bleach",
    "clorox",
    "detergent",
    "dish soap",
    "dishwashing liquid",
    "laundry pod",
    "tide pod",
    "ammonia",
    "drain cleaner",
    "drano",
    "lysol",
    "hand sanitizer",
    "shampoo",
    "conditioner",
    "isopropyl alcohol",
    "rubbing alcohol",
    "acetone",
    "paint thinner",
    "turpentine",
    "kerosene",
    "gasoline",
    "petrol",
    "diesel",
    "motor oil",
    "wd-40",
    "antifreeze",
    "brake fluid",
    # Poisons & lab toxins
    "arsenic",
    "cyanide",
    "potassium cyanide",
    "sodium cyanide",
    "strychnine",
    "hemlock",
    "belladonna",
    "rat poison",
    "rodenticide",
    "pesticide",
    "insecticide",
    "herbicide",
    "roundup",
    "asbestos",
    "mercury",
    "cadmium",
    "lead paint",
    # Hardware & non-food solids
    "broken glass",
    "glass shards",
    "lithium battery",
    "car battery",
    "battery acid",
    "hydrochloric acid",
    "sulfuric acid",
    "nitric acid",
    "caustic soda",
    "metal shavings",
    "screws",
    "nails",
    "plastic wrap melt",
    "styrofoam",
    "cement",
    "concrete",
    "fertilizer",
    "human feces",
    "feces",
    "urine",
}

# ---------------------------------------------------------------------------
# Core Cooking Actions
# ---------------------------------------------------------------------------
COOKING_ACTIONS: set[str] = {
    "bake",
    "baking",
    "boil",
    "boiling",
    "fry",
    "frying",
    "saute",
    "sauté",
    "roast",
    "roasting",
    "simmer",
    "simmering",
    "steam",
    "steaming",
    "grill",
    "grilling",
    "broil",
    "broiling",
    "cook",
    "cooking",
    "stir",
    "stirring",
    "mix",
    "mixing",
    "whisk",
    "whisking",
    "chop",
    "chopping",
    "dice",
    "dicing",
    "mince",
    "mincing",
    "slice",
    "slicing",
    "peel",
    "peeling",
    "knead",
    "kneading",
    "fold",
    "folding",
    "pour",
    "pouring",
    "season",
    "seasoning",
    "marinate",
    "marinating",
    "heat",
    "heating",
    "preheat",
    "preheating",
    "blend",
    "blending",
    "chill",
    "chilling",
    "freeze",
    "freezing",
    "rest",
    "resting",
    "serve",
    "serving",
    "garnish",
    "garnishing",
    "assemble",
    "assemblying",
    "melt",
    "melting",
    "combine",
    "combining",
    "toast",
    "toasting",
    "toss",
    "tossing",
    "drain",
    "draining",
    "rinse",
    "rinsing",
}

# ---------------------------------------------------------------------------
# Common Allergen Mapping
# ---------------------------------------------------------------------------
ALLERGEN_MAP: dict[str, list[str]] = {
    "dairy": ["milk", "butter", "cheese", "cream", "yogurt", "sour cream", "ghee", "parmesan", "cheddar", "mozzarella"],
    "egg": ["egg", "eggs", "egg yolk", "egg white", "mayonnaise"],
    "peanut": ["peanut", "peanuts", "peanut butter", "groundnut"],
    "tree nut": ["almond", "walnut", "cashew", "pecan", "pistachio", "hazelnut", "macadamia", "pine nut"],
    "gluten": ["flour", "wheat", "pasta", "spaghetti", "bread", "noodle", "barley", "couscous", "semolina"],
    "soy": ["soy", "tofu", "edamame", "tempeh", "miso", "tamari", "soy sauce"],
    "fish": ["salmon", "tuna", "cod", "tilapia", "trout", "anchovy", "sardine", "halibut", "snapper"],
    "shellfish": ["shrimp", "prawn", "crab", "lobster", "clam", "mussel", "oyster", "scallop", "squid", "octopus"],
    "sesame": ["sesame", "tahini", "sesame oil"],
}


def _check_gibberish(text: str) -> bool:
    """Detect repetitive keyboard smash or unpronounceable text."""
    clean = text.strip().lower()
    if not clean or len(clean) < 3:
        return False

    # Repeated characters (e.g. "aaaaaaa", "asdfasdfasdf")
    if re.search(r"(.)\1{4,}", clean):
        return True

    words = re.findall(r"[a-z]+", clean)
    if not words:
        return True

    for word in words:
        # 5+ consecutive consonants (e.g. "asdfghjk", "zxcvbnm")
        if re.search(r"[bcdfghjklmnpqrstvwxz]{5,}", word):
            return True

        if len(word) >= 6:
            vowels = sum(1 for c in word if c in "aeiouy")
            # Word with zero or almost no vowels is gibberish like 'zxcvbnm' or 'qwrtpsdfg'
            if vowels == 0:
                return True
            if len(word) >= 8 and (vowels / len(word)) < 0.22:
                return True

    return False


def _detect_allergens(ingredients: list[dict[str, Any]]) -> list[str]:
    found_allergens: set[str] = set()
    for ing in ingredients:
        name = str(ing.get("name", "")).lower()
        for allergen, keywords in ALLERGEN_MAP.items():
            if any(re.search(rf"\b{re.escape(kw)}s?\b", name) for kw in keywords):
                found_allergens.add(allergen)
    return sorted(found_allergens)


def deterministic_verify(req: VerifyRecipeRequest) -> VerifyRecipeResponse:
    """Fast, local safety & quality verification pass."""
    issues: list[RecipeVerificationIssue] = []
    suggestions: list[str] = []
    score = 100

    title_clean = req.title.strip()
    if not title_clean:
        issues.append(
            RecipeVerificationIssue(
                severity="error",
                category="completeness",
                message="Recipe title cannot be empty.",
                field="title",
            )
        )
        score -= 50

    if _check_gibberish(title_clean):
        issues.append(
            RecipeVerificationIssue(
                severity="error",
                category="coherence",
                message=f"Recipe title '{title_clean}' looks like gibberish or spam.",
                field="title",
            )
        )
        score -= 60

    # Check ingredients
    if not req.ingredients:
        issues.append(
            RecipeVerificationIssue(
                severity="error",
                category="completeness",
                message="Recipe must have at least one ingredient.",
                field="ingredients",
            )
        )
        score -= 40
    else:
        for idx, ing in enumerate(req.ingredients):
            name = str(ing.get("name", "")).strip().lower()
            if not name:
                continue

            # Check hazardous substances
            for hazardous in HAZARDOUS_SUBSTANCES:
                if re.search(rf"\b{re.escape(hazardous)}\b", name):
                    issues.append(
                        RecipeVerificationIssue(
                            severity="error",
                            category="safety",
                            message=f"Hazardous/toxic ingredient detected: '{hazardous}'. This violates food safety policies.",
                            field=f"ingredients[{idx}].name",
                        )
                    )
                    score = 0

            # Check gibberish in ingredient name
            if _check_gibberish(name):
                issues.append(
                    RecipeVerificationIssue(
                        severity="error",
                        category="coherence",
                        message=f"Ingredient '{name}' appears to be gibberish.",
                        field=f"ingredients[{idx}].name",
                    )
                )
                score -= 30

    # Check instructions
    if not req.instructions:
        issues.append(
            RecipeVerificationIssue(
                severity="error",
                category="completeness",
                message="Recipe must provide at least one cooking step.",
                field="instructions",
            )
        )
        score -= 40
    else:
        combined_instructions = " ".join(req.instructions).lower()
        # Look for cooking action
        has_cooking_verb = any(
            re.search(rf"\b{re.escape(action)}\b", combined_instructions)
            for action in COOKING_ACTIONS
        )
        if not has_cooking_verb and len(req.instructions) > 0:
            issues.append(
                RecipeVerificationIssue(
                    severity="warning",
                    category="instructions",
                    message="Cooking steps don't appear to contain typical culinary preparation actions (e.g. chop, boil, bake, mix).",
                    field="instructions",
                )
            )
            score -= 15

        for idx, step in enumerate(req.instructions):
            if _check_gibberish(step):
                issues.append(
                    RecipeVerificationIssue(
                        severity="error",
                        category="coherence",
                        message=f"Instruction step {idx + 1} contains gibberish or nonsensical text.",
                        field=f"instructions[{idx}]",
                    )
                )
                score -= 30

    detected_allergens = _detect_allergens(req.ingredients)
    if detected_allergens:
        suggestions.append(f"Contains common allergens: {', '.join(detected_allergens)}. Clear labeling helps diners with sensitivities.")

    if len(req.ingredients) < 3 and len(req.ingredients) > 0:
        suggestions.append("Consider adding seasoning or herbs (e.g., salt, pepper, olive oil) to enhance depth of flavor.")

    score = max(0, min(100, score))
    has_errors = any(i.severity == "error" for i in issues)
    is_valid = not has_errors and score >= 40

    if has_errors:
        verdict = "rejected"
        summary = "Recipe rejected due to safety violations, nonsensical input, or missing essential components."
    elif score < 70:
        verdict = "needs_review"
        summary = "Recipe looks plausible but has areas that could be improved before sharing."
    else:
        verdict = "verified"
        summary = "Recipe looks safe, culinary-sound, and ready to share!"

    return VerifyRecipeResponse(
        success=True,
        is_valid=is_valid,
        score=score,
        verdict=verdict,
        summary=summary,
        issues=issues,
        detected_allergens=detected_allergens,
        suggestions=suggestions,
    )


async def verify_recipe_with_ai(req: VerifyRecipeRequest) -> VerifyRecipeResponse:
    """Verify recipe with fast deterministic guardrails, then augment with Gemini if available."""
    # Run deterministic checks first
    base_eval = deterministic_verify(req)

    # If critical safety error occurred or recipe was rejected, return immediately
    if not base_eval.is_valid:
        return base_eval

    if not gemini.is_available():
        return base_eval

    # Augment with Gemini LLM analysis
    prompt = f"""You are an expert chef and food safety inspector. Evaluate the following recipe for culinary realism, edible ingredient harmony, and food safety:

Title: {req.title}
Cuisine: {req.cuisine or 'Unspecified'}
Ingredients: {', '.join(str(i.get('name', '')) for i in req.ingredients)}
Instructions: {' | '.join(req.instructions)}
Prep Time: {req.prep_time} mins, Cook Time: {req.cook_time} mins

Respond in JSON matching this schema:
{{
  "is_culinary_valid": true/false,
  "score": integer between 0 and 100,
  "feedback_summary": "1-2 sentence overview",
  "chef_suggestions": ["tip 1", "tip 2"],
  "concerns": [
    {{
      "severity": "warning" or "error",
      "category": "safety" | "edibility" | "coherence" | "instructions" | "completeness",
      "message": "Specific explanation"
    }}
  ]
}}
"""
    try:
        data = gemini.generate_json(prompt)
        if isinstance(data, dict):
            llm_valid = bool(data.get("is_culinary_valid", True))
            llm_score = int(data.get("score", base_eval.score))
            llm_summary = str(data.get("feedback_summary") or base_eval.summary)
            llm_suggestions = list(data.get("chef_suggestions") or [])
            llm_concerns = data.get("concerns", [])

            combined_issues = list(base_eval.issues)
            for c in llm_concerns:
                if isinstance(c, dict) and "message" in c:
                    combined_issues.append(
                        RecipeVerificationIssue(
                            severity=c.get("severity", "warning"),
                            category=c.get("category", "coherence"),
                            message=str(c.get("message")),
                        )
                    )

            final_score = int((base_eval.score * 0.4) + (llm_score * 0.6))
            final_has_errors = any(i.severity == "error" for i in combined_issues) or not llm_valid
            final_valid = not final_has_errors and final_score >= 40

            verdict = "rejected" if not final_valid else ("needs_review" if final_score < 75 else "verified")

            all_suggestions = list(base_eval.suggestions)
            for s in llm_suggestions:
                if s not in all_suggestions:
                    all_suggestions.append(str(s))

            return VerifyRecipeResponse(
                success=True,
                is_valid=final_valid,
                score=final_score,
                verdict=verdict,
                summary=llm_summary,
                issues=combined_issues,
                detected_allergens=base_eval.detected_allergens,
                suggestions=all_suggestions,
            )
    except Exception as e:
        logger.warning("gemini_recipe_verification_failed", error=str(e))

    return base_eval


# ---------------------------------------------------------------------------
# Nutritional Calculation & Macro Estimation
# ---------------------------------------------------------------------------

INGREDIENT_MACROS: dict[str, dict[str, float]] = {
    "pasta": {"calories": 355, "protein": 13, "carbs": 71, "fat": 1.5, "fiber": 3.2, "sodium": 6},
    "spaghetti": {"calories": 355, "protein": 13, "carbs": 71, "fat": 1.5, "fiber": 3.2, "sodium": 6},
    "noodle": {"calories": 350, "protein": 12, "carbs": 70, "fat": 2.0, "fiber": 2.5, "sodium": 15},
    "rice": {"calories": 130, "protein": 2.7, "carbs": 28, "fat": 0.3, "fiber": 0.4, "sodium": 1},
    "flour": {"calories": 364, "protein": 10, "carbs": 76, "fat": 1.0, "fiber": 2.7, "sodium": 2},
    "bread": {"calories": 265, "protein": 9, "carbs": 49, "fat": 3.2, "fiber": 2.7, "sodium": 490},
    "chicken": {"calories": 165, "protein": 31, "carbs": 0, "fat": 3.6, "fiber": 0, "sodium": 74},
    "chicken breast": {"calories": 165, "protein": 31, "carbs": 0, "fat": 3.6, "fiber": 0, "sodium": 74},
    "beef": {"calories": 250, "protein": 26, "carbs": 0, "fat": 15.0, "fiber": 0, "sodium": 72},
    "ground beef": {"calories": 254, "protein": 24, "carbs": 0, "fat": 17.0, "fiber": 0, "sodium": 75},
    "salmon": {"calories": 208, "protein": 20, "carbs": 0, "fat": 13.0, "fiber": 0, "sodium": 59},
    "shrimp": {"calories": 99, "protein": 24, "carbs": 0.2, "fat": 0.3, "fiber": 0, "sodium": 111},
    "egg": {"calories": 143, "protein": 13, "carbs": 0.7, "fat": 9.5, "fiber": 0, "sodium": 142},
    "eggs": {"calories": 143, "protein": 13, "carbs": 0.7, "fat": 9.5, "fiber": 0, "sodium": 142},
    "tofu": {"calories": 76, "protein": 8, "carbs": 1.9, "fat": 4.8, "fiber": 0.3, "sodium": 7},
    "olive oil": {"calories": 884, "protein": 0, "carbs": 0, "fat": 100.0, "fiber": 0, "sodium": 2},
    "butter": {"calories": 717, "protein": 0.9, "carbs": 0.1, "fat": 81.0, "fiber": 0, "sodium": 11},
    "oil": {"calories": 884, "protein": 0, "carbs": 0, "fat": 100.0, "fiber": 0, "sodium": 0},
    "cheese": {"calories": 393, "protein": 25, "carbs": 3.2, "fat": 32.0, "fiber": 0, "sodium": 650},
    "parmesan": {"calories": 431, "protein": 38, "carbs": 4.1, "fat": 29.0, "fiber": 0, "sodium": 1529},
    "mozzarella": {"calories": 280, "protein": 22, "carbs": 2.2, "fat": 22.0, "fiber": 0, "sodium": 627},
    "milk": {"calories": 61, "protein": 3.2, "carbs": 4.8, "fat": 3.3, "fiber": 0, "sodium": 43},
    "cream": {"calories": 340, "protein": 2.8, "carbs": 2.7, "fat": 36.0, "fiber": 0, "sodium": 38},
    "garlic": {"calories": 149, "protein": 6.4, "carbs": 33, "fat": 0.5, "fiber": 2.1, "sodium": 17},
    "onion": {"calories": 40, "protein": 1.1, "carbs": 9.3, "fat": 0.1, "fiber": 1.7, "sodium": 4},
    "tomato": {"calories": 18, "protein": 0.9, "carbs": 3.9, "fat": 0.2, "fiber": 1.2, "sodium": 5},
    "tomatoes": {"calories": 18, "protein": 0.9, "carbs": 3.9, "fat": 0.2, "fiber": 1.2, "sodium": 5},
    "potato": {"calories": 77, "protein": 2.0, "carbs": 17, "fat": 0.1, "fiber": 2.2, "sodium": 6},
    "spinach": {"calories": 23, "protein": 2.9, "carbs": 3.6, "fat": 0.4, "fiber": 2.2, "sodium": 79},
    "carrot": {"calories": 41, "protein": 0.9, "carbs": 9.6, "fat": 0.2, "fiber": 2.8, "sodium": 69},
    "sugar": {"calories": 387, "protein": 0, "carbs": 100, "fat": 0, "fiber": 0, "sodium": 1},
    "honey": {"calories": 304, "protein": 0.3, "carbs": 82, "fat": 0, "fiber": 0.2, "sodium": 4},
    "beans": {"calories": 127, "protein": 8.7, "carbs": 23, "fat": 0.5, "fiber": 6.4, "sodium": 2},
    "chickpeas": {"calories": 164, "protein": 8.9, "carbs": 27, "fat": 2.6, "fiber": 7.6, "sodium": 24},
    "lentils": {"calories": 116, "protein": 9.0, "carbs": 20, "fat": 0.4, "fiber": 7.9, "sodium": 2},
}


def _get_quantity_multiplier(quantity: float, unit: str, ing_name: str) -> float:
    """Estimate standard 100g multiplier based on quantity and unit."""
    u = (unit or "").lower().strip()
    qty = max(0.01, float(quantity)) if quantity else 1.0

    if u in ("g", "gram", "grams"):
        return qty / 100.0
    if u in ("kg", "kilogram", "kilograms"):
        return (qty * 1000.0) / 100.0
    if u in ("oz", "ounce", "ounces"):
        return (qty * 28.35) / 100.0
    if u in ("lb", "lbs", "pound", "pounds"):
        return (qty * 453.6) / 100.0
    if u in ("tbsp", "tablespoon", "tablespoons"):
        return (qty * 14.0) / 100.0
    if u in ("tsp", "teaspoon", "teaspoons"):
        return (qty * 5.0) / 100.0
    if u in ("cup", "cups"):
        return (qty * 200.0) / 100.0
    if u in ("clove", "cloves"):
        return (qty * 4.0) / 100.0

    # Piece / units / items
    if "egg" in ing_name:
        return (qty * 50.0) / 100.0
    if "garlic" in ing_name:
        return (qty * 4.0) / 100.0
    if "onion" in ing_name or "tomato" in ing_name or "potato" in ing_name:
        return (qty * 150.0) / 100.0

    return (qty * 100.0) / 100.0


async def estimate_recipe_nutrition(req: EstimateNutritionRequest) -> EstimateNutritionResponse:
    """Calculate macro-nutrients and calories per serving for given ingredients."""
    servings = max(1, req.servings)

    # If Gemini is available, request precise LLM calculation
    if gemini.is_available() and len(req.ingredients) > 0:
        ings_str = ", ".join(
            f"{i.get('quantity', '')} {i.get('unit', '')} {i.get('name', '')}".strip()
            for i in req.ingredients
        )
        prompt = f"""Estimate the total macro nutritional values per single serving for this recipe.
Recipe Title: {req.title or 'Custom Recipe'}
Servings: {servings}
Ingredients: {ings_str}

Respond in strict JSON with numbers only (per 1 serving):
{{
  "calories": number,
  "protein": number,
  "carbs": number,
  "fat": number,
  "fiber": number,
  "sodium": number
}}
"""
        try:
            data = gemini.generate_json(prompt)
            if isinstance(data, dict) and "calories" in data:
                return EstimateNutritionResponse(
                    success=True,
                    calories=round(float(data.get("calories", 0)), 1),
                    protein=round(float(data.get("protein", 0)), 1),
                    carbs=round(float(data.get("carbs", 0)), 1),
                    fat=round(float(data.get("fat", 0)), 1),
                    fiber=round(float(data.get("fiber", 0)), 1) if "fiber" in data else None,
                    sodium=round(float(data.get("sodium", 0)), 1) if "sodium" in data else None,
                    servings=servings,
                )
        except Exception as e:
            logger.warning("gemini_nutrition_estimation_failed", error=str(e))

    # Fast deterministic calculation fallback
    total_cal = 0.0
    total_pro = 0.0
    total_carb = 0.0
    total_fat = 0.0
    total_fib = 0.0
    total_sod = 0.0

    for ing in req.ingredients:
        name = str(ing.get("name", "")).lower().strip()
        if not name:
            continue
        qty = float(ing.get("quantity") or 1.0)
        unit = str(ing.get("unit") or "").lower().strip()

        mult = _get_quantity_multiplier(qty, unit, name)

        # Match against macro dictionary
        matched_macro = None
        for key, vals in INGREDIENT_MACROS.items():
            if re.search(rf"\b{re.escape(key)}s?\b", name):
                matched_macro = vals
                break

        if not matched_macro:
            # Default approximation for vegetables/condiments
            matched_macro = {"calories": 50, "protein": 1.5, "carbs": 8, "fat": 0.5, "fiber": 1.5, "sodium": 20}

        total_cal += matched_macro.get("calories", 0) * mult
        total_pro += matched_macro.get("protein", 0) * mult
        total_carb += matched_macro.get("carbs", 0) * mult
        total_fat += matched_macro.get("fat", 0) * mult
        total_fib += matched_macro.get("fiber", 0) * mult
        total_sod += matched_macro.get("sodium", 0) * mult

    return EstimateNutritionResponse(
        success=True,
        calories=round(total_cal / servings, 1),
        protein=round(total_pro / servings, 1),
        carbs=round(total_carb / servings, 1),
        fat=round(total_fat / servings, 1),
        fiber=round(total_fib / servings, 1) if total_fib > 0 else None,
        sodium=round(total_sod / servings, 1) if total_sod > 0 else None,
        servings=servings,
    )

