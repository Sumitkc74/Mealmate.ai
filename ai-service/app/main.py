"""FastAPI application entry point."""

from contextlib import asynccontextmanager
from typing import Annotated

# Load .env into os.environ before any module reads ``os.environ`` (e.g.
# ``gemini.is_available`` checks ``GEMINI_API_KEY``). Pydantic-settings only
# populates the Settings object; it does not export to the process env.
from dotenv import load_dotenv

load_dotenv()

from . import rag as rag_mod
from .rag import init_rag, get_rag

from fastapi import Depends, FastAPI, HTTPException

from fastapi.middleware.cors import CORSMiddleware

from . import chat as chat_service
from . import gemini
from . import metrics as metrics_mod
from . import pantry_parser
from . import recipe_gen
from . import vision
from .config import Settings, get_settings
from .logging_config import configure_logging, logger
from .planner import generate_plan
from .recommender import RecommenderService, get_recommender
from .schemas import (
    ChatRequest,
    ChatResponse,
    GenerateRecipeRequest,
    GenerateRecipeResponse,
    HealthResponse,
    InteractionRecordRequest,
    InteractionRecordResponse,
    MealPlanRequest,
    MealPlanResponse,
    PantryParseRequest,
    PantryParseResponse,
    PantryVisionRequest,
    PantryVisionResponse,
    RecipeFootprintResponse,
    RecommendRequest,
    RecommendResponse,
    SimilarRequest,
    SimilarResponse,
    RAGSuggestRequest,
    RAGSuggestResponse,
    RAGQueryRequest,
    RAGQueryResponse,
    RAGIndexRequest,
    RAGIndexResponse,
)
from .sustainability import compute_recipe_footprint


