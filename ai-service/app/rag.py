"""
RAG-based recipe suggester and question-answering assistant.

Pipeline:
  1. INDEX   — embed all recipes into ChromaDB (at startup / via /rag/index)
  2. FILTER  — hard-remove any recipe containing user allergens & filter dietary preferences
  3. RETRIEVE— semantic vector search using pantry items or query text
  4. AUGMENT — pack retrieved recipes + user context into a structured Gemini prompt
  5. GENERATE— Gemini returns natural-language suggestions/answers with reasoning

Falls back gracefully to ranked retrieval / structured synthesis when Gemini is unavailable.
"""

from __future__ import annotations

import json
import logging
import os
import re
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

MEAT_KEYWORDS = {
    "chicken", "beef", "pork", "bacon", "turkey", "lamb", "steak",
    "ham", "veal", "prosciutto", "pancetta", "sausage", "pepperoni",
    "duck", "venison", "meat",
}

FISH_KEYWORDS = {
    "salmon", "tuna", "shrimp", "fish", "cod", "tilapia", "crab",
    "lobster", "anchovy", "halibut", "trout", "prawn", "squid", "scallop",
}

DAIRY_EGG_KEYWORDS = {
    "egg", "eggs", "milk", "cheese", "butter", "yogurt", "cream",
    "honey", "parmesan", "feta", "mozzarella", "cheddar", "ghee",
}


def _extract_ingredient_names(recipe: dict[str, Any]) -> list[str]:
    """Extract a flat list of lowercase ingredient name strings from a recipe dict."""
    raw = recipe.get("ingredients", [])
    if not isinstance(raw, list):
        return [str(raw).lower().strip()] if raw else []

    names: list[str] = []
    for item in raw:
        if isinstance(item, dict):
            name = item.get("name") or item.get("ingredient") or ""
            if name:
                names.append(str(name).lower().strip())
        elif item:
            names.append(str(item).lower().strip())
    return names


def _recipe_to_text(recipe: dict[str, Any]) -> str:
    """Convert a recipe dict to a single rich string suitable for embedding."""
    parts: list[str] = []
    title = str(recipe.get("title") or "").strip()
    if title:
        parts.append(title)

    cuisine = str(recipe.get("cuisine") or "").strip()
    if cuisine:
        parts.append(f"cuisine: {cuisine}")

    ingredients = _extract_ingredient_names(recipe)
    if ingredients:
        parts.append("ingredients: " + ", ".join(ingredients))

    tags = recipe.get("tags", [])
    if isinstance(tags, list) and tags:
        clean_tags = [str(t).strip() for t in tags if str(t).strip()]
        if clean_tags:
            parts.append("tags: " + ", ".join(clean_tags))

    instructions = recipe.get("instructions", [])
    if isinstance(instructions, list) and instructions:
        clean_steps = [str(s).strip() for s in instructions if str(s).strip()]
        if clean_steps:
            parts.append("instructions: " + " | ".join(clean_steps))

    return ". ".join(p for p in parts if p)


def _contains_allergen(recipe: dict[str, Any], allergies: list[str]) -> bool:
    """Return True if any allergen keyword appears in the recipe title or ingredients."""
    clean_allergies = [a.lower().strip() for a in allergies if a and a.strip()]
    if not clean_allergies:
        return False

    rid = str(recipe.get("id") or recipe.get("recipe_id") or "").lower()
    title = str(recipe.get("title", "")).lower()
    ingredients = _extract_ingredient_names(recipe)
    check_texts = [rid, title] + ingredients

    for allergen in clean_allergies:
        for text in check_texts:
            if allergen in text:
                return True
    return False


def _is_vegetarian(recipe: dict[str, Any]) -> bool:
    tags = [str(t).lower() for t in recipe.get("tags", [])]
    if "vegetarian" in tags or "vegan" in tags:
        return True
    title = str(recipe.get("title", "")).lower()
    ingredients = _extract_ingredient_names(recipe)
    for meat in MEAT_KEYWORDS | FISH_KEYWORDS:
        if meat in title or any(meat in ing for ing in ingredients):
            return False
    return True


def _is_vegan(recipe: dict[str, Any]) -> bool:
    tags = [str(t).lower() for t in recipe.get("tags", [])]
    if "vegan" in tags:
        return True
    if not _is_vegetarian(recipe):
        return False
    title = str(recipe.get("title", "")).lower()
    ingredients = _extract_ingredient_names(recipe)
    for de in DAIRY_EGG_KEYWORDS:
        if de in title or any(de in ing for ing in ingredients):
            return False
    return True


