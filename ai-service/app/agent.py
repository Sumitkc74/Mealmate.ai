"""Agentic AI Orchestrator and Tool-Calling Framework for MealMate.

Implements an autonomous culinary agent that can reason, select, and invoke
tools to answer complex multi-step queries:
- Recipe search via Vector RAG / Semantic Recommender
- Ingredient substitutions via Culinary Knowledge Graph
- Carbon footprint & sustainability analysis
- Meal plan mutation generation (add_to_plan)
- Kitchen unit conversion

Features:
- Structured Tool Definitions (JSON Schema compatible)
- ReAct (Reason + Act) loop with execution tracing
- Grounded execution preventing hallucinations
- Graceful degradation when LLM services are offline
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Callable

from .knowledge_graph import get_knowledge_graph
from .llm_provider import get_llm_provider, parse_json
from .rag import get_rag
from .sustainability import compute_recipe_footprint

_logger = logging.getLogger(__name__)


@dataclass
class ToolExecutionTrace:
    tool_name: str
    arguments: dict[str, Any]
    output: Any
    success: bool = True
    error: str | None = None


@dataclass
class AgentResult:
    response: str
    tool_traces: list[ToolExecutionTrace] = field(default_factory=list)
    actions: list[dict[str, Any]] = field(default_factory=list)
    method: str = "agentic_llm"


# ---------------------------------------------------------------------------
# Kitchen Tools Registry
# ---------------------------------------------------------------------------

class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, tuple[Callable[..., Any], dict[str, Any]]] = {}

    def register(self, name: str, description: str, parameters: dict[str, Any]) -> Callable:
        def decorator(fn: Callable[..., Any]) -> Callable[..., Any]:
            self._tools[name] = (fn, {
                "name": name,
                "description": description,
                "parameters": parameters,
            })
            return fn
        return decorator

    def get_definitions(self) -> list[dict[str, Any]]:
        return [schema for _, schema in self._tools.values()]

    def execute(self, name: str, args: dict[str, Any]) -> Any:
        if name not in self._tools:
            raise ValueError(f"Unknown tool: '{name}'")
        fn, _ = self._tools[name]
        return fn(**args)


registry = ToolRegistry()


@registry.register(
    name="search_recipes",
    description="Retrieve relevant recipes matching ingredients, query, or dietary restrictions using Vector RAG.",
    parameters={
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Search query or main ingredients"},
            "allergies": {"type": "array", "items": {"type": "string"}, "description": "Allergens to filter out"},
            "top_k": {"type": "integer", "description": "Number of recipes to retrieve (default 3)", "default": 3},
        },
        "required": ["query"],
    },
)
def tool_search_recipes(query: str, allergies: list[str] | None = None, top_k: int = 3) -> list[dict[str, Any]]:
    rag = get_rag()
    ingredients = [q.strip() for q in query.replace(",", " ").split() if len(q.strip()) > 2]
    res = rag.suggest(
        pantry=ingredients or [query],
        allergies=allergies or [],
        top_k=min(top_k, 5),
    )
    return [
        {
            "id": r.get("id"),
            "title": r.get("title"),
            "cuisine": r.get("cuisine"),
            "ingredients": r.get("ingredients", [])[:8],
            "score": r.get("score"),
        }
        for r in res.get("recipes", [])
    ]


@registry.register(
    name="find_substitutes",
    description="Find context-aware culinary substitutions for an ingredient using the Knowledge Graph.",
    parameters={
        "type": "object",
        "properties": {
            "ingredient": {"type": "string", "description": "The ingredient to replace (e.g. 'buttermilk', 'egg')"},
            "context": {"type": "string", "description": "Optional culinary context: 'baking', 'vegan', 'savoury', 'gluten-free'"},
            "avoid_allergens": {"type": "array", "items": {"type": "string"}, "description": "Allergens to exclude"},
        },
        "required": ["ingredient"],
    },
)
def tool_find_substitutes(ingredient: str, context: str | None = None, avoid_allergens: list[str] | None = None) -> list[dict[str, Any]]:
    kg = get_knowledge_graph()
    subs = kg.find_substitutes(ingredient, context=context, avoid_allergens=avoid_allergens)
    return [
        {
            "target": s.target,
            "substitute": s.substitute,
            "ratio": s.ratio,
            "context": s.context,
            "notes": s.notes,
        }
        for s in subs
    ]


@registry.register(
    name="calculate_sustainability",
    description="Calculate carbon footprint (kg CO2e), eco score, and estimated cost for a list of ingredients.",
    parameters={
        "type": "object",
        "properties": {
            "ingredients": {"type": "array", "items": {"type": "string"}, "description": "List of ingredient strings"},
        },
        "required": ["ingredients"],
    },
)
def tool_calculate_sustainability(ingredients: list[str]) -> dict[str, Any]:
    footprint = compute_recipe_footprint(recipe_id="calc", title="Custom Inquiry", ingredients=ingredients)
    return {
        "co2_kg": round(footprint.co2_kg, 2),
        "cost_usd": round(footprint.cost_usd, 2),
        "eco_score": round(footprint.eco_score, 1),
    }


@registry.register(
    name="convert_units",
    description="Convert between common culinary volume and weight units (cups, ml, grams, tbsp, tsp, oz).",
    parameters={
        "type": "object",
        "properties": {
            "amount": {"type": "number", "description": "Numerical quantity"},
            "from_unit": {"type": "string", "description": "Source unit ('cup', 'ml', 'g', 'oz', 'tbsp', 'tsp')"},
            "to_unit": {"type": "string", "description": "Target unit"},
        },
        "required": ["amount", "from_unit", "to_unit"],
    },
)
def tool_convert_units(amount: float, from_unit: str, to_unit: str) -> dict[str, Any]:
    # Volume conversions (base: ml)
    to_ml = {
        "ml": 1.0,
        "cup": 236.588,
        "tbsp": 14.787,
        "tsp": 4.929,
        "fl oz": 29.574,
        "oz": 28.3495,  # approximate
        "g": 1.0,       # assuming water density
    }
    src = from_unit.lower().rstrip("s")
    tgt = to_unit.lower().rstrip("s")
    if src in to_ml and tgt in to_ml:
        ml_val = amount * to_ml[src]
        res = ml_val / to_ml[tgt]
        return {
            "amount": amount,
            "from_unit": from_unit,
            "to_unit": to_unit,
            "result": round(res, 2),
        }
    return {"error": f"Unsupported conversion from {from_unit} to {to_unit}"}


@registry.register(
    name="add_to_plan",
    description="Emit an action to schedule a dish into the user's weekly meal plan.",
    parameters={
        "type": "object",
        "properties": {
            "recipe_query": {"type": "string", "description": "Specific dish name to add"},
            "day": {"type": "string", "description": "Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday"},
            "slot": {"type": "string", "description": "breakfast|lunch|dinner"},
        },
        "required": ["recipe_query", "day", "slot"],
    },
)
def tool_add_to_plan(recipe_query: str, day: str, slot: str) -> dict[str, Any]:
    return {
        "status": "staged",
        "action": {
            "type": "add_to_plan",
            "recipe_query": recipe_query,
            "day": day.capitalize(),
            "slot": slot.lower(),
        },
    }


# ---------------------------------------------------------------------------
# Agent Execution Loop
# ---------------------------------------------------------------------------

class CulinaryAgent:
    """Multi-turn autonomous culinary agent with tool-calling capabilities."""

    def __init__(self, provider_name: str | None = None) -> None:
        self.provider = get_llm_provider(provider_name)

    def run(
        self,
        user_message: str,
        history: list[dict[str, str]] | None = None,
        pantry: list[str] | None = None,
        allergies: list[str] | None = None,
    ) -> AgentResult:
        traces: list[ToolExecutionTrace] = []
        actions: list[dict[str, Any]] = []

        # 1. Heuristic tool detection or multi-turn reasoning prompt
        tools_def = registry.get_definitions()
        system_prompt = (
            "You are MealMate's autonomous culinary agent. You have access to the following tools:\n"
            f"{json.dumps(tools_def, indent=2)}\n\n"
            f"User Pantry: {pantry or []}\n"
            f"User Allergies: {allergies or []}\n\n"
            "If you need information, invoke a tool by outputting JSON:\n"
            "{\n"
            '  "thought": "your step-by-step reasoning",\n'
            '  "tool_call": {"name": "tool_name", "arguments": {...}}\n'
            "}\n"
            "If you are ready to answer the user, output JSON:\n"
            "{\n"
            '  "thought": "final reasoning",\n'
            '  "reply": "clear helpful grounded answer",\n'
            '  "actions": [...] // optional add_to_plan actions\n'
            "}\n"
        )

        if not self.provider.is_available():
            # Graceful offline heuristic execution
            return self._heuristic_fallback(user_message, pantry, allergies)

        # First turn: LLM decides whether to call a tool
        try:
            raw_response = self.provider.generate_chat(
                system=system_prompt,
                history=history or [],
                user_message=user_message,
                temperature=0.3,
                json_mode=True,
            )
        except Exception as exc:
            _logger.warning("Agent LLM call failed, falling back to heuristic: %s", exc)
            return self._heuristic_fallback(user_message, pantry, allergies)

        parsed = parse_json(raw_response or "")
        if not parsed or not isinstance(parsed, dict):
            # Fallback to direct text if JSON parsing failed
            return AgentResult(
                response=raw_response or "I can help you cook or plan meals. What ingredients do you have?",
                method="llm_direct",
            )

        # Check if model requested a tool invocation
        tool_call = parsed.get("tool_call")
        if tool_call and isinstance(tool_call, dict) and "name" in tool_call:
            tool_name = tool_call["name"]
            tool_args = tool_call.get("arguments", {})
            try:
                output = registry.execute(tool_name, tool_args)
                traces.append(ToolExecutionTrace(tool_name=tool_name, arguments=tool_args, output=output, success=True))
                if tool_name == "add_to_plan" and isinstance(output, dict) and "action" in output:
                    actions.append(output["action"])
            except Exception as exc:
                _logger.warning("Agent tool '%s' execution error: %s", tool_name, exc)
                traces.append(ToolExecutionTrace(tool_name=tool_name, arguments=tool_args, output=None, success=False, error=str(exc)))
                output = {"error": str(exc)}

            # Second turn: synthesize answer grounded on tool output
            second_system = (
                f"{system_prompt}\n\nTool '{tool_name}' was executed with arguments {json.dumps(tool_args)}.\n"
                f"Tool Output:\n{json.dumps(output, indent=2)}\n"
                "Synthesize a friendly, informative answer to the user based on this tool output."
            )
            try:
                final_raw = self.provider.generate_chat(
                    system=second_system,
                    history=history or [],
                    user_message=user_message,
                    temperature=0.5,
                    json_mode=True,
                )
            except Exception as exc:
                _logger.warning("Agent second turn LLM call failed: %s", exc)
                final_raw = None
            final_parsed = parse_json(final_raw or "")
            reply = ""
            if isinstance(final_parsed, dict):
                reply = final_parsed.get("reply", "")
                if "actions" in final_parsed and isinstance(final_parsed["actions"], list):
                    actions.extend(final_parsed["actions"])
            if not reply:
                reply = final_raw or f"Based on {tool_name}, here is what I found."

            return AgentResult(
                response=reply,
                tool_traces=traces,
                actions=actions,
                method="agentic_tool_react",
            )

        # Direct reply without tool calls
        reply = parsed.get("reply", raw_response or "")
        if "actions" in parsed and isinstance(parsed["actions"], list):
            actions.extend(parsed["actions"])

        return AgentResult(
            response=reply,
            tool_traces=traces,
            actions=actions,
            method="agentic_direct",
        )

    def _heuristic_fallback(
        self,
        user_message: str,
        pantry: list[str] | None,
        allergies: list[str] | None,
    ) -> AgentResult:
        """Rule-based execution when no LLM key is configured."""
        traces: list[ToolExecutionTrace] = []
        msg_lower = user_message.lower()

        # Check for substitution intent
        if "substitute" in msg_lower or "replace" in msg_lower or "instead of" in msg_lower:
            kg = get_knowledge_graph()
            # Extract target ingredient
            for word in ["buttermilk", "egg", "butter", "cream", "soy sauce", "flour", "parmesan", "garlic"]:
                if word in msg_lower:
                    subs = kg.find_substitutes(word, avoid_allergens=allergies)
                    traces.append(ToolExecutionTrace(
                        tool_name="find_substitutes",
                        arguments={"ingredient": word},
                        output=[s.__dict__ for s in subs],
                    ))
                    if subs:
                        sub_text = "\n".join(f"- **{s.substitute}** ({s.ratio}) — {s.notes}" for s in subs)
                        return AgentResult(
                            response=f"Here are great substitutions for **{word}**:\n{sub_text}",
                            tool_traces=traces,
                            method="heuristic_agent",
                        )

        # Check for unit conversion intent
        if "cup" in msg_lower or "ml" in msg_lower or "tablespoon" in msg_lower or "tbsp" in msg_lower:
            import re
            match = re.search(r"(\d+(?:\.\d+)?)\s*(cup|ml|tbsp|tsp|oz)s?\s*(?:to|in)\s*(cup|ml|tbsp|tsp|oz)", msg_lower)
            if match:
                amt = float(match.group(1))
                src = match.group(2)
                tgt = match.group(3)
                out = tool_convert_units(amt, src, tgt)
                traces.append(ToolExecutionTrace(
                    tool_name="convert_units",
                    arguments={"amount": amt, "from_unit": src, "to_unit": tgt},
                    output=out,
                ))
                if "result" in out:
                    return AgentResult(
                        response=f"{amt} {src} is equal to **{out['result']} {tgt}**.",
                        tool_traces=traces,
                        method="heuristic_agent",
                    )

        # Default RAG recipe search
        rag = get_rag()
        ingredients = pantry or [w for w in msg_lower.replace(",", " ").split() if len(w) > 3]
        recipes = rag.suggest(pantry=ingredients, allergies=allergies or [], top_k=3).get("recipes", [])
        traces.append(ToolExecutionTrace(
            tool_name="search_recipes",
            arguments={"query": user_message, "top_k": 3},
            output=recipes,
        ))
        if recipes:
            names = ", ".join(f"**{r.get('title')}**" for r in recipes[:3])
            return AgentResult(
                response=f"Based on your ingredients, I suggest trying {names}.",
                tool_traces=traces,
                method="heuristic_agent",
            )

        return AgentResult(
            response="I'm ready to help with cooking tips, recipes, ingredient substitutions, and meal planning.",
            tool_traces=[],
            method="heuristic_agent",
        )