@asynccontextmanager
async def lifespan(_app: FastAPI):
    configure_logging()
    settings = get_settings()
    logger.info(
        "ai_service_starting",
        env=settings.env,
        port=settings.port,
        gemini=gemini.is_available(),
    )
    get_recommender()

    # Initialise RAG — pass the recommender's recipe list so we don't load data twice.
    rec = get_recommender()
    recipes_for_rag = [
        {
            "id": r.recipe_id,        # ← recipe_id not id
            "title": r.title,
            "cuisine": r.cuisine or "",
            "ingredients": list(r.ingredients),
            "tags": list(r.tags),
        }
        for r in rec.recipes          # ← rec.recipes is the list property
    ]
    init_rag([])
    logger.info("rag_initialised_empty: waiting for MongoDB sync")

    yield
    logger.info("ai_service_stopping")


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="MealMate AI Service",
        version="0.3.0",
        description=(
            "Hybrid recipe recommendation (TF-IDF + LSA + collaborative), "
            "multi-objective weekly meal planning with carbon/cost scoring, "
            "vision-based pantry capture, freeform pantry parsing, and a "
            "Gemini-backed cooking assistant — with Prometheus metrics and "
            "LRU+TTL LLM caching."
        ),
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Mount Prometheus metrics + request-timing middleware.
    metrics_mod.install(app)

    @app.get("/", include_in_schema=False)
    def root() -> dict[str, str]:
        return {"service": "mealmate-ai-service", "docs": "/docs"}

    @app.get("/health", response_model=HealthResponse, tags=["meta"])
    def health(
        s: Annotated[Settings, Depends(get_settings)],
        rec: Annotated[RecommenderService, Depends(get_recommender)],
    ) -> HealthResponse:
        return HealthResponse(env=s.env, model_loaded=rec.is_loaded)

    @app.get("/capabilities", tags=["meta"])
    def capabilities() -> dict[str, object]:
        """Lets the server/client decide whether to surface LLM-only UI."""
        return {
            "success": True,
            "llm": {
                "provider": "gemini" if gemini.is_available() else None,
                "model": gemini._model_name() if gemini.is_available() else None,
                "available": gemini.is_available(),
            },
            "features": {
                "recommend": True,
                "similar": True,
                "plan_week": True,
                "chat": True,
                "pantry_parse": True,
                "pantry_vision": gemini.is_available(),
                "footprint": True,
                "interactions": True,
                "metrics": True,
                "strategies": ["tfidf", "lsa", "collab", "hybrid"],
                "planner_objectives": ["balanced", "eco", "budget", "pantry"],
            },
        }

    @app.post("/recommend", response_model=RecommendResponse, tags=["recommender"])
    def recommend(
        payload: RecommendRequest,
        rec: Annotated[RecommenderService, Depends(get_recommender)],
    ) -> RecommendResponse:
        results = rec.recommend(
            ingredients=payload.ingredients,
            dietary_preferences=payload.dietary_preferences,
            allergies=payload.allergies,
            top_k=payload.top_k,
            strategy=payload.strategy,
            liked_recipe_ids=payload.liked_recipe_ids,
        )
        return RecommendResponse(
            strategy=payload.strategy,
            count=len(results),
            results=results,
        )

    @app.post(
        "/similar/{recipe_id}",
        response_model=SimilarResponse,
        tags=["recommender"],
    )
    def similar(
        recipe_id: str,
        payload: SimilarRequest,
        rec: Annotated[RecommenderService, Depends(get_recommender)],
    ) -> SimilarResponse:
        if rec.get_recipe(recipe_id) is None:
            raise HTTPException(status_code=404, detail=f"Unknown recipe_id: {recipe_id}")
        results = rec.similar(
            recipe_id=recipe_id,
            top_k=payload.top_k,
            strategy=payload.strategy,
        )
        return SimilarResponse(
            recipe_id=recipe_id,
            strategy=payload.strategy,
            count=len(results),
            results=results,
        )

    @app.post("/plan/week", response_model=MealPlanResponse, tags=["planner"])
    def plan_week(
        payload: MealPlanRequest,
        rec: Annotated[RecommenderService, Depends(get_recommender)],
    ) -> MealPlanResponse:
        return generate_plan(
            rec=rec,
            pantry=payload.ingredients,
            prefs=payload.dietary_preferences,
            allergies=payload.allergies,
            use_llm=payload.use_llm,
            objective=payload.objective,
            weights_override=payload.weights,
        )

    @app.post("/chat", response_model=ChatResponse, tags=["assistant"])
    def chat(payload: ChatRequest) -> ChatResponse:
        return chat_service.reply(payload)

    @app.post("/rag/suggest", response_model=RAGSuggestResponse, tags=["rag"])
    def rag_suggest(payload: RAGSuggestRequest) -> RAGSuggestResponse:
        """
        RAG-powered recipe suggestion.

        Pipeline:
          1. Embed pantry + preferences into a vector query
          2. Retrieve semantically similar recipes from ChromaDB
          3. Hard-filter any recipe containing an allergen
          4. Pass retrieved recipes + context to Gemini for a natural suggestion
          5. Falls back to ranked results if Gemini is not configured
        """
        rag = get_rag()
        if rag is None:
            return RAGSuggestResponse(
                success=False,
                suggestion="RAG service not initialised.",
                recipes=[],
                method="unavailable",
                rag_available=False,
            )

        result = rag.suggest(
            pantry=payload.pantry,
            dietary_preferences=payload.dietary_preferences,
            allergies=payload.allergies,
            top_k=payload.top_k,
        )

        return RAGSuggestResponse(
            success=result["success"],
            suggestion=result["suggestion"],
            recipes=result["recipes"],
            method=result["method"],
            rag_available=rag.is_available,
        )

    @app.post("/rag/query", response_model=RAGQueryResponse, tags=["rag"])
    def rag_query(payload: RAGQueryRequest) -> RAGQueryResponse:
        """Answer questions strictly from the recipe database."""
        svc = rag_mod._rag_service
        if svc is None:
            return RAGQueryResponse(
                success=False,
                answer="RAG service not initialised.",
                recipes=[],
                method="unavailable",
                rag_available=False,
            )
        result = svc.query(
            question=payload.question,
            top_k=payload.top_k,
        )
        return RAGQueryResponse(
            success=result["success"],
            answer=result["answer"],
            recipes=result["recipes"],
            method=result["method"],
            rag_available=svc.is_available,
        )

    @app.post("/rag/index", response_model=RAGIndexResponse, tags=["rag"])
    def rag_index(payload: RAGIndexRequest) -> RAGIndexResponse:
        """Re-index ChromaDB with a fresh recipe set from MongoDB."""
        svc = rag_mod._rag_service
        if svc is None:
            return RAGIndexResponse(success=False, indexed=0)
        recipes = [r.model_dump() for r in payload.recipes]
        count = svc.reindex(recipes)
        return RAGIndexResponse(success=count > 0, indexed=count)

    @app.post(
        "/recipes/generate",
        response_model=GenerateRecipeResponse,
        tags=["assistant"],
        summary="Generate a full recipe with Gemini when the library has no match.",
    )
    def generate_recipe(payload: GenerateRecipeRequest) -> GenerateRecipeResponse:
        return recipe_gen.generate(payload)

    @app.post(
        "/recipes/refresh-image",
        tags=["assistant"],
        summary="Recompute an image URL for an existing recipe title (backfill use).",
    )
    def refresh_image(payload: dict) -> dict:  # type: ignore[type-arg]
        """Lightweight helper the server's backfill script calls to fix bad
        images on previously-generated recipes. Body: {title, cuisine?, ingredients?}.
        Returns {image_url: str | None}.
        """
        title = str(payload.get("title") or "").strip()
        cuisine = payload.get("cuisine")
        ingredients = payload.get("ingredients") or []
        if not title:
            return {"image_url": None}
        url = (
            recipe_gen._fetch_wikipedia_image(title)
            or recipe_gen._pollinations_image_url(
                title,
                cuisine=cuisine if isinstance(cuisine, str) else None,
                ingredients=[str(i) for i in ingredients if i],
            )
        )
        return {"image_url": url}

    @app.post("/pantry/parse", response_model=PantryParseResponse, tags=["assistant"])
    def parse_pantry(payload: PantryParseRequest) -> PantryParseResponse:
        return pantry_parser.parse(payload)

    @app.post(
        "/pantry/vision",
        response_model=PantryVisionResponse,
        tags=["assistant"],
        summary="Identify pantry items from a fridge photo via Gemini Vision",
    )
    def pantry_vision(payload: PantryVisionRequest) -> PantryVisionResponse:
        items = vision.parse_image(payload.image_base64, payload.hint)
        if items is None:
            return PantryVisionResponse(
                available=False,
                items=[],
                message=(
                    "Vision parsing is unavailable. Configure GEMINI_API_KEY "
                    "or install google-generativeai."
                ),
            )
        return PantryVisionResponse(available=True, items=items, message=None)

    @app.get(
        "/recipes/{recipe_id}/footprint",
        response_model=RecipeFootprintResponse,
        tags=["sustainability"],
        summary="Carbon and cost footprint of a single recipe",
    )
    def recipe_footprint(
        recipe_id: str,
        rec: Annotated[RecommenderService, Depends(get_recommender)],
    ) -> RecipeFootprintResponse:
        recipe = rec.get_recipe(recipe_id)
        if recipe is None:
            raise HTTPException(status_code=404, detail=f"Unknown recipe_id: {recipe_id}")
        fp = compute_recipe_footprint(recipe)
        payload_dict = fp.to_dict()
        payload_dict["title"] = recipe.title
        return RecipeFootprintResponse(**payload_dict)

    @app.post(
        "/interactions/record",
        response_model=InteractionRecordResponse,
        tags=["recommender"],
        summary="Record co-occurring recipe interactions for the collaborative model",
    )
    def record_interactions(
        payload: InteractionRecordRequest,
        rec: Annotated[RecommenderService, Depends(get_recommender)],
    ) -> InteractionRecordResponse:
        pairs = rec.collab.add_interactions(payload.recipe_ids)
        return InteractionRecordResponse(pairs=pairs)

    return app


app = create_app()
