"""
RAG-based recipe suggester and question-answering assistant.

Pipeline:
  1. INDEX   — embed all recipes into an in-memory LSA index (at startup / via /rag/index)
  2. FILTER  — hard-remove any recipe containing user allergens & filter dietary preferences
  3. RETRIEVE— semantic vector search using pantry items or query text
  4. AUGMENT — pack retrieved recipes + user context into a structured Gemini prompt
  5. GENERATE— Gemini returns natural-language suggestions/answers with reasoning

Falls back gracefully to ranked retrieval / structured synthesis when Gemini is unavailable.

Why LSA and not sentence-transformers?
--------------------------------------
The previous implementation embedded recipes with ``all-MiniLM-L6-v2`` via
``sentence-transformers`` and stored them in ChromaDB. That pulls in PyTorch
(~1 GB) and OOM-kills the service on Render's free tier (512 MB). The
codebase already ships a scikit-learn LSA embedder (``app/embeddings.py``)
that gives the same semantic signal on a 64-recipe corpus while keeping the
service well under 200 MB, so retrieval now runs on TF-IDF + TruncatedSVD
with a plain TF-IDF cosine fallback for degenerate (single-recipe) corpora.
The public API — ``suggest`` / ``query`` / ``upsert_recipes`` / ``reindex``
and their return shapes — is unchanged.
"""

from __future__ import annotations

import logging
import re
from typing import Any

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from .embeddings import LsaEmbedder
from .knowledge_graph import get_knowledge_graph

logger = logging.getLogger(__name__)


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


# Plant-based milks are NOT dairy milk: a saved "dairy" (or "milk")
# allergy must not block a recipe whose only "milk" is a plant milk
# ("coconut milk", "almond milk", ...). The "milk" term still matches
# real milk, and a saved "soy" allergy still catches "soy milk"
# because the "soy" term itself matches. Keep this list and rule
# identical in planner.py, recommender.py, recipe_gen.py, rag.py,
# server/src/utils/allergens.ts and client/src/lib/allergens.ts.
# Do not change the 11-group allergen hierarchy.
PLANT_MILK_QUALIFIERS: tuple[str, ...] = (
    "almond", "cashew", "coconut", "flax", "hazelnut", "hemp",
    "macadamia", "oat", "pea", "pecan", "pistachio", "rice",
    "soy", "sunflower", "walnut",
)
_PLANT_MILK_RE = re.compile(
    r"\b(?:" + "|".join(PLANT_MILK_QUALIFIERS) + r")[-\s]+milks?\b"
)


def _strip_plant_milks(text: str) -> str:
    """Remove plant-milk phrases from ``text`` so a bare "milk" match only
    sees real (dairy) milk. A recipe with both plant milk and real milk
    still matches, because only the plant-milk phrase is removed."""
    return _PLANT_MILK_RE.sub(" ", text)


def _term_matches_ingredient(term: str, ingredient: str) -> bool:
    """Substring match of an allergen term against one (lowercased)
    ingredient, except a bare "milk" term never matches a plant milk.
    A saved plural term ("sulfites") also matches its singular form
    ("sulfite"), mirroring the client/server whole-word stemmer — but
    only at a word boundary, so "nuts" -> "nut" does not match inside
    "coconut"."""
    if term == "milk":
        return "milk" in _strip_plant_milks(ingredient)
    if term in ingredient:
        return True
    if term.endswith("s") and len(term) > 3:
        singular = term[:-1]
        return re.search(r"\b" + re.escape(singular) + r"\b", ingredient) is not None
    return False