# ---------------------------------------------------------------------------
# RAGService
# ---------------------------------------------------------------------------


class RAGService:
    """Singleton that owns the ChromaDB collection and sentence-transformers model."""

    COLLECTION_NAME = "mealmate_recipes"
    EMBED_MODEL = "all-MiniLM-L6-v2"

    def __init__(self, recipes: list[dict[str, Any]] | None = None):
        self._recipes: dict[str, dict[str, Any]] = {}
        self._available = False
        self._chroma_client = None
        self._collection = None
        self._embedder = None
        self._setup(recipes or [])

    # ------------------------------------------------------------------
    # Setup & Indexing
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

            # Chroma client: Persistent if CHROMA_PERSIST_DIR is configured, else in-memory
            persist_dir = os.environ.get("CHROMA_PERSIST_DIR", "").strip()
            if persist_dir:
                self._chroma_client = chromadb.PersistentClient(path=persist_dir)
            else:
                self._chroma_client = chromadb.Client()
                try:
                    self._chroma_client.delete_collection(self.COLLECTION_NAME)
                except Exception:
                    pass

            self._collection = self._chroma_client.get_or_create_collection(
                name=self.COLLECTION_NAME,
                metadata={"hnsw:space": "cosine"},
            )

            if recipes:
                self._index_recipes(recipes)

            self._available = True
            logger.info("rag_setup_complete", extra={"indexed": self._collection.count()})
        except Exception as exc:
            logger.error("rag_setup_failed", extra={"error": str(exc)})
            self._available = False

    def _index_recipes(self, recipes: list[dict[str, Any]]) -> None:
        """Embed and store all recipes in ChromaDB using upsert."""
        if not recipes:
            return
        assert self._embedder is not None
        assert self._collection is not None

        valid_recipes: list[dict[str, Any]] = []
        for r in recipes:
            rid = str(r.get("id") or r.get("recipe_id") or r.get("_id") or "")
            if rid:
                r["id"] = rid
                self._recipes[rid] = r
                valid_recipes.append(r)

        if not valid_recipes:
            return

        texts = [_recipe_to_text(r) for r in valid_recipes]
        embeddings = self._embedder.encode(texts, show_progress_bar=False).tolist()

        self._collection.upsert(
            ids=[r["id"] for r in valid_recipes],
            embeddings=embeddings,
            documents=texts,
            metadatas=[
                {
                    "title": str(r.get("title", "")),
                    "cuisine": str(r.get("cuisine", "")),
                    "tags": json.dumps(r.get("tags", [])),
                    "ingredients": json.dumps(_extract_ingredient_names(r)),
                }
                for r in valid_recipes
            ],
        )

    def upsert_recipes(self, recipes: list[dict[str, Any]]) -> int:
        """Incrementally embed and upsert recipes into ChromaDB without re-embedding unchanged items."""
        if not self._available or self._collection is None or self._embedder is None:
            return 0
        if not recipes:
            return 0

        to_embed: list[dict[str, Any]] = []
        texts: list[str] = []
        for r in recipes:
            rid = str(r.get("id") or r.get("recipe_id") or r.get("_id") or "")
            if not rid:
                continue
            r["id"] = rid
            new_text = _recipe_to_text(r)
            existing = self._recipes.get(rid)
            if existing is not None and _recipe_to_text(existing) == new_text:
                continue
            self._recipes[rid] = r
            to_embed.append(r)
            texts.append(new_text)

        if not to_embed:
            return 0

        embeddings = self._embedder.encode(texts, show_progress_bar=False).tolist()
        self._collection.upsert(
            ids=[r["id"] for r in to_embed],
            embeddings=embeddings,
            documents=texts,
            metadatas=[
                {
                    "title": str(r.get("title", "")),
                    "cuisine": str(r.get("cuisine", "")),
                    "tags": json.dumps(r.get("tags", [])),
                    "ingredients": json.dumps(_extract_ingredient_names(r)),
                }
                for r in to_embed
            ],
        )
        logger.info("rag_upserted", extra={"upserted": len(to_embed), "total": len(self._recipes)})
        return len(to_embed)

    def reindex(self, recipes: list[dict[str, Any]], *, incremental: bool = True) -> int:
        """Replace or incrementally update the ChromaDB collection with a fresh recipe set."""
        if not self._available or self._chroma_client is None:
            return 0
        try:
            if not incremental:
                try:
                    self._chroma_client.delete_collection(self.COLLECTION_NAME)
                except Exception:
                    pass

                self._collection = self._chroma_client.get_or_create_collection(
                    name=self.COLLECTION_NAME,
                    metadata={"hnsw:space": "cosine"},
                )
                self._recipes = {}
                if recipes:
                    self._index_recipes(recipes)
            else:
                self.upsert_recipes(recipes)
            logger.info("rag_reindexed", extra={"count": len(recipes), "incremental": incremental})
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
        dietary_preferences: list[str] | None = None,
        allergies: list[str] | None = None,
        top_k: int = 5,
    ) -> dict[str, Any]:
        """
        Full RAG pipeline:
          retrieve -> filter allergens & preferences -> augment prompt -> generate with Gemini.
        Returns a dict with keys: success, suggestion, recipes, method.
        """
        if not self._available or self._collection is None:
            return {
                "success": False,
                "suggestion": "RAG service is unavailable. Install chromadb and sentence-transformers.",
                "recipes": [],
                "method": "unavailable",
            }

        if self._collection.count() == 0:
            return {
                "success": False,
                "suggestion": "No recipes in the database yet.",
                "recipes": [],
                "method": "rag_empty",
            }

        clean_pantry = [p.strip() for p in (pantry or []) if p.strip()]
        clean_prefs = [d.strip() for d in (dietary_preferences or []) if d.strip()]
        clean_allergies = [a.strip() for a in (allergies or []) if a.strip()]

        # 1. Build semantic query from pantry + preferences
        query_parts: list[str] = []
        if clean_pantry:
            query_parts.append("I have these ingredients: " + ", ".join(clean_pantry))
        if clean_prefs:
            query_parts.append("dietary preferences: " + ", ".join(clean_prefs))
        if clean_allergies:
            query_parts.append("allergies (must avoid): " + ", ".join(clean_allergies))

        query_text = ". ".join(query_parts) if query_parts else "healthy delicious recipe"

        # 2. Retrieve candidates from ChromaDB (fetch extra for filtering)
        n_fetch = max(top_k * 3, 10)
        retrieved = self._retrieve(query_text, n_results=n_fetch)

        # 3. Hard-filter allergens
        safe_recipes = [r for r in retrieved if not _contains_allergen(r, clean_allergies)]

        # Filter dietary preferences
        pref_lower = [p.lower() for p in clean_prefs]
        if "vegan" in pref_lower:
            safe_recipes = [r for r in safe_recipes if _is_vegan(r)]
        elif "vegetarian" in pref_lower:
            safe_recipes = [r for r in safe_recipes if _is_vegetarian(r)]

        safe_recipes = safe_recipes[:top_k]

        if not safe_recipes:
            return {
                "success": False,
                "suggestion": "No safe recipes found matching your pantry and dietary restrictions.",
                "recipes": [],
                "method": "rag_no_results",
            }

        # 4. Generate recommendation with Gemini or deterministic fallback
        suggestion, method = self._generate(
            pantry=clean_pantry,
            dietary_preferences=clean_prefs,
            allergies=clean_allergies,
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
        """Answer a question strictly using recipes pulled from the vector database."""
        if not self._available or self._collection is None:
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

        question_lower = question.lower().strip()
        clean_q = re.sub(r"[^a-z0-9 ]+", " ", question_lower).strip()
        q_tokens = [w for w in clean_q.split() if w]

        all_titles = [r.get("title", "") for r in self._recipes.values() if r.get("title")]
        available_recipes_str = ", ".join(all_titles)

        # ------------------------------------------------------------------
        # 1. CATALOGUE / BROAD QUERY CHECK (Whole word / phrase matching)
        # ------------------------------------------------------------------
        broad_patterns = [
            r"\b(all recipes|list recipes|what recipes|what do you have|browse recipes|show recipes|show all|list all|everything in)\b",
            r"\bwhat('?s| is) in the database\b",
        ]
        is_broad_query = any(re.search(pat, question_lower) for pat in broad_patterns) or (
            "recipes" in q_tokens and ("all" in q_tokens or "list" in q_tokens or "every" in q_tokens)
        )

        # ------------------------------------------------------------------
        # 2. EXACT OR PARTIAL TITLE MATCH CHECK
        # ------------------------------------------------------------------
        exact_match_recipe: dict[str, Any] | None = None
        for r in self._recipes.values():
            rtitle = str(r.get("title", "")).lower().strip()
            if not rtitle:
                continue
            # Verbatim exact match or title completely contained in clean question
            if rtitle == clean_q or (len(rtitle) > 4 and rtitle in clean_q):
                exact_match_recipe = r
                break

        # ------------------------------------------------------------------
        # 3. RETRIEVAL
        # ------------------------------------------------------------------
        if exact_match_recipe:
            retrieved_recipes = [dict(exact_match_recipe)]
        elif is_broad_query:
            retrieved_recipes = list(self._recipes.values())
        else:
            # Semantic search
            n_results = max(top_k * 2, 6)
            retrieved_recipes = self._retrieve(question, n_results=n_results)

        # ------------------------------------------------------------------
        # 4. KEYWORD & INGREDIENT RELEVANCE CHECK
        # ------------------------------------------------------------------
        has_partial_ingredient_match = False
        matched_ingredient_name = ""

        if retrieved_recipes and not is_broad_query and not exact_match_recipe:
            stop_words = {
                "how", "to", "cook", "make", "recipe", "recipes", "for", "steps",
                "instructions", "give", "me", "show", "what", "can", "i", "with",
                "any", "the", "a", "an", "do", "you", "have", "please", "tell",
                "about", "some", "good", "best", "want", "like", "need",
            }
            search_keywords = [w for w in q_tokens if w not in stop_words and len(w) > 2]

            if search_keywords:
                matched_items: list[dict[str, Any]] = []
                for r in retrieved_recipes:
                    title = str(r.get("title", "")).lower()
                    cuisine = str(r.get("cuisine", "")).lower()
                    tags = [str(t).lower() for t in r.get("tags", [])]
                    ingredients = _extract_ingredient_names(r)

                    keyword_in_title = False
                    keyword_in_meta = False
                    keyword_in_ingredients = False

                    for kw in search_keywords:
                        kw_stem = kw.rstrip("s") if len(kw) > 3 else kw

                        if kw in title or kw_stem in title:
                            keyword_in_title = True
                        if kw in cuisine or kw_stem in cuisine or any(kw in t or kw_stem in t for t in tags):
                            keyword_in_meta = True

                        for ing in ingredients:
                            ing_stem = ing.rstrip("s") if len(ing) > 3 else ing
                            if (
                                kw in ing
                                or ing in kw
                                or kw_stem in ing
                                or ing_stem in kw
                            ):
                                keyword_in_ingredients = True
                                matched_ingredient_name = kw
                                break

                    if keyword_in_title or keyword_in_meta or keyword_in_ingredients:
                        matched_items.append(r)
                        if keyword_in_ingredients and not keyword_in_title:
                            has_partial_ingredient_match = True

                # If we found direct keyword/cuisine/ingredient matches among retrieved items, prioritize them
                if matched_items:
                    retrieved_recipes = matched_items
                else:
                    # Check if top semantic results have strong similarity (> 0.40)
                    strong_semantic = [
                        r for r in retrieved_recipes if r.get("similarity_score", 0.0) >= 0.40
                    ]
                    if strong_semantic:
                        retrieved_recipes = strong_semantic
                    else:
                        # Nothing in context actually matched the query
                        retrieved_recipes = []

        retrieved_recipes = retrieved_recipes[:top_k]

        # ------------------------------------------------------------------
        # 5. REJECTION HANDLING
        # ------------------------------------------------------------------
        if not retrieved_recipes:
            return {
                "success": True,
                "answer": (
                    "Our database doesn't have any recipes matching your query. "
                    f"The recipes we currently have are: {available_recipes_str}."
                ),
                "recipes": [],
                "method": "rag_rejected",
            }

        # ------------------------------------------------------------------
        # 6. CALL GEMINI IF AVAILABLE
        # ------------------------------------------------------------------
        try:
            from . import gemini as gemini_mod

            if gemini_mod.is_available():
                context_str = ""
                for r in retrieved_recipes:
                    raw_inst = r.get("instructions") or []
                    inst_str = (
                        " | ".join(str(s) for s in raw_inst)
                        if isinstance(raw_inst, list)
                        else str(raw_inst)
                    )
                    raw_ing = _extract_ingredient_names(r)
                    ing_str = ", ".join(raw_ing)

                    context_str += f"Recipe: {r.get('title')}\n"
                    if r.get("cuisine"):
                        context_str += f"Cuisine: {r.get('cuisine')}\n"
                    context_str += f"Ingredients: {ing_str}\n"
                    if inst_str:
                        context_str += f"Instructions: {inst_str}\n"
                    context_str += "\n"

                system_instruction = (
                    "You are a strict recipe assistant for MealMate.\n"
                    f"Available recipes in database: {available_recipes_str}.\n\n"
                    "CRITICAL VISUAL & CONTENT RULES:\n"
                    "1. Unless the user explicitly asks for 'ingredients', 'steps', 'instructions', or 'how to make/cook', output the titles and a brief 1-sentence summary. Do not dump the entire step list unless explicitly asked.\n"
                    "2. PARTIAL INGREDIENT MATCH: If the user asked for a specific dish not in the database, but a context recipe contains that ingredient, state: "
                    "'That specific recipe is not present in our database. However, the recipe [Title] contains [Ingredient].' Then offer the steps.\n"
                    "3. TITLES SUPERSEDE INGREDIENTS: If a recipe has a meat keyword (chicken, beef, pork, bacon, fish) in its title or ingredients, you are forbidden from calling it vegetarian or vegan under any circumstance.\n"
                    "4. Stay strictly grounded in the provided context recipes. Do not hallucinate external recipes."
                )

                user_prompt = f"Context Recipes:\n{context_str}\n"
                if has_partial_ingredient_match:
                    user_prompt += (
                        f"Note: The exact requested dish is missing, but a recipe contains: '{matched_ingredient_name}'.\n"
                    )
                user_prompt += f"User Question: {question}"

                response = gemini_mod.generate_text(user=user_prompt, system=system_instruction)
                if response:
                    return {
                        "success": True,
                        "answer": response.strip(),
                        "recipes": retrieved_recipes,
                        "method": "rag_gemini",
                    }
        except Exception as exc:
            logger.warning("rag_gemini_query_failed", extra={"error": str(exc)})

        # ------------------------------------------------------------------
        # 7. CONTEXT-AWARE FALLBACK SYNTHESIS
        # ------------------------------------------------------------------
        wants_steps = any(
            w in question_lower
            for w in ["steps", "instructions", "how to", "cook", "make", "prepare", "method"]
        )
        wants_ingredients = any(
            w in question_lower
            for w in ["ingredients", "need", "contains", "what's in", "what do i need"]
        )

        lines: list[str] = []
        if is_broad_query:
            lines.append(f"The recipes we currently have are: {available_recipes_str}.")
        elif has_partial_ingredient_match:
            lines.append(
                "That specific recipe is not present in our database. However, these recipes contain your ingredient:"
            )
        else:
            lines.append("I found the following matching recipes:")

        for r in retrieved_recipes:
            lines.append(f"\n### {r.get('title')}")
            cuisine = r.get("cuisine")
            if cuisine:
                lines.append(f"*Cuisine: {cuisine}*")

            raw_ing = _extract_ingredient_names(r)
            ing_list_str = ", ".join(raw_ing)

            if wants_ingredients or not wants_steps:
                lines.append(f"**Ingredients:** {ing_list_str}")

            if wants_steps:
                lines.append("**Steps:**")
                raw_inst = r.get("instructions") or []
                if isinstance(raw_inst, list) and raw_inst:
                    for j, step in enumerate(raw_inst, 1):
                        lines.append(f"{j}. {step}")
                elif raw_inst:
                    lines.append(str(raw_inst))
                else:
                    lines.append("_Steps not recorded for this recipe._")

        return {
            "success": True,
            "answer": "\n".join(lines),
            "recipes": retrieved_recipes,
            "method": "rag_fallback",
        }

    # ------------------------------------------------------------------
    # Private Helpers
    # ------------------------------------------------------------------

    def _retrieve(self, query_text: str, n_results: int) -> list[dict[str, Any]]:
        """Embed the query and find closest recipes in ChromaDB."""
        if not self._available or self._collection is None or self._embedder is None:
            return []
        count = self._collection.count()
        if count == 0 or n_results <= 0:
            return []

        limit = min(n_results, count)
        query_embedding = self._embedder.encode([query_text]).tolist()
        results = self._collection.query(
            query_embeddings=query_embedding,
            n_results=limit,
            include=["metadatas", "distances", "documents"],
        )

        recipes_out: list[dict[str, Any]] = []
        ids = results.get("ids", [[]])[0] if results.get("ids") else []
        distances = results.get("distances", [[]])[0] if results.get("distances") else []
        metas = results.get("metadatas", [[]])[0] if results.get("metadatas") else []

        for i, (rid, dist) in enumerate(zip(ids, distances)):
            full = dict(self._recipes.get(rid, {}))
            if not full:
                meta = metas[i] if i < len(metas) and isinstance(metas[i], dict) else {}
                full = {
                    "id": rid,
                    "title": str(meta.get("title", "")),
                    "cuisine": str(meta.get("cuisine", "")),
                    "ingredients": json.loads(str(meta.get("ingredients", "[]"))) if meta.get("ingredients") else [],
                    "tags": json.loads(str(meta.get("tags", "[]"))) if meta.get("tags") else [],
                }
            full["similarity_score"] = round(max(0.0, 1.0 - dist), 4)
            recipes_out.append(full)

        return recipes_out

    def _generate(
        self,
        pantry: list[str],
        dietary_preferences: list[str],
        allergies: list[str],
        recipes: list[dict[str, Any]],
    ) -> tuple[str, str]:
        """Call Gemini to generate a natural suggestion or fall back to structured text."""
        try:
            from . import gemini as gemini_mod

            if gemini_mod.is_available():
                prompt = self._build_prompt(pantry, dietary_preferences, allergies, recipes)
                system_prompt = (
                    "You are a helpful cooking assistant for MealMate. "
                    "Recommend the best recipe matching the user's pantry and restrictions concisely."
                )
                response = gemini_mod.generate_text(user=prompt, system=system_prompt)
                if response:
                    return response.strip(), "rag_gemini"
        except Exception as exc:
            logger.warning("rag_gemini_suggest_failed", extra={"error": str(exc)})

        # Fallback: structured plain-text suggestion
        top = recipes[0]
        ingredients = _extract_ingredient_names(top)
        pantry_set = {p.lower() for p in pantry}
        have = [i for i in ingredients if any(p in i or i in p for p in pantry_set)]
        missing = [i for i in ingredients if i not in have]

        lines = [
            f"Based on your pantry, I suggest: **{top.get('title', 'a recipe')}**",
            "",
            f"You have {len(have)} of the required ingredients: {', '.join(have)}."
            if have
            else "",
            f"You'll need to get: {', '.join(missing)}."
            if missing
            else "You have all the ingredients!",
        ]
        if dietary_preferences:
            lines.append(f"This matches your {', '.join(dietary_preferences)} preference.")

        return "\n".join(l for l in lines if l), "rag_fallback"

    @staticmethod
    def _build_prompt(
        pantry: list[str],
        dietary_preferences: list[str],
        allergies: list[str],
        recipes: list[dict[str, Any]],
    ) -> str:
        recipe_summaries: list[str] = []
        for i, r in enumerate(recipes, 1):
            ingredients = _extract_ingredient_names(r)
            recipe_summaries.append(
                f"{i}. {r.get('title', 'Unknown')} "
                f"(cuisine: {r.get('cuisine', 'unknown')}, "
                f"ingredients: {', '.join(ingredients[:10])})"
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
3. Point out any ingredient substitutions if the user is missing something
4. Confirm it is safe given their allergies
5. Give one quick cooking tip

Be conversational, friendly, and concise (under 150 words)."""


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_rag_service: RAGService | None = None


def init_rag(recipes: list[dict[str, Any]] | None = None) -> RAGService:
    """Initialize the RAG service with the given recipe list."""
    global _rag_service
    _rag_service = RAGService(recipes or [])
    return _rag_service


def get_rag() -> RAGService | None:
    """
    Return the active RAG singleton.
    If uninitialized, attempts lazy initialization from recommender recipes.
    """
    global _rag_service
    if _rag_service is None:
        try:
            from .recommender import get_recommender

            rec = get_recommender()
            recipes = [
                {
                    "id": r.recipe_id,
                    "title": r.title,
                    "cuisine": r.cuisine or "",
                    "ingredients": list(r.ingredients),
                    "tags": list(r.tags),
                }
                for r in rec.recipes
            ]
            init_rag(recipes)
        except Exception as exc:
            logger.warning("rag_auto_init_failed", extra={"error": str(exc)})
    return _rag_service
