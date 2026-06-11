"""
RAG-based recipe suggester.

Pipeline:
  1. INDEX  — embed all recipes into ChromaDB (once, on startup)
  2. FILTER — hard-remove any recipe containing a user allergen
  3. RETRIEVE — semantic vector search using pantry items + prefs as query
  4. AUGMENT  — pack retrieved recipes + user context into a Gemini prompt
  5. GENERATE — Gemini returns a natural-language suggestion with reasoning

Falls back gracefully to ranked retrieval results (no LLM explanation)
when Gemini is not configured.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Lazy imports — keep startup fast when optional deps are absent
# ---------------------------------------------------------------------------

def _chromadb():
    try:
        import chromadb  # type: ignore
        return chromadb
    except ImportError:
        return None


def _sentence_transformers():
    try:
        from sentence_transformers import SentenceTransformer  # type: ignore
        return SentenceTransformer
    except ImportError:
        return None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _recipe_to_text(recipe: dict[str, Any]) -> str:
    """Convert a recipe dict to a single string suitable for embedding."""
    parts = [recipe.get("title", "")]
    ingredients = recipe.get("ingredients", [])
    if isinstance(ingredients, list):
        parts.append("ingredients: " + ", ".join(str(i) for i in ingredients))
    tags = recipe.get("tags", [])
    if isinstance(tags, list):
        parts.append("tags: " + ", ".join(str(t) for t in tags))
    cuisine = recipe.get("cuisine", "")
    if cuisine:
        parts.append(f"cuisine: {cuisine}")
    instructions = recipe.get("instructions", [])
    if isinstance(instructions, list) and instructions:
        parts.append("instructions: " + " | ".join(str(s) for s in instructions))
    return ". ".join(p for p in parts if p)


def _contains_allergen(recipe: dict[str, Any], allergies: list[str]) -> bool:
    """Return True if any allergy keyword appears in the recipe ingredients/title."""
    if not allergies:
        return False
    text = _recipe_to_text(recipe).lower()
    return any(a.lower().strip() in text for a in allergies if a.strip())


# ---------------------------------------------------------------------------
# RAGService
# ---------------------------------------------------------------------------

class RAGService:
    """Singleton that owns the ChromaDB collection and embedding model."""

    COLLECTION_NAME = "mealmate_recipes"
    EMBED_MODEL = "all-MiniLM-L6-v2"  # ~80 MB, fast, runs locally

    def __init__(self, recipes: list[dict[str, Any]]):
        self._recipes: dict[str, dict[str, Any]] = {r["id"]: r for r in recipes}
        self._available = False
        self._chroma_client = None
        self._collection = None
        self._embedder = None
        self._setup(recipes)

    # ------------------------------------------------------------------
    # Setup
    # ------------------------------------------------------------------

    def _setup(self, recipes: list[dict[str, Any]]) -> None:
        chromadb = _chromadb()
        SentenceTransformer = _sentence_transformers()

        if chromadb is None:
            logger.warning("rag_unavailable: chromadb not installed")
            return
        if SentenceTransformer is None:
            logger.warning("rag_unavailable: sentence-transformers not installed")
            return

        try:
            logger.info("rag_setup_start", extra={"recipe_count": len(recipes)})
            self._embedder = SentenceTransformer(self.EMBED_MODEL)

            # Use an in-memory Chroma client (no extra infra needed)
            self._chroma_client = chromadb.Client()
            self._collection = self._chroma_client.get_or_create_collection(
                name=self.COLLECTION_NAME,
                metadata={"hnsw:space": "cosine"},
            )

            # Only index if empty (avoid re-indexing on hot reload)
            if recipes and self._collection.count() == 0:
                self._index_recipes(recipes)

            self._available = True
            logger.info("rag_setup_complete", extra={"indexed": self._collection.count()})
        except Exception as exc:
            logger.error("rag_setup_failed", extra={"error": str(exc)})

    def _index_recipes(self, recipes: list[dict[str, Any]]) -> None:
        """Embed and store all recipes in ChromaDB."""
        assert self._embedder is not None
        assert self._collection is not None

        texts = [_recipe_to_text(r) for r in recipes]
        embeddings = self._embedder.encode(texts, show_progress_bar=False).tolist()

        self._collection.add(
            ids=[r["id"] for r in recipes],
            embeddings=embeddings,
            documents=texts,
            metadatas=[
                {
                    "title": r.get("title", ""),
                    "cuisine": r.get("cuisine", ""),
                    "tags": json.dumps(r.get("tags", [])),
                    "ingredients": json.dumps(r.get("ingredients", [])),
                }
                for r in recipes
            ],
        )

    def reindex(self, recipes: list[dict[str, Any]]) -> int:
        """Replace the entire ChromaDB collection with a new recipe set."""
        if not self._available:
            return 0
        try:
            self._chroma_client.delete_collection(self.COLLECTION_NAME)
            self._collection = self._chroma_client.get_or_create_collection(
                name=self.COLLECTION_NAME,
                metadata={"hnsw:space": "cosine"},
            )
            self._recipes = {r["id"]: r for r in recipes}
            self._index_recipes(recipes)
            logger.info("rag_reindexed", extra={"count": len(recipes)})
            return len(recipes)
        except Exception as exc:
            logger.error("rag_reindex_failed", extra={"error": str(exc)})
            return 0

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    @property
    def is_available(self) -> bool:
        return self._available

    def suggest(
        self,
        pantry: list[str],
        dietary_preferences: list[str],
        allergies: list[str],
        top_k: int = 5,
    ) -> dict[str, Any]:
        """
        Full RAG pipeline:
          retrieve → filter allergens → augment prompt → generate with Gemini.
        Returns a dict with keys: success, suggestion, recipes, method.
        """
        if not self._available:
            return {
                "success": False,
                "suggestion": "RAG service is unavailable. Install chromadb and sentence-transformers.",
                "recipes": [],
                "method": "unavailable",
            }

        # 1. Build semantic query from pantry + preferences
        query_parts = ["I have these ingredients: " + ", ".join(pantry)]
        if dietary_preferences:
            query_parts.append("dietary preferences: " + ", ".join(dietary_preferences))
        if allergies:
            query_parts.append("allergies (must avoid): " + ", ".join(allergies))
        query_text = ". ".join(query_parts)

        # 2. Retrieve top candidates from ChromaDB
        retrieved = self._retrieve(query_text, n_results=top_k * 3)  # over-fetch to allow filtering

        # 3. Hard-filter allergens
        safe_recipes = [r for r in retrieved if not _contains_allergen(r, allergies)]
        safe_recipes = safe_recipes[:top_k]

        if not safe_recipes:
            return {
                "success": False,
                "suggestion": "No safe recipes found matching your pantry and dietary restrictions.",
                "recipes": [],
                "method": "rag_no_results",
            }

        # 4. Try Gemini generation
        suggestion, method = self._generate(
            pantry=pantry,
            dietary_preferences=dietary_preferences,
            allergies=allergies,
            recipes=safe_recipes,
        )

        return {
            "success": True,
            "suggestion": suggestion,
            "recipes": safe_recipes,
            "method": method,
        }

    def query(
        self,
        question: str,
        top_k: int = 5,
    ) -> dict[str, Any]:
        """Answer a question strictly from the recipe database using keyword filtering."""
        if not self._available:
            return {
                "success": False,
                "answer": "RAG service is unavailable.",
                "recipes": [],
                "method": "unavailable",
            }

        if self._collection.count() == 0:
            return {
                "success": True,
                "answer": "No recipes in the database yet.",
                "recipes": [],
                "method": "rag_empty",
            }

        # Search all recipes for keyword matches
        question_lower = question.lower()
        matched = []

        for recipe in self._recipes.values():
            recipe_text = _recipe_to_text(recipe).lower()
            if self._question_matches_recipe(question_lower, recipe_text, recipe):
                matched.append(recipe)

        if not matched:
            return {
                "success": True,
                "answer": "Our database doesn't have any recipes matching your query.",
                "recipes": [],
                "method": "rag_no_match",
            }

        matched = matched[:top_k]
        answer, method = self._answer(question, matched)

        return {
            "success": True,
            "answer": answer,
            "recipes": matched,
            "method": method,
        }

    @staticmethod
    def _question_matches_recipe(
        question: str,
        recipe_text: str,
        recipe: dict[str, Any],
    ) -> bool:
        """
        Strict matching — checks if the recipe actually satisfies the question.
        Handles dietary filters (veg, vegan, gluten-free etc.) as exclusion rules.
        """
        import re

        # --- Dietary exclusion rules ---
        # If user asks for veg/vegetarian, exclude meat recipes
        meat_keywords = {"chicken", "beef", "pork", "lamb", "mutton", "turkey",
                        "bacon", "sausage", "meat", "fish", "salmon", "tuna",
                        "shrimp", "prawn", "anchovy", "anchovies"}

        if any(w in question for w in ["veg ", "vegan", "vegetarian", "plant-based", "meatless"]):
            if any(meat in recipe_text for meat in meat_keywords):
                return False

        # If user asks for non-veg/meat dishes, require meat
        if any(w in question for w in ["non-veg", "meat", "chicken", "beef", "pork",
                                        "fish", "seafood", "lamb"]):
            if not any(meat in recipe_text for meat in meat_keywords):
                return False

        # --- Allergen exclusion ---
        allergen_map = {
            "gluten-free": {"flour", "bread", "pasta", "wheat", "barley", "rye"},
            "dairy-free": {"milk", "cream", "butter", "cheese", "yogurt", "parmesan"},
            "nut-free": {"almond", "walnut", "peanut", "cashew", "pecan", "hazelnut"},
            "egg-free": {"egg", "eggs"},
        }
        for diet, allergens in allergen_map.items():
            if diet in question:
                if any(a in recipe_text for a in allergens):
                    return False

        # --- Positive keyword match ---
        # Extract meaningful words from question (ignore common words)
        stop_words = {
            "what", "which", "does", "have", "with", "that", "this", "are",
            "the", "for", "can", "tell", "about", "from", "use", "using",
            "show", "give", "list", "find", "recipe", "recipes", "steps",
            "step", "how", "make", "cook", "instructions", "please", "you",
            "your", "me", "my", "get", "its", "any", "all", "some", "and",
            "or", "is", "in", "a", "an", "to", "of", "do", "i", "want",
            "need", "dish", "meal", "food", "eat", "veg", "vegan", "vegetarian",
            "non-veg", "gluten-free", "dairy-free", "nut-free", "egg-free",
            "plant-based", "meatless",
        }

        keywords = [
            w for w in re.split(r'\W+', question)
            if len(w) > 2 and w not in stop_words
        ]

        # If no meaningful keywords remain after filtering dietary terms,
        # return True — it's a pure dietary filter query (e.g. "veg recipes")
        if not keywords:
            return True

        # Check if ANY keyword matches the recipe
        return any(
            re.search(rf'\b{re.escape(kw)}\b', recipe_text)
            for kw in keywords
        )

    def _answer(
        self,
        question: str,
        recipes: list[dict[str, Any]],
    ) -> tuple[str, str]:
        """Answer a question using ONLY the retrieved recipes as context."""
        try:
            from . import gemini as gemini_mod
            if gemini_mod.is_available():
                prompt = self._build_query_prompt(question, recipes)
                response = gemini_mod.generate_text(prompt)
                if response:
                    return response, "rag_gemini"
        except Exception as exc:
            logger.warning("rag_answer_gemini_failed", extra={"error": str(exc)})

        # Context-aware fallback
        question_lower = question.lower()
        lines = []

        # Detect what the user is asking for
        wants_steps = any(w in question_lower for w in [
            "steps", "instructions", "how to", "how do", "cook", "make", "prepare", "method"
        ])
        wants_ingredients = any(w in question_lower for w in [
            "ingredients", "what do i need", "what does it need", "what's in"
        ])
        # Default — general recipe info

        for r in recipes:
            lines.append(f"### {r.get('title')}")

            if wants_steps:
                instructions = r.get("instructions", [])
                if instructions:
                    lines.append("**Steps:**")
                    for j, step in enumerate(instructions, 1):
                        lines.append(f"{j}. {step}")
                else:
                    lines.append("_No steps available for this recipe._")

            elif wants_ingredients:
                ingredients = r.get("ingredients", [])
                if ingredients:
                    lines.append("**Ingredients:**")
                    for ing in ingredients:
                        lines.append(f"- {ing}")
                else:
                    lines.append("_No ingredients available._")

            else:
                # General — show both
                ingredients = r.get("ingredients", [])
                instructions = r.get("instructions", [])
                if ingredients:
                    lines.append(f"**Ingredients:** {', '.join(str(i) for i in ingredients)}")
                if instructions:
                    lines.append("**Steps:**")
                    for j, step in enumerate(instructions, 1):
                        lines.append(f"{j}. {step}")

            lines.append("")

        return "\n".join(lines), "rag_fallback"

    @staticmethod
    def _build_query_prompt(
        question: str,
        recipes: list[dict[str, Any]],
    ) -> str:
        recipe_summaries = []
        for i, r in enumerate(recipes, 1):
            ingredients = r.get("ingredients", [])
            instructions = r.get("instructions", [])  # ← inside the loop
            recipe_summaries.append(
                f"{i}. **{r.get('title', 'Unknown')}** "
                f"(cuisine: {r.get('cuisine', 'unknown')})\n"
                f"   Ingredients: {', '.join(str(x) for x in ingredients)}\n"
                f"   Steps: {' | '.join(str(s) for s in instructions[:5])}"
            )

        recipes_text = "\n".join(recipe_summaries)

        return f"""You are a recipe assistant for MealMate. The recipes below are FROM our database.

        Answer the user's question using ONLY these recipes. Present your answer clearly and confidently.
        Do NOT say the information is unavailable — if the recipes below contain the answer, provide it directly.
        Only say you cannot answer if the recipes truly contain no relevant information.

    Recipes from our database:

    {recipes_text}

    User question: {question}

    Answer based strictly on the recipes above. Be concise, friendly, and confident.
    If the question is about user profile data (allergies, preferences, account) rather than recipes,
    politely explain that this Q&A only covers recipes in the database and suggest they check their
    Pantry & Preferences page instead."""

    # ------------------------------------------------------------------
    # Private: retrieve
    # ------------------------------------------------------------------

    def _retrieve(self, query_text: str, n_results: int) -> list[dict[str, Any]]:
        """Embed the query and find the closest recipes in ChromaDB."""
        assert self._embedder is not None
        assert self._collection is not None

        query_embedding = self._embedder.encode([query_text]).tolist()
        results = self._collection.query(
            query_embeddings=query_embedding,
            n_results=min(n_results, self._collection.count()),
            include=["metadatas", "distances", "documents"],
        )

        recipes_out = []
        ids = results.get("ids", [[]])[0]
        distances = results.get("distances", [[]])[0]
        metadatas = results.get("metadatas", [[]])[0]

        for rid, dist, meta in zip(ids, distances, metadatas):
            full = self._recipes.get(rid, {})
            recipes_out.append({
                **full,
                "similarity_score": round(1 - dist, 4),  # cosine: distance → similarity
            })

        return recipes_out

    # ------------------------------------------------------------------
    # Private: generate
    # ------------------------------------------------------------------

    def _generate(
        self,
        pantry: list[str],
        dietary_preferences: list[str],
        allergies: list[str],
        recipes: list[dict[str, Any]],
    ) -> tuple[str, str]:
        """
        Augment the retrieved recipes into a prompt and call Gemini.
        Returns (suggestion_text, method_label).
        """
        # Try Gemini first
        try:
            from . import gemini as gemini_mod  # type: ignore
            if gemini_mod.is_available():
                prompt = self._build_prompt(pantry, dietary_preferences, allergies, recipes)
                response = gemini_mod.generate_text(prompt)
                if response:
                    return response, "rag_gemini"
        except Exception as exc:
            logger.warning("rag_gemini_failed", extra={"error": str(exc)})

        # Fallback: return a structured plain-text suggestion from top recipe
        top = recipes[0]
        ingredients = top.get("ingredients", [])
        pantry_set = {p.lower() for p in pantry}
        have = [i for i in ingredients if any(p in str(i).lower() for p in pantry_set)]
        missing = [i for i in ingredients if i not in have]

        lines = [
            f"Based on your pantry, I suggest: **{top.get('title', 'a recipe')}**",
            "",
            f"You have {len(have)} of the required ingredients: {', '.join(str(i) for i in have)}." if have else "",
            f"You'll need to get: {', '.join(str(i) for i in missing)}." if missing else "You have all the ingredients!",
        ]
        if dietary_preferences:
            lines.append(f"This matches your {', '.join(dietary_preferences)} preference.")

        return "\n".join(l for l in lines if l is not None), "rag_fallback"

    @staticmethod
    def _build_prompt(
        pantry: list[str],
        dietary_preferences: list[str],
        allergies: list[str],
        recipes: list[dict[str, Any]],
    ) -> str:
        recipe_summaries = []
        for i, r in enumerate(recipes, 1):
            ingredients = r.get("ingredients", [])
            recipe_summaries.append(
                f"{i}. {r.get('title', 'Unknown')} "
                f"(cuisine: {r.get('cuisine', 'unknown')}, "
                f"ingredients: {', '.join(str(x) for x in ingredients[:10])})"
            )

        recipes_text = "\n".join(recipe_summaries)
        prefs_text = ", ".join(dietary_preferences) if dietary_preferences else "none"
        allergies_text = ", ".join(allergies) if allergies else "none"
        pantry_text = ", ".join(pantry) if pantry else "various items"

        return f"""You are a helpful cooking assistant for MealMate.

The user's pantry contains: {pantry_text}
Dietary preferences: {prefs_text}
Allergies (MUST avoid completely): {allergies_text}

Based on a semantic search of our recipe database, here are the most relevant recipes:

{recipes_text}

Please:
1. Recommend the single best recipe from this list for this user
2. Explain why it matches their pantry and preferences
3. Point out any ingredient substitutions if the user is missing something (e.g. turkey instead of chicken)
4. Confirm it is safe given their allergies
5. Give one quick cooking tip

Be conversational, friendly, and concise (under 150 words)."""


# ---------------------------------------------------------------------------
# Module-level singleton — loaded once at startup via lifespan
# ---------------------------------------------------------------------------

_rag_service: RAGService | None = None


def init_rag(recipes: list[dict[str, Any]]) -> None:
    """Call this from the FastAPI lifespan with the loaded recipe list."""
    global _rag_service
    _rag_service = RAGService(recipes)


@lru_cache(maxsize=None)
def get_rag() -> RAGService | None:
    return _rag_service