def _contains_allergen(recipe: dict[str, Any], allergies: list[str]) -> bool:
    """Return True if any allergen term appears in the recipe title or ingredients.

    ``allergies`` must already be expanded group terms (e.g. "dairy" ->
    milk, butter, cheese, ...) — callers expand via
    ``get_knowledge_graph().expand_allergens()`` first, mirroring
    ``planner._violates_allergy``. Matching uses
    ``_term_matches_ingredient``, so a bare "milk" term never matches a
    plant milk ("coconut milk")."""
    clean_allergies = [a.lower().strip() for a in allergies if a and a.strip()]
    if not clean_allergies:
        return False

    rid = str(recipe.get("id") or recipe.get("recipe_id") or "").lower()
    title = str(recipe.get("title", "")).lower()
    ingredients = _extract_ingredient_names(recipe)
    check_texts = [rid, title] + ingredients

    for allergen in clean_allergies:
        for text in check_texts:
            if _term_matches_ingredient(allergen, text):
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
    """Singleton that owns the in-memory LSA recipe index."""

    def __init__(self, recipes: list[dict[str, Any]] | None = None):
        self._recipes: dict[str, dict[str, Any]] = {}
        self._ids: list[str] = []
        self._lsa = LsaEmbedder()
        self._tfidf_vectorizer: TfidfVectorizer | None = None
        self._tfidf_matrix = None
        self._available = False
        self._setup(recipes or [])

    # ------------------------------------------------------------------
    # Setup & Indexing
    # ------------------------------------------------------------------

    def _setup(self, recipes: list[dict[str, Any]]) -> None:
        try:
            logger.info("rag_setup_start", extra={"recipe_count": len(recipes)})
            self._index_recipes(recipes)
            self._available = bool(self._recipes)
            logger.info("rag_setup_complete", extra={"indexed": len(self._recipes)})
        except Exception as exc:
            logger.error("rag_setup_failed", extra={"error": str(exc)})
            self._available = False

    def _index_recipes(self, recipes: list[dict[str, Any]]) -> None:
        """Store recipes and (re)fit the LSA index."""
        for r in recipes:
            rid = str(r.get("id") or r.get("recipe_id") or r.get("_id") or "")
            if not rid:
                continue
            r["id"] = rid
            self._recipes[rid] = r
        self._rebuild_index()

    def _rebuild_index(self) -> None:
        """(Re)fit the LSA embedder on the current recipe set."""
        self._ids = list(self._recipes)
        texts = [_recipe_to_text(self._recipes[rid]) for rid in self._ids]
        self._lsa = LsaEmbedder()
        self._tfidf_vectorizer = None
        self._tfidf_matrix = None
        self._available = False
        if not texts:
            return
        try:
            self._lsa.fit(texts)
        except Exception:
            # Degenerate corpus (e.g. a single recipe): TruncatedSVD needs at
            # least 2 documents. Fall back to plain TF-IDF cosine.
            self._tfidf_vectorizer = TfidfVectorizer(
                ngram_range=(1, 2),
                min_df=1,
                sublinear_tf=True,
                stop_words="english",
            )
            self._tfidf_matrix = self._tfidf_vectorizer.fit_transform(texts)
        self._available = True

    def _similarity(self, query_text: str) -> np.ndarray:
        """Cosine similarity between the query and every indexed recipe."""
        if not self._ids:
            return np.zeros(0)
        if self._lsa.is_fitted:
            return np.asarray(self._lsa.similarity(query_text), dtype=float)
        if self._tfidf_vectorizer is not None and self._tfidf_matrix is not None:
            q = self._tfidf_vectorizer.transform([query_text])
            return np.asarray(cosine_similarity(q, self._tfidf_matrix)[0], dtype=float)
        return np.zeros(len(self._ids))

    def _keyword_matches(self, query_text: str) -> list[str]:
        """Recipe ids whose title/cuisine/tags/ingredients match a query keyword.

        Light plural stemming (``tomatoes`` -> ``tomato``) mirrors the keyword
        gate in :meth:`query`, so lexically strict LSA retrieval stays generous
        for plural query words that a dense embedder would have matched
        semantically.
        """
        clean = re.sub(r"[^a-z0-9 ]+", " ", query_text.lower()).strip()
        stop_words = {
            "how", "to", "cook", "make", "recipe", "recipes", "for", "steps",
            "instructions", "give", "me", "show", "what", "can", "i", "with",
            "any", "the", "a", "an", "do", "you", "have", "please", "tell",
            "about", "some", "good", "best", "want", "like", "need",
        }
        keywords = [w for w in clean.split() if w not in stop_words and len(w) > 2]
        if not keywords:
            return []
        matched: list[str] = []
        for rid in self._ids:
            r = self._recipes[rid]
            title = str(r.get("title", "")).lower()
            cuisine = str(r.get("cuisine", "")).lower()
            tags = [str(t).lower() for t in r.get("tags", [])]
            ingredients = _extract_ingredient_names(r)
            haystacks = [title, cuisine, *tags, *ingredients]
            hit = False
            for kw in keywords:
                kw_stem = kw.rstrip("s") if len(kw) > 3 else kw
                for hay in haystacks:
                    if not hay:
                        continue
                    hay_stem = hay.rstrip("s") if len(hay) > 3 else hay
                    if kw in hay or hay in kw or kw_stem in hay or hay_stem in kw:
                        hit = True
                        break
                if hit:
                    break
            if hit:
                matched.append(rid)
        return matched

    def upsert_recipes(self, recipes: list[dict[str, Any]]) -> int:
        """Incrementally embed and upsert recipes without re-embedding unchanged items."""
        if not recipes:
            return 0

        to_embed: list[dict[str, Any]] = []
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

        if not to_embed:
            return 0

        self._rebuild_index()
        logger.info("rag_upserted", extra={"upserted": len(to_embed), "total": len(self._recipes)})
        return len(to_embed)

    def reindex(self, recipes: list[dict[str, Any]], *, incremental: bool = True) -> int:
        """Replace or incrementally update the index with a fresh recipe set."""
        try:
            if not incremental:
                self._recipes = {}
                if recipes:
                    self._index_recipes(recipes)
                else:
                    self._rebuild_index()
            else:
                # Upsert deduplicates unchanged recipes; the count reported is
                # still the size of the submitted set, as before.
                self.upsert_recipes(recipes)
            logger.info("rag_reindexed", extra={"count": len(recipes), "incremental": incremental})
            return len(recipes)
        except Exception as exc:
            logger.error("rag_reindex_failed", extra={"error": str(exc)})
            return 0

    def index_recipes(self, recipes: list[dict[str, Any]]) -> int:
        """Backwards-compatible alias for a full (non-incremental) reindex."""
        return self.reindex(recipes, incremental=False)

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
        if not self._available:
            return {
                "success": False,
                "suggestion": "RAG service is unavailable.",
                "recipes": [],
                "method": "unavailable",
            }

        if not self._recipes:
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

        # 2. Retrieve candidates from the LSA index (fetch extra for filtering)
        n_fetch = max(top_k * 3, 10)
        retrieved = self._retrieve(query_text, n_results=n_fetch)

        # 3. Hard-filter allergens. Expand group terms (e.g. "dairy") to
        # their concrete members (milk, butter, cheese, ...) first, so a
        # saved group allergy blocks recipes containing a member
        # ingredient — mirroring planner._violates_allergy, including
        # the plant-milk rule in _term_matches_ingredient. Only the
        # filtered safe_recipes are returned AND fed to _generate().
        expanded_allergies = (
            sorted(get_knowledge_graph().expand_allergens(clean_allergies))
            if clean_allergies
            else []
        )
        safe_recipes = [r for r in retrieved if not _contains_allergen(r, expanded_allergies)]

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
        if not self._available:
            return {
                "success": False,
                "answer": "RAG service is unavailable.",
                "recipes": [],
                "method": "unavailable",
            }

        if not self._recipes:
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
        """Return the closest recipes: top LSA matches plus keyword matches."""
        if not self._available or not self._ids or n_results <= 0:
            return []

        sims = self._similarity(query_text)
        order = np.argsort(-sims) if sims.size else np.array([], dtype=int)
        seen: set[str] = set()
        recipes_out: list[dict[str, Any]] = []
        for idx in order:
            if len(recipes_out) >= n_results:
                break
            score = float(sims[idx])
            if score <= 0:
                continue
            rid = self._ids[int(idx)]
            full = dict(self._recipes[rid])
            full["similarity_score"] = round(max(0.0, min(1.0, score)), 4)
            seen.add(rid)
            recipes_out.append(full)

        # Lexically generous top-up: recipes sharing a query keyword, even
        # when the dense score is 0 (e.g. plural "tomatoes" vs "tomato").
        for rid in self._keyword_matches(query_text):
            if len(recipes_out) >= n_results:
                break
            if rid in seen:
                continue
            idx = self._ids.index(rid)
            score = float(sims[idx]) if sims.size else 0.0
            full = dict(self._recipes[rid])
            full["similarity_score"] = round(max(0.0, min(1.0, score)), 4)
            seen.add(rid)
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
