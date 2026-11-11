# ADR 0003: Agentic Tool-Calling & Grounding Framework

## Status
Accepted

## Context
Standard conversational LLMs hallucinate non-existent recipes, inaccurate unit conversions, or unsafe food substitutions. Furthermore, single-prompt LLMs cannot directly perform actions on behalf of the user, such as mutating the user's weekly meal plan or calculating precise Life Cycle Assessment (LCA) carbon metrics.

## Decision
We implemented an autonomous culinary agent (`app/agent.py`) using a ReAct (Reasoning + Acting) loop:
1. **Tool Registry**: Declares JSON-Schema compliant kitchen tools (`search_recipes`, `find_substitutes`, `calculate_sustainability`, `convert_units`, `add_to_plan`).
2. **Grounding Trace**: Tool calls and their exact outputs are recorded in `ToolExecutionTrace` objects and passed into the second-turn prompt.
3. **Graceful Fallback**: If LLM API keys are unavailable or rate-limited, the agent falls back to deterministic keyword heuristic routing.

## Consequences
### Positive
- Prevents hallucination by grounding responses in verified recipe data and Knowledge Graph relationships.
- Surfaces executable actions (`add_to_plan`) that the frontend or API gateway can execute directly in MongoDB.
- Complete execution transparency with tool trace objects returned to the client.

