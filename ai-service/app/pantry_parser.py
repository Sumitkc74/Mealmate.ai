"""Smart pantry parser — turns freeform text into structured pantry items.

Tries Gemini first when ``GEMINI_API_KEY`` is set, then falls back to a
deterministic regex/keyword heuristic so the feature always works offline
(and is fully unit-testable without network access).
"""

from __future__ import annotations

import logging
import re
from typing import Any

from . import gemini
from .schemas import PantryParseRequest, PantryParseResponse, ParsedPantryItem

_logger = logging.getLogger(__name__)

# Common cooking units we'll recognise in the heuristic path.
_UNITS = {
    "g", "gram", "grams",
    "kg", "kilogram", "kilograms",
    "mg",
    "ml", "milliliter", "milliliters",
    "l", "liter", "liters", "litre", "litres",
    "tsp", "teaspoon", "teaspoons",
    "tbsp", "tablespoon", "tablespoons",
    "cup", "cups",
    "oz", "ounce", "ounces",
    "lb", "lbs", "pound", "pounds",
    "pinch", "dash",
    "clove", "cloves",
    "slice", "slices",
    "can", "cans", "jar", "jars", "packet", "packets", "pack", "packs",
    "head", "heads", "bunch", "bunches", "stick", "sticks",
}

_FILLER = {
    "of", "a", "an", "the", "some", "few", "couple", "couples", "leftover",
    "fresh", "old", "half", "quarter", "small", "large", "medium", "approx",
    "approximately", "about", "around", "maybe", "around",
}

_QTY_WORDS = {
    "a": "1", "an": "1", "one": "1", "two": "2", "three": "3", "four": "4",
    "five": "5", "six": "6", "seven": "7", "eight": "8", "nine": "9", "ten": "10",
    "half": "0.5", "quarter": "0.25",
}


def _heuristic_parse(text: str) -> list[ParsedPantryItem]:
    items: list[ParsedPantryItem] = []
    # Split on commas, semicolons, newlines, " and ".
    parts = re.split(r"\s*(?:,|;|\n|\band\b)\s*", text, flags=re.IGNORECASE)
    seen: set[str] = set()
    for raw in parts:
        chunk = raw.strip().lower()
        if not chunk:
            continue
        tokens = re.findall(r"[a-z0-9./]+", chunk)
        # Split combined number+unit tokens like "200g" or "1.5kg".
        expanded: list[str] = []
        for tok in tokens:
            m = re.fullmatch(r"(\d+(?:[./]\d+)?)([a-z]+)", tok)
            if m and m.group(2) in _UNITS:
                expanded.append(m.group(1))
                expanded.append(m.group(2))
            else:
                expanded.append(tok)
        tokens = expanded
        qty: str | None = None
        unit: str | None = None
        ing_tokens: list[str] = []
        for tok in tokens:
            if qty is None and re.fullmatch(r"\d+(?:[./]\d+)?", tok):
                qty = tok
                continue
            if qty is None and tok in _QTY_WORDS:
                qty = _QTY_WORDS[tok]
                continue
            if unit is None and tok in _UNITS:
                unit = tok
                continue
            if tok in _FILLER:
                continue
            ing_tokens.append(tok)
        if not ing_tokens:
            continue
        ingredient = " ".join(ing_tokens).strip()
        if ingredient in seen or len(ingredient) < 2:
            continue
        seen.add(ingredient)
        items.append(ParsedPantryItem(ingredient=ingredient, quantity=qty, unit=unit))
    return items


def _llm_parse(text: str) -> list[ParsedPantryItem] | None:
    if not gemini.is_available():
        return None
    system = (
        "Extract a structured pantry list from the user's free-form text. "
        "Return STRICT JSON with the shape "
        '{"items": [{"ingredient": "<name>", "quantity": "<number-or-null>", "unit": "<unit-or-null>"}, ...]}. '
        "Lowercase ingredient names. Singular form. Strip adjectives like "
        "'fresh' or 'leftover'. If quantity or unit is unclear, use null."
    )
    try:
        text_resp = gemini.generate_text(
            system=system,
            user=text,
            temperature=0.1,
            json_mode=True,
            max_output_tokens=300,
        )
    except Exception as exc:
        _logger.warning("Pantry parse LLM call failed, falling back to heuristic: %s", exc)
        return None
    if not text_resp:
        return None
    data: Any = gemini.parse_json(text_resp)
    if not isinstance(data, dict):
        return None
    raw_items = data.get("items")
    if not isinstance(raw_items, list):
        return None
    out: list[ParsedPantryItem] = []
    for raw in raw_items:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("ingredient", "")).strip().lower()
        if not name:
            continue
        qty = raw.get("quantity")
        unit = raw.get("unit")
        out.append(
            ParsedPantryItem(
                ingredient=name,
                quantity=str(qty) if qty not in (None, "") else None,
                unit=str(unit).lower() if unit not in (None, "") else None,
            )
        )
    return out or None


def parse(req: PantryParseRequest) -> PantryParseResponse:
    llm_items = _llm_parse(req.text)
    if llm_items is not None:
        return PantryParseResponse(strategy="llm", items=llm_items)
    return PantryParseResponse(strategy="heuristic", items=_heuristic_parse(req.text))
