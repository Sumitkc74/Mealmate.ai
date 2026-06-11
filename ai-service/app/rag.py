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
        top_k: int = 3,
    ) -> dict[str, Any]:
        """Answer a question strictly using recipes pulled from the vector database."""
        if not self._available:
            return {"success": False, "answer": "RAG service is unavailable.", "recipes": []}

        if self._collection.count() == 0:
            return {"success": True, "answer": "No recipes in the database yet.", "recipes": []}

        question_lower = question.lower().strip()

        # 1. Gather a list of all recipe titles currently in the database for checking
        all_titles = [r.get("title", "") for r in self._recipes.values()]
        all_titles_lower = [t.lower() for t in all_titles]

        # ------------------------------------------------------------------
        # 2. ORCHESTRATE SEARCH RETRIEVAL SCALE
        # ------------------------------------------------------------------
        broad_triggers = ["all", "list", "recipes", "database", "what do you have", "everything", "vegan", "vegetarian"]
        is_broad_query = any(w in question_lower for w in broad_triggers)

        # Check for an EXACT title match first
        exact_match_recipe = None
        if question_lower in all_titles_lower:
            idx = all_titles_lower.index(question_lower)
            exact_match_title = all_titles[idx]
            # Find the full recipe dict from our stored dictionary
            for r in self._recipes.values():
                if r.get("title") == exact_match_title:
                    exact_match_recipe = r
                    break

        if exact_match_recipe:
            # FIX: If it's an exact match, ONLY pass this single recipe to Gemini!
            retrieved_recipes = [exact_match_recipe]
        else:
            # Otherwise, use standard semantic vector retrieval
            n_results = self._collection.count() if is_broad_query else top_k
            retrieved_recipes = self._retrieve(question, n_results=n_results)

        # ------------------------------------------------------------------
        # 3. SMART KEYWORD FILTERING & INGREDIENT SNIFFING
        # ------------------------------------------------------------------
        has_partial_ingredient_match = False
        matched_ingredient_name = ""

        if retrieved_recipes and not is_broad_query and not exact_match_recipe:
            stop_words = {"how", "to", "cook", "make", "recipe", "for", "steps", "instructions", "give", "me", "show", "what", "can", "i", "with", "curry", "dishes", "dish"}
            search_keywords = [w for w in question_lower.split() if w not in stop_words and len(w) > 2]

            if search_keywords:
                filtered_matches = []
                for r in retrieved_recipes:
                    title = r.get("title", "").lower()

                    raw_ingredients = r.get("ingredients", [])
                    ingredients = [str(i).lower() for i in raw_ingredients] if isinstance(raw_ingredients, list) else [str(raw_ingredients).lower()]

                    # Check if keyword matches title or ingredients
                    keyword_in_title = any(kw in title for kw in search_keywords)
                    keyword_in_ingredients = False

                    for kw in search_keywords:
                        for ing in ingredients:
                            if kw in ing:
                                keyword_in_ingredients = True
                                matched_ingredient_name = kw
                                break

                    if keyword_in_title or keyword_in_ingredients:
                        filtered_matches.append(r)
                        if keyword_in_ingredients and not keyword_in_title:
                            has_partial_ingredient_match = True

                retrieved_recipes = filtered_matches

        # Create a clean, comma-separated list of what we actually have in the database for Gemini to use
        available_recipes_str = ", ".join(all_titles)

        # If absolutely nothing matches, return the conversational indicator string showing what IS available
        if not retrieved_recipes:
            return {
                "success": True,
                "answer": f"Our database doesn't have any recipes matching your query. The recipes we currently have are: {available_recipes_str}.",
                "recipes": [],
                "method": "rag_rejected"
            }

        # ------------------------------------------------------------------
        # 4. CALL GEMINI WITH REWRITTEN NON-MATCH & INGREDIENT INDICATORS
        # ------------------------------------------------------------------
        try:
            from . import gemini as gemini_mod
            if gemini_mod.is_available():

                context_str = ""
                for r in retrieved_recipes:
                    raw_inst = r.get("instructions") or r.get("steps") or []
                    inst_str = " ".join(raw_inst) if isinstance(raw_inst, list) else str(raw_inst)
                    raw_ing = r.get("ingredients") or []
                    ing_str = ", ".join(raw_ing) if isinstance(raw_ing, list) else str(raw_ing)

                    context_str += f"Recipe: {r.get('title')}\n"
                    context_str += f"Ingredients: {ing_str}\n"
                    context_str += f"Instructions: {inst_str}\n\n"

                system_instruction = (
                    "You are a strict database assistant for MealMate.\n"
                    f"The total available recipes physically stored in our database are: {available_recipes_str}.\n\n"
                    "CRITICAL VISUAL & CONTENT RULES:\n"
                    "1. Unless the user explicitly asks for 'ingredients', 'steps', 'instructions', or 'how to make/cook', you MUST ONLY output the titles/names of the recipes. Do not print ingredients or steps unless explicitly asked.\n"
                    f"2. PARTIAL INGREDIENT MATCH RULE: If the user asked for a specific dish (like 'Chickpea Curry') that is NOT in the database, but one of the context recipes contains that ingredient (like chickpeas in Chicken Biryani), you MUST state: 'That specific recipe is not present in our database. However, the recipe [Insert Recipe Title] contains [Insert Ingredient Name].' Then ask if they want the steps for that recipe.\n"
                    f"3. ABSOLUTE NON-MATCH RULE: If the query does not match anything in the context at all, you MUST say: 'Our database doesn't have any recipes matching your query. The recipes we currently have are: {available_recipes_str}.'\n"
                    "4. TITLES SUPERSEDE INGREDIENTS: If a recipe has a meat keyword (chicken, pork, beef, bacon) in its TITLE, you are forbidden from calling it vegetarian or vegan under any circumstance.\n"
                    "5. Do not hallucinate or guess outside the provided context."
                )

                # Append custom helper flags to guide the LLM's logic paths dynamically
                user_prompt = f"Context Recipes:\n{context_str}\n"
                if has_partial_ingredient_match:
                    user_prompt += f"Note: The user's exact requested dish is missing, but a recipe contains the ingredient: '{matched_ingredient_name}'.\n"
                user_prompt += f"User Question: {question}"

                response = gemini_mod.generate_text(user=user_prompt, system=system_instruction)

                if response:
                    return {
                        "success": True,
                        "answer": response.strip(),
                        "recipes": retrieved_recipes,
                        "method": "rag_gemini"
                    }
        except Exception as exc:
            logger.error(f"Gemini RAG generation failed: {exc}", exc_info=True)

        # ------------------------------------------------------------------
        # 5. SMART CONTEXT-AWARE FALLBACK
        # ------------------------------------------------------------------
        wants_steps = any(w in question_lower for w in ["steps", "instructions", "how to", "cook", "make"])
        wants_ingredients = any(w in question_lower for w in ["ingredients", "need", "contains", "what's in"])

        lines = []
        if is_broad_query:
            lines.append(f"The recipes we currently have are: {available_recipes_str}.")
        elif has_partial_ingredient_match:
            lines.append(f"That specific recipe is not present in our database. However, these recipes contain your ingredient:")
        else:
            lines.append("I found the following matching recipes:")

        for r in retrieved_recipes:
            lines.append(f"\n### {r.get('title')}")
            raw_ing = r.get("ingredients") or []
            ing_list_str = ", ".join(str(i) for i in raw_ing) if isinstance(raw_ing, list) else str(raw_ing)

            if wants_ingredients:
                lines.append(f"**Ingredients:** {ing_list_str}")
            if wants_steps:
                lines.append("**Steps:**")
                raw_inst = r.get("instructions") or r.get("steps") or []
                if isinstance(raw_inst, list):
                    for j, step in enumerate(raw_inst, 1):
                        lines.append(f"{j}. {step}")
                else:
                    lines.append(str(raw_inst))

        return {
            "success": True,
            "answer": "\n".join(lines),
            "recipes": retrieved_recipes,
            "method": "rag_fallback"
        }

    def _answer(
        self,
        question: str,
        recipes: list[dict[str, Any]],
    ) -> tuple[str, str]:
        """Answer a question using ONLY the retrieved recipes as context."""
        try:
            from . import gemini as gemini_mod
            if gemini_mod.is_available():
                # Build the complete text context containing the matching recipes
                prompt = self._build_query_prompt(question, recipes)

                # Forward to the updated positional generate_text endpoint layout
                response = gemini_mod.generate_text(prompt)

                if response:
                    return response, "rag_gemini"
        except Exception as exc:
            logger.warning("rag_answer_gemini_failed", extra={"error": str(exc)})

        # Context-aware fallback loop (runs when Gemini module fails or is unavailable)
        question_lower = question.lower()
        lines = []

        wants_steps = any(w in question_lower for w in [
            "steps", "instructions", "how to", "how do", "cook", "make", "prepare", "method"
        ])
        wants_ingredients = any(w in question_lower for w in [
            "ingredients", "what do i need", "what does it need", "what's in"
        ])

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

    # def _answer(
    #     self,
    #     question: str,
    #     recipes: list[dict[str, Any]],
    # ) -> tuple[str, str]:
    #     """Answer a question using ONLY the retrieved recipes as context."""
    #     try:
    #         from . import gemini as gemini_mod
    #         if gemini_mod.is_available():
    #             prompt = self._build_query_prompt(question, recipes)
    #             response = gemini_mod.generate_text(prompt)
    #             if response:
    #                 return response, "rag_gemini"
    #     except Exception as exc:
    #         logger.warning("rag_answer_gemini_failed", extra={"error": str(exc)})

    #     # Context-aware fallback
    #     question_lower = question.lower()
    #     lines = []

    #     # Detect what the user is asking for
    #     wants_steps = any(w in question_lower for w in [
    #         "steps", "instructions", "how to", "how do", "cook", "make", "prepare", "method"
    #     ])
    #     wants_ingredients = any(w in question_lower for w in [
    #         "ingredients", "what do i need", "what does it need", "what's in"
    #     ])
    #     # Default — general recipe info

    #     for r in recipes:
    #         lines.append(f"### {r.get('title')}")

    #         if wants_steps:
    #             instructions = r.get("instructions", [])
    #             if instructions:
    #                 lines.append("**Steps:**")
    #                 for j, step in enumerate(instructions, 1):
    #                     lines.append(f"{j}. {step}")
    #             else:
    #                 lines.append("_No steps available for this recipe._")

    #         elif wants_ingredients:
    #             ingredients = r.get("ingredients", [])
    #             if ingredients:
    #                 lines.append("**Ingredients:**")
    #                 for ing in ingredients:
    #                     lines.append(f"- {ing}")
    #             else:
    #                 lines.append("_No ingredients available._")

    #         else:
    #             # General — show both
    #             ingredients = r.get("ingredients", [])
    #             instructions = r.get("instructions", [])
    #             if ingredients:
    #                 lines.append(f"**Ingredients:** {', '.join(str(i) for i in ingredients)}")
    #             if instructions:
    #                 lines.append("**Steps:**")
    #                 for j, step in enumerate(instructions, 1):
    #                     lines.append(f"{j}. {step}")

    #         lines.append("")

    #     return "\n".join(lines), "rag_fallback"

    @staticmethod
    def _build_query_prompt(
        question: str,
        recipes: list[dict[str, Any]],
    ) -> str:
        recipe_summaries = []
        for i, r in enumerate(recipes, 1):
            ingredients = r.get("ingredients", [])
            instructions = r.get("instructions", [])
            recipe_summaries.append(
                f"{i}. **{r.get('title', 'Unknown')}** "
                f"(cuisine: {r.get('cuisine', 'unknown')})\n"
                f"   Ingredients: {', '.join(str(x) for x in ingredients)}\n"
                f"   Steps: {' | '.join(str(s) for s in instructions[:5])}"
            )

        recipes_text = "\n\n".join(recipe_summaries)

        return f"""You are a conversational culinary assistant for MealMate.
The recipes provided below are extracted directly from our local database.

Instructions:
1. Answer the user's question friendly and naturally using the provided recipes.
2. If the user asks for "vegan" or "vegetarian" options, analyze the ingredient compositions. If a recipe uses plant-based alternatives (like plant-based yogurt, chickpeas, mushrooms) instead of real meat, highlight it as a viable option!
3. If the user asks a broad question like "What recipes are in the database?", summarize and list the titles of the available options nicely.
4. Keep answers concise, helpful, and strictly tied to these recipes.

Recipes from our database:
{recipes_text}

User question: {question}

Answer:"""

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
