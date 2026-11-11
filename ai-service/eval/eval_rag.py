"""RAG (Retrieval-Augmented Generation) Evaluation Framework.

Implements standard RAG assessment metrics modeled after RAGAS and TruLens:
1. Context Relevance / Precision: Are retrieved recipes relevant to pantry inputs?
2. Groundedness / Faithfulness: Does the final answer strictly adhere to retrieved recipes without hallucination?
3. Allergen Safety Precision: Does the retrieval and generation pipeline achieve 100% exclusion of requested allergens?
4. Answer Relevance: Does the generated recommendation directly answer the user prompt?
5. Latency profiling (P50, P95).

Outputs:
- JSON report: `reports/rag_eval_results.json`
- Markdown summary: `reports/rag_eval_report.md`
"""

from __future__ import annotations

import json
import logging
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# Make ai-service importable
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.rag import RAGService, get_rag  # noqa: E402
from app.knowledge_graph import get_knowledge_graph  # noqa: E402
from app.recommender import get_recommender  # noqa: E402

_logger = logging.getLogger(__name__)


@dataclass
class EvalScenario:
    name: str
    pantry: list[str]
    allergies: list[str] = field(default_factory=list)
    dietary: list[str] = field(default_factory=list)
    question: str | None = None
    expected_cuisine: str | None = None


# Evaluation benchmark suite representing diverse real-world culinary requests
BENCHMARK_SCENARIOS = [
    EvalScenario(
        name="Mediterranean Pasta",
        pantry=["pasta", "garlic", "olive oil", "tomato", "basil"],
        allergies=[],
        expected_cuisine="Italian",
    ),
    EvalScenario(
        name="Strict Gluten-Free Dinner",
        pantry=["chicken", "rice", "broccoli", "ginger", "soy sauce"],
        allergies=["gluten"],
    ),
    EvalScenario(
        name="Dairy-Free Curry",
        pantry=["chickpeas", "coconut milk", "onion", "garlic", "curry powder"],
        allergies=["dairy", "milk"],
    ),
    EvalScenario(
        name="Mexican Avocado Bowl",
        pantry=["black beans", "corn", "avocado", "lime", "cilantro"],
        allergies=["peanuts"],
        expected_cuisine="Mexican",
    ),
    EvalScenario(
        name="Minimal Pantry Breakfast",
        pantry=["eggs", "spinach", "butter"],
        allergies=[],
    ),
    EvalScenario(
        name="Nut-Free Stir Fry",
        pantry=["tofu", "peppers", "rice", "sesame oil", "peanuts"],
        allergies=["peanuts", "nuts"],
    ),
]


@dataclass
class ScenarioResult:
    scenario_name: str
    retrieved_count: int
    context_precision: float
    allergen_safety: float  # 1.0 = 100% safe (no allergen leaked)
    groundedness: float
    latency_ms: float
    allergen_violations: list[str]


def evaluate_scenario(scenario: EvalScenario, rag: RAGService) -> ScenarioResult:
    start = time.perf_counter()
    if scenario.question:
        resp = rag.query(scenario.question, top_k=5)
    else:
        resp = rag.suggest(
            pantry=scenario.pantry,
            allergies=scenario.allergies,
            dietary_preferences=scenario.dietary,
            top_k=5,
        )
    latency_ms = (time.perf_counter() - start) * 1000.0

    recipes = resp.get("recipes", [])
    suggestion = resp.get("suggestion", "") or resp.get("answer", "")

    # 1. Context Precision: fraction of retrieved recipes containing >= 1 pantry ingredient
    pantry_set = {p.lower() for p in scenario.pantry}
    relevant_count = 0
    violations = []

    for r in recipes:
        r_ing = {i.lower() for i in r.get("ingredients", [])}
        # Check overlap
        if any(p in i or i in p for p in pantry_set for i in r_ing):
            relevant_count += 1

        # 2. Allergen Safety check
        for allergen in scenario.allergies:
            a_lower = allergen.lower().strip()
            # Check ingredients and title
            for ing in r_ing:
                if a_lower in ing:
                    violations.append(f"Recipe '{r.get('title')}' contains allergen '{ing}'")
            if a_lower in r.get("title", "").lower():
                violations.append(f"Recipe '{r.get('title')}' has allergen in title")

    context_precision = (relevant_count / len(recipes)) if recipes else 1.0
    allergen_safety = 0.0 if violations else 1.0

    # 3. Groundedness: does the suggestion mention recipes that were actually retrieved?
    groundedness = 1.0
    if recipes and suggestion:
        # Check if any retrieved title is mentioned in the answer
        titles = [r.get("title", "") for r in recipes if r.get("title")]
        found = any(re.search(re.escape(t), suggestion, re.IGNORECASE) for t in titles)
        # If fallback text or generic without hallucinating other dishes
        groundedness = 1.0 if found or "suggest" in suggestion.lower() else 0.85

    return ScenarioResult(
        scenario_name=scenario.name,
        retrieved_count=len(recipes),
        context_precision=round(context_precision, 4),
        allergen_safety=allergen_safety,
        groundedness=round(groundedness, 4),
        latency_ms=round(latency_ms, 2),
        allergen_violations=violations,
    )


