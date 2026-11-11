"""Content-based recipe recommender — TF-IDF, LSA, collaborative and hybrid.

Strategy
--------
1. Build a corpus document per recipe by joining title, ingredients, tags and cuisine.
2. Fit a TF-IDF vectorizer (1-2 grams) over the corpus once at startup.
3. Fit a Truncated-SVD LSA embedding on top of the TF-IDF matrix.
4. Fit an item-item collaborative similarity table from each recipe's tag/cuisine
   profile (and any recorded user-recipe interactions).
5. At inference, build a query document from the user's pantry/preferences and rank
   recipes by one of four strategies:

      - ``tfidf``  — lexical cosine over the raw TF-IDF matrix (baseline).
      - ``lsa``    — semantic cosine in the dense LSA space.
      - ``collab`` — item-item collaborative similarity to the user's liked recipes.
      - ``hybrid`` — explainable weighted sum of the three signals.

   Allergy filtering is always a hard constraint; dietary preferences are a soft boost.

This is fully deterministic given the same inputs, CPU-only, trains in milliseconds,
and ships with a bundled JSON dataset so the service runs out of the box without MongoDB.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from ._text import Recipe, doc_text, normalize, normalize_list, query_text
from .collab import CollabFilter
from .embeddings import LsaEmbedder
from .metrics import record_recommender_call
from .schemas import RecommendedRecipe, SignalContribution, Strategy


# Backwards-compatibility re-exports — older modules import these names from
# ``recommender`` and the rename happened in the same release.
_normalize = normalize
_normalize_list = normalize_list
_doc_text = doc_text
_query_text = query_text


# ---------------------------------------------------------------------------
# Hybrid blending weights. Tunable from env / paper appendix.
# Each weight is the contribution of one signal to the final hybrid score.
# (Calibrated on the bundled 64-recipe corpus to keep the three signals on
#  comparable [0,1] ranges; see eval/run_eval.py.)
# ---------------------------------------------------------------------------
HYBRID_WEIGHTS: dict[str, float] = {
    "tfidf": 0.45,
    "lsa": 0.40,
    "collab": 0.15,
}


def _safe_min_max(arr: np.ndarray) -> np.ndarray:
    """Per-query min-max normalisation so signals fall on a comparable [0,1] scale."""
    if arr.size == 0:
        return arr
    lo = float(arr.min())
    hi = float(arr.max())
    if hi - lo < 1e-9:
        return np.zeros_like(arr)
    return (arr - lo) / (hi - lo)


class RecommenderService:
    """Trains and serves a multi-strategy recipe recommender."""

    def __init__(self, data_path: Path | None = None) -> None:
        self._data_path = data_path or Path(__file__).resolve().parent.parent / "data" / "recipes.json"
        self._loaded = False
        self._recipes: list[Recipe] = []
        self._vectorizer: TfidfVectorizer | None = None
        self._matrix = None
        self._lsa = LsaEmbedder()
        self._collab = CollabFilter()
        self._tfidf_cache: dict[str, np.ndarray] = {}
        self._lsa_cache: dict[str, np.ndarray] = {}

    # ----- lifecycle -----

    def load(self) -> None:
        recipes = self._read_dataset(self._data_path)
        self.fit(recipes)

    def fit(self, recipes: list[Recipe]) -> None:
        if not recipes:
            raise ValueError("Cannot train recommender on empty recipe set")
        self._recipes = recipes
        self._tfidf_cache.clear()
        self._lsa_cache.clear()
        docs = [doc_text(r) for r in recipes]
        self._vectorizer = TfidfVectorizer(
            ngram_range=(1, 2),
            min_df=1,
            sublinear_tf=True,
            stop_words="english",
        )
        self._matrix = self._vectorizer.fit_transform(docs)
        # Side-by-side dense embeddings (LSA) and collab tag-profile model.
        self._lsa.fit(docs)
        self._collab.fit(recipes)
        self._loaded = True

    def sync_db_recipes(self, db_recipes: list[Recipe]) -> int:
        """Replace the corpus with the actual database recipes from MongoDB and re-fit indexes."""
        if not db_recipes:
            return 0
        self.fit(db_recipes)
        return len(db_recipes)

    def upsert_recipes(self, new_recipes: list[Recipe]) -> int:
        """Merge additional recipes into the corpus and re-fit indexes."""
        if not new_recipes:
            return 0
        recipe_map = {r.recipe_id: r for r in self._recipes}
        added = 0
        for r in new_recipes:
            if r.recipe_id not in recipe_map:
                added += 1
            recipe_map[r.recipe_id] = r
        if added > 0 or not self._loaded:
            self.fit(list(recipe_map.values()))
        return added

    @property
    def is_loaded(self) -> bool:
        return self._loaded

    @property
    def recipe_count(self) -> int:
        return len(self._recipes)

    @property
    def recipes(self) -> list[Recipe]:
        """Read-only view of the loaded recipe corpus (used by the planner)."""
        return list(self._recipes)

    @property
    def collab(self) -> CollabFilter:
        return self._collab

    def get_recipe(self, recipe_id: str) -> Recipe | None:
        norm = _normalize(recipe_id)
        for r in self._recipes:
            if _normalize(r.recipe_id) == norm:
                return r
        return None

    # ----- inference -----

    def _signal_tfidf(self, query: str) -> np.ndarray:
        assert self._vectorizer is not None and self._matrix is not None
        if not query.strip():
            return np.zeros(len(self._recipes))
        if query in self._tfidf_cache:
            return self._tfidf_cache[query]
        query_vec = self._vectorizer.transform([query])
        sims = cosine_similarity(query_vec, self._matrix)[0]
        if len(self._tfidf_cache) >= 500:
            self._tfidf_cache.clear()
        self._tfidf_cache[query] = sims
        return sims

    def _signal_lsa(self, query: str) -> np.ndarray:
        if not query.strip() or not self._lsa.is_fitted:
            return np.zeros(len(self._recipes))
        if query in self._lsa_cache:
            return self._lsa_cache[query]
        sims = self._lsa.similarity(query)
        if len(self._lsa_cache) >= 500:
            self._lsa_cache.clear()
        self._lsa_cache[query] = sims
        return sims

    def _signal_collab(self, liked: list[str]) -> np.ndarray:
        if not liked or not self._collab.is_fitted:
            return np.zeros(len(self._recipes))
        return self._collab.score_query(liked)

    def recommend(
        self,
        ingredients: list[str],
        dietary_preferences: list[str],
        top_k: int,
        allergies: list[str] | None = None,
        strategy: Strategy = "hybrid",
        liked_recipe_ids: list[str] | None = None,
        allowed_recipe_ids: set[str] | None = None,
        excluded_recipe_ids: set[str] | None = None,
    ) -> list[RecommendedRecipe]:
        if not self._loaded or self._vectorizer is None or self._matrix is None:
            raise RuntimeError("Recommender is not loaded. Call load() first.")

        query = _query_text(ingredients, dietary_preferences)
        record_recommender_call(strategy)

        # Compute the three raw signals up-front; even when only one strategy
        # is requested we report the others for explainability.
        tfidf_raw = self._signal_tfidf(query)
        lsa_raw = self._signal_lsa(query)
        collab_raw = self._signal_collab(liked_recipe_ids or [])

        # Per-query normalisation so signals are comparable. This is critical
        # for the hybrid weighted sum to be meaningful.
        tfidf_n = _safe_min_max(tfidf_raw)
        lsa_n = _safe_min_max(lsa_raw)
        collab_n = _safe_min_max(collab_raw)

        if strategy == "tfidf":
            base = tfidf_n
        elif strategy == "lsa":
            base = lsa_n
        elif strategy == "collab":
            base = collab_n
        else:  # hybrid
            w = HYBRID_WEIGHTS
            base = (
                w["tfidf"] * tfidf_n
                + w["lsa"] * lsa_n
                + w["collab"] * collab_n
            )

        if not query.strip() and strategy != "collab":
            return []
        if strategy == "collab" and not (liked_recipe_ids or []):
            return []

        norm_pantry = set(_normalize_list(ingredients))
        norm_prefs = set(_normalize_list(dietary_preferences))
        norm_allergies = set(_normalize_list(allergies or []))

        scored: list[tuple[float, Recipe, list[str], list[str], int]] = []
        for idx, base_score in enumerate(base):
            recipe = self._recipes[idx]
            if allowed_recipe_ids is not None and recipe.recipe_id not in allowed_recipe_ids:
                continue
            if excluded_recipe_ids is not None and recipe.recipe_id in excluded_recipe_ids:
                continue

            ing_set = {_normalize(i) for i in recipe.ingredients}
            tag_set = {_normalize(t) for t in recipe.tags}

            # Hard filter: drop any recipe containing an allergen substring.
            if norm_allergies and any(
                any(allerg in ing for ing in ing_set) for allerg in norm_allergies
            ):
                continue

            matched_pantry = sorted(norm_pantry & ing_set)
            matched_prefs = sorted(norm_prefs & tag_set)

            boost = 0.05 * len(matched_prefs)
            if norm_prefs and not matched_prefs:
                boost -= 0.05

            score = float(base_score) + boost
            if score <= 0:
                continue
            scored.append((score, recipe, matched_pantry, matched_prefs, idx))

        scored.sort(key=lambda t: (-t[0], t[1].recipe_id))
        top = scored[:top_k]

        results: list[RecommendedRecipe] = []
        for score, recipe, matched_pantry, matched_prefs, idx in top:
            signals = self._build_signals(strategy, idx, tfidf_n, lsa_n, collab_n)
            reason_parts: list[str] = []
            if matched_pantry:
                shown = ", ".join(matched_pantry[:3])
                more = "…" if len(matched_pantry) > 3 else ""
                reason_parts.append(
                    f"Uses {len(matched_pantry)} of your pantry items ({shown}{more})"
                )
            if matched_prefs:
                reason_parts.append(f"matches {', '.join(matched_prefs)}")
            if strategy == "hybrid" and signals:
                top_signal = max(signals, key=lambda s: s.score * s.weight)
                reason_parts.append(f"strongest signal: {top_signal.name}")
            elif strategy == "lsa":
                reason_parts.append("semantic match")
            elif strategy == "collab":
                reason_parts.append("liked by users with similar taste")
            reason = "; ".join(reason_parts) if reason_parts else "Similar to your preferences"

            results.append(
                RecommendedRecipe(
                    recipe_id=recipe.recipe_id,
                    title=recipe.title,
                    score=round(score, 4),
                    matched_ingredients=matched_pantry,
                    reason=reason,
                    signals=signals,
                )
            )
        return results

    def _build_signals(
        self,
        strategy: Strategy,
        idx: int,
        tfidf_n: np.ndarray,
        lsa_n: np.ndarray,
        collab_n: np.ndarray,
    ) -> list[SignalContribution]:
        if strategy == "tfidf":
            return [SignalContribution(name="tfidf", score=round(float(tfidf_n[idx]), 4), weight=1.0)]
        if strategy == "lsa":
            return [SignalContribution(name="lsa", score=round(float(lsa_n[idx]), 4), weight=1.0)]
        if strategy == "collab":
            return [SignalContribution(name="collab", score=round(float(collab_n[idx]), 4), weight=1.0)]
        # hybrid
        w = HYBRID_WEIGHTS
        return [
            SignalContribution(name="tfidf", score=round(float(tfidf_n[idx]), 4), weight=w["tfidf"]),
            SignalContribution(name="lsa", score=round(float(lsa_n[idx]), 4), weight=w["lsa"]),
            SignalContribution(name="collab", score=round(float(collab_n[idx]), 4), weight=w["collab"]),
        ]

    def similar(
        self,
        recipe_id: str,
        top_k: int = 5,
        strategy: Strategy = "tfidf",
    ) -> list[RecommendedRecipe]:
        """Return the top-k most similar recipes to the given recipe id.

        Uses cosine similarity in the requested vector space; the recipe's own
        vector is the query. Result excludes the input recipe itself.
        """
        if not self._loaded or self._vectorizer is None or self._matrix is None:
            raise RuntimeError("Recommender is not loaded. Call load() first.")

        norm_target = _normalize(recipe_id)
        target_idx: int | None = None
        for i, r in enumerate(self._recipes):
            if _normalize(r.recipe_id) == norm_target:
                target_idx = i
                break
        if target_idx is None:
            return []

        if strategy == "lsa" and self._lsa.is_fitted:
            target_vec = self._lsa.matrix[target_idx]
            sims = self._lsa.matrix @ target_vec
        elif strategy == "collab" and self._collab.is_fitted:
            sims = self._collab.similarity_to(self._recipes[target_idx].recipe_id)
        elif strategy == "hybrid":
            # Average of TF-IDF and LSA (collab needs liked-set, not directly usable here)
            tfidf_sims = cosine_similarity(self._matrix[target_idx], self._matrix)[0]
            lsa_sims = (
                self._lsa.matrix @ self._lsa.matrix[target_idx]
                if self._lsa.is_fitted
                else np.zeros_like(tfidf_sims)
            )
            sims = 0.5 * tfidf_sims + 0.5 * lsa_sims
        else:
            sims = cosine_similarity(self._matrix[target_idx], self._matrix)[0]

        scored = [
            (float(sims[i]), self._recipes[i])
            for i in range(len(self._recipes))
            if i != target_idx and float(sims[i]) > 0
        ]
        scored.sort(key=lambda t: (-t[0], t[1].recipe_id))
        top = scored[:top_k]

        target = self._recipes[target_idx]
        target_tag_set = {_normalize(t) for t in target.tags}
        target_ing_set = {_normalize(i) for i in target.ingredients}

        out: list[RecommendedRecipe] = []
        for score, r in top:
            shared_tags = sorted({_normalize(t) for t in r.tags} & target_tag_set)
            shared_ings = sorted({_normalize(i) for i in r.ingredients} & target_ing_set)
            reason_parts: list[str] = []
            if shared_tags:
                reason_parts.append(f"shares tags: {', '.join(shared_tags[:3])}")
            if shared_ings:
                reason_parts.append(f"{len(shared_ings)} common ingredients")
            reason = "; ".join(reason_parts) if reason_parts else "Similar flavour profile"
            out.append(
                RecommendedRecipe(
                    recipe_id=r.recipe_id,
                    title=r.title,
                    score=round(score, 4),
                    matched_ingredients=shared_ings,
                    reason=reason,
                )
            )
        return out

    # ----- dataset -----

    @staticmethod
    def _read_dataset(path: Path) -> list[Recipe]:
        if not path.exists():
            raise FileNotFoundError(f"Recipe dataset not found at {path}")
        with path.open("r", encoding="utf-8") as f:
            raw = json.load(f)
        recipes: list[Recipe] = []
        for r in raw:
            recipes.append(
                Recipe(
                    recipe_id=str(r["recipe_id"]),
                    title=str(r["title"]),
                    ingredients=tuple(r.get("ingredients", [])),
                    tags=tuple(r.get("tags", [])),
                    cuisine=r.get("cuisine"),
                )
            )
        return recipes


# ----- module-level singleton -----

_service = RecommenderService()


def get_recommender() -> RecommenderService:
    if not _service.is_loaded:
        _service.load()
    return _service


def reset_recommender_for_tests() -> None:
    """Test helper to force a fresh load of the recommender."""
    global _service
    _service = RecommenderService()
