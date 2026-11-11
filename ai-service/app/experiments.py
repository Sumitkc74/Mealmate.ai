"""A/B Testing and Experimentation Framework for MealMate AI Service.

Provides:
- Deterministic, hash-based user bucketing (SHA-256 % 100) ensuring sticky variant assignment.
- Multi-armed experimentation across recommendation algorithms, prompt strategies, and RAG retrieval depths.
- Dynamic traffic allocation (e.g. 50/50 Control vs Treatment).
- Experiment registry with activation controls and metadata.
- Prometheus counter integration for observability and conversion analysis.
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass, field
from typing import Any

from prometheus_client import Counter

_logger = logging.getLogger(__name__)

# Prometheus metrics for experiment tracking
EXPERIMENT_IMPRESSIONS = Counter(
    "mealmate_experiment_impressions_total",
    "Number of requests assigned to an experiment variant",
    ["experiment", "variant"],
)

EXPERIMENT_CONVERSIONS = Counter(
    "mealmate_experiment_conversions_total",
    "Number of downstream user conversions for an experiment variant",
    ["experiment", "variant", "event"],
)


@dataclass
class Variant:
    name: str
    weight: int  # Relative weight out of total sum (e.g. 50, 50)
    config: dict[str, Any] = field(default_factory=dict)


@dataclass
class Experiment:
    name: str
    description: str
    variants: list[Variant]
    active: bool = True

    def assign_variant(self, user_or_session_id: str) -> Variant:
        """Deterministically map a user or session identifier to a variant."""
        if not self.active or not self.variants:
            return self.variants[0] if self.variants else Variant(name="default", weight=100)

        # Hash identifier + experiment name to avoid cross-experiment correlation
        seed = f"{self.name}:{user_or_session_id}".encode("utf-8")
        hash_val = int(hashlib.sha256(seed).hexdigest()[:8], 16)

        total_weight = sum(v.weight for v in self.variants)
        bucket = hash_val % total_weight

        cumulative = 0
        for v in self.variants:
            cumulative += v.weight
            if bucket < cumulative:
                EXPERIMENT_IMPRESSIONS.labels(experiment=self.name, variant=v.name).inc()
                return v

        return self.variants[-1]


class ExperimentManager:
    """Central registry and coordinator for online A/B experiments."""

    def __init__(self) -> None:
        self._experiments: dict[str, Experiment] = {}
        self._register_default_experiments()

    def _register_default_experiments(self) -> None:
        # Experiment 1: Recommendation Strategy (Hybrid TFIDF+LSA vs Knowledge Graph Enhanced RAG)
        self.register_experiment(
            Experiment(
                name="recommender_algorithm_v2",
                description="Evaluate Hybrid TFIDF+LSA baseline against Knowledge-Graph RAG semantic retrieval",
                variants=[
                    Variant(name="control_hybrid", weight=50, config={"strategy": "hybrid"}),
                    Variant(name="treatment_rag_kg", weight=50, config={"strategy": "rag_kg"}),
                ],
                active=True,
            )
        )

        # Experiment 2: RAG Top-K retrieval depth
        self.register_experiment(
            Experiment(
                name="rag_retrieval_depth",
                description="Test 3 recipes vs 5 recipes in RAG prompt context",
                variants=[
                    Variant(name="top_3", weight=50, config={"top_k": 3}),
                    Variant(name="top_5", weight=50, config={"top_k": 5}),
                ],
                active=True,
            )
        )

    def register_experiment(self, exp: Experiment) -> None:
        self._experiments[exp.name] = exp

    def get_experiment(self, name: str) -> Experiment | None:
        return self._experiments.get(name)

    def assign(self, experiment_name: str, user_id: str) -> Variant | None:
        exp = self.get_experiment(experiment_name)
        if not exp:
            return None
        return exp.assign_variant(user_id)

    def record_conversion(self, experiment_name: str, variant_name: str, event: str) -> None:
        """Record downstream event (e.g. recipe_cooked, plan_added, rating_high)."""
        EXPERIMENT_CONVERSIONS.labels(
            experiment=experiment_name,
            variant=variant_name,
            event=event,
        ).inc()

    def list_experiments(self) -> list[dict[str, Any]]:
        return [
            {
                "name": e.name,
                "description": e.description,
                "active": e.active,
                "variants": [{"name": v.name, "weight": v.weight, "config": v.config} for v in e.variants],
            }
            for e in self._experiments.values()
        ]


_EXP_MANAGER = ExperimentManager()


def get_experiment_manager() -> ExperimentManager:
    return _EXP_MANAGER