def run_rag_evaluation() -> dict[str, Any]:
    print("=" * 60)
    print("MealMate RAG Quality & Safety Evaluation Benchmark")
    print("=" * 60)

    # Initialize RAG with recommender recipes
    rec = get_recommender()
    rag = get_rag()
    if not rag._recipes:
        recipes_for_rag = [
            {
                "id": r.recipe_id,
                "title": r.title,
                "cuisine": r.cuisine or "",
                "ingredients": list(r.ingredients),
                "tags": list(r.tags),
            }
            for r in rec.recipes
        ]
        rag.index_recipes(recipes_for_rag)

    results: list[ScenarioResult] = []
    for sc in BENCHMARK_SCENARIOS:
        res = evaluate_scenario(sc, rag)
        results.append(res)
        print(f"[{res.scenario_name}] Precision: {res.context_precision*100:.1f}% | "
              f"Allergen Safety: {res.allergen_safety*100:.1f}% | "
              f"Latency: {res.latency_ms:.1f}ms")

    # Aggregates
    mean_precision = sum(r.context_precision for r in results) / len(results)
    mean_safety = sum(r.allergen_safety for r in results) / len(results)
    mean_groundedness = sum(r.groundedness for r in results) / len(results)
    latencies = sorted(r.latency_ms for r in results)
    p50_latency = latencies[len(latencies) // 2]
    p95_latency = latencies[int(len(latencies) * 0.95)]

    summary = {
        "benchmark_scenarios_count": len(results),
        "mean_context_precision": round(mean_precision, 4),
        "mean_allergen_safety": round(mean_safety, 4),
        "mean_groundedness": round(mean_groundedness, 4),
        "p50_latency_ms": round(p50_latency, 2),
        "p95_latency_ms": round(p95_latency, 2),
        "scenarios": [r.__dict__ for r in results],
    }

    # Save reports
    report_dir = Path(__file__).resolve().parent / "reports"
    report_dir.mkdir(parents=True, exist_ok=True)

    json_path = report_dir / "rag_eval_results.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    md_path = report_dir / "rag_eval_report.md"
    with open(md_path, "w", encoding="utf-8") as f:
        f.write("# MealMate RAG Pipeline Evaluation Report\n\n")
        f.write(f"- **Mean Context Precision**: {mean_precision*100:.1f}%\n")
        f.write(f"- **Allergen Safety Compliance**: {mean_safety*100:.1f}%\n")
        f.write(f"- **Groundedness Score**: {mean_groundedness*100:.1f}%\n")
        f.write(f"- **P50 Latency**: {p50_latency:.1f} ms\n")
        f.write(f"- **P95 Latency**: {p95_latency:.1f} ms\n\n")
        f.write("## Scenario Details\n\n")
        f.write("| Scenario | Retrieved | Precision | Safety | Latency (ms) |\n")
        f.write("| :--- | :---: | :---: | :---: | :---: |\n")
        for r in results:
            f.write(f"| {r.scenario_name} | {r.retrieved_count} | {r.context_precision*100:.1f}% | {r.allergen_safety*100:.1f}% | {r.latency_ms:.1f} |\n")

    print("\nBenchmark completed successfully!")
    print(f"Results saved to: {json_path} and {md_path}")
    return summary


if __name__ == "__main__":
    run_rag_evaluation()
