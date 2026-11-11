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
from fastapi.responses import StreamingResponse

from fastapi.middleware.cors import CORSMiddleware

from . import chat as chat_service
from . import gemini
from . import metrics as metrics_mod
from . import pantry_parser
from . import recipe_gen
from . import vision
from .recipe_verifier import verify_recipe_with_ai, estimate_recipe_nutrition
from .agent import CulinaryAgent
from .config import Settings, get_settings
from .experiments import get_experiment_manager
from ._text import Recipe
from .knowledge_graph import get_knowledge_graph
from .llm_provider import get_llm_provider
from .logging_config import configure_logging, logger
from .planner import generate_plan
from .recommender import RecommenderService, get_recommender
from .schemas import (
    AgentChatRequest,
    AgentChatResponse,
    AgentToolTraceOut,
    ChatRequest,
    ChatResponse,
    EstimateNutritionRequest,
    EstimateNutritionResponse,
    ExperimentConversionRequest,
    ExperimentConversionResponse,
    ExperimentListResponse,
    GenerateRecipeRequest,
    GenerateRecipeResponse,
    HealthResponse,
    InteractionRecordRequest,
    InteractionRecordResponse,
    KnowledgeGraphSummaryResponse,
    MealPlanRequest,
    MealPlanResponse,
    PairingsResponse,
    PantryParseRequest,
    PantryParseResponse,
    PantryVisionRequest,
    PantryVisionResponse,
    RAGIndexRequest,
    RAGIndexResponse,
    RAGQueryRequest,
    RAGQueryResponse,
    RAGSuggestRequest,
    RAGSuggestResponse,
    RecipeFootprintResponse,
    RecommendRequest,
    RecommendResponse,
    SimilarRequest,
    SimilarResponse,
    SubstituteItem,
    SubstitutesResponse,
    VerifyRecipeRequest,
    VerifyRecipeResponse,
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
    init_rag(recipes_for_rag)
    logger.info("rag_initialised", recipes=len(recipes_for_rag))

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
        active_provider = None
        active_model = None
        if gemini.is_gemini_available():
            active_provider = "gemini"
            active_model = gemini._model_name()
        elif gemini.is_available():
            fb = gemini._get_fallback_provider()
            active_provider = fb.name if fb else "fallback"
            active_model = getattr(fb, "model", getattr(fb, "deployment", "fallback"))

        return {
            "success": True,
            "llm": {
                "provider": active_provider,
                "model": active_model,
                "available": gemini.is_available(),
                "fallback_active": not gemini.is_gemini_available() and gemini.is_available(),
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
                "rag": get_rag() is not None and get_rag().is_available,
                "knowledge_graph": True,
                "agent": True,
                "experiments": True,
                "azure_search": True,
                "strategies": ["tfidf", "lsa", "collab", "hybrid"],
                "planner_objectives": ["balanced", "eco", "budget", "pantry"],
            },
        }

    @app.post("/recommend", response_model=RecommendResponse, tags=["recommender"])
    def recommend(
        payload: RecommendRequest,
        rec: Annotated[RecommenderService, Depends(get_recommender)],
    ) -> RecommendResponse:
        allowed_ids = None
        db_recipes = getattr(payload, "recipes", None)
        if db_recipes:
            try:
                rec_recipes = [
                    Recipe(
                        recipe_id=r.id,
                        title=r.title,
                        ingredients=tuple(r.ingredients),
                        tags=tuple(r.tags),
                        cuisine=r.cuisine,
                    )
                    for r in db_recipes
                ]
                rec.upsert_recipes(rec_recipes)
                allowed_ids = {r.id for r in db_recipes}
            except Exception as e:
                logger.warning("recommender_sync_failed", error=str(e))

        excluded_ids = (
            set(payload.exclude_recipe_ids)
            if getattr(payload, "exclude_recipe_ids", None)
            else None
        )
        results = rec.recommend(
            ingredients=payload.ingredients,
            dietary_preferences=payload.dietary_preferences,
            allergies=payload.allergies,
            top_k=payload.top_k,
            strategy=payload.strategy,
            liked_recipe_ids=payload.liked_recipe_ids,
            allowed_recipe_ids=allowed_ids,
            excluded_recipe_ids=excluded_ids,
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

    @app.post("/chat/stream", tags=["assistant"], summary="Stream conversational reply via Server-Sent Events (SSE)")
    def chat_stream(payload: ChatRequest) -> StreamingResponse:
        return StreamingResponse(
            chat_service.stream_reply(payload),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

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
        if rag is None or not rag.is_available:
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
            success=result.get("success", False),
            suggestion=result.get("suggestion", ""),
            recipes=result.get("recipes", []),
            method=result.get("method", "rag_fallback"),
            rag_available=rag.is_available,
        )

    @app.post("/rag/query", response_model=RAGQueryResponse, tags=["rag"])
    def rag_query(payload: RAGQueryRequest) -> RAGQueryResponse:
        """Answer questions strictly from the recipe database."""
        rag = get_rag()
        if rag is None or not rag.is_available:
            return RAGQueryResponse(
                success=False,
                answer="RAG service not initialised.",
                recipes=[],
                method="unavailable",
                rag_available=False,
            )
        result = rag.query(
            question=payload.question,
            top_k=payload.top_k,
        )
        return RAGQueryResponse(
            success=result.get("success", False),
            answer=result.get("answer", ""),
            recipes=result.get("recipes", []),
            method=result.get("method", "rag_fallback"),
            rag_available=rag.is_available,
        )

    @app.post("/rag/index", response_model=RAGIndexResponse, tags=["rag"])
    def rag_index(
        payload: RAGIndexRequest,
        rec: Annotated[RecommenderService, Depends(get_recommender)],
    ) -> RAGIndexResponse:
        """Re-index ChromaDB and update RecommenderService with a fresh recipe set from MongoDB."""
        if payload.recipes:
            try:
                rec_recipes = [
                    Recipe(
                        recipe_id=r.id,
                        title=r.title,
                        ingredients=tuple(r.ingredients),
                        tags=tuple(r.tags),
                        cuisine=r.cuisine,
                    )
                    for r in payload.recipes
                ]
                rec.upsert_recipes(rec_recipes)
            except Exception as e:
                logger.warning("recommender_sync_failed", error=str(e))

        rag = get_rag()
        if rag is None or not rag.is_available:
            return RAGIndexResponse(success=False, indexed=0)
        recipes = [r.model_dump() for r in payload.recipes]
        count = rag.reindex(recipes, incremental=payload.incremental)
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

    # -----------------------------------------------------------------------
    # Culinary Knowledge Graph Routes
    # -----------------------------------------------------------------------

    @app.get(
        "/knowledge/substitutes",
        response_model=SubstitutesResponse,
        tags=["knowledge_graph"],
        summary="Query context-aware culinary substitutions from the Knowledge Graph",
    )
    def knowledge_substitutes(
        ingredient: str,
        context: str | None = None,
    ) -> SubstitutesResponse:
        kg = get_knowledge_graph()
        subs = kg.find_substitutes(ingredient, context=context)
        items = [
            SubstituteItem(
                target=s.target,
                substitute=s.substitute,
                ratio=s.ratio,
                context=s.context,
                notes=s.notes,
            )
            for s in subs
        ]
        return SubstitutesResponse(ingredient=ingredient, substitutions=items)

    @app.get(
        "/knowledge/pairings",
        response_model=PairingsResponse,
        tags=["knowledge_graph"],
        summary="Query complementary flavor pairings for an ingredient",
    )
    def knowledge_pairings(ingredient: str) -> PairingsResponse:
        kg = get_knowledge_graph()
        complements = kg.get_flavor_complements(ingredient)
        return PairingsResponse(ingredient=ingredient, complements=complements)

    @app.get(
        "/knowledge/graph",
        response_model=KnowledgeGraphSummaryResponse,
        tags=["knowledge_graph"],
        summary="Knowledge Graph topology statistics",
    )
    def knowledge_graph_summary() -> KnowledgeGraphSummaryResponse:
        kg = get_knowledge_graph()
        summary = kg.get_summary()
        return KnowledgeGraphSummaryResponse(**summary)

    # -----------------------------------------------------------------------
    # Agentic AI Routes
    # -----------------------------------------------------------------------

    @app.post(
        "/agent/chat",
        response_model=AgentChatResponse,
        tags=["agent"],
        summary="Execute an autonomous agentic interaction with tool selection",
    )
    def agent_chat(payload: AgentChatRequest) -> AgentChatResponse:
        agent = CulinaryAgent()
        result = agent.run(
            user_message=payload.message,
            history=payload.history,
            pantry=payload.pantry,
            allergies=payload.allergies,
        )
        traces = [
            AgentToolTraceOut(
                tool_name=t.tool_name,
                arguments=t.arguments,
                output=t.output,
                success=t.success,
                error=t.error,
            )
            for t in result.tool_traces
        ]
        return AgentChatResponse(
            success=True,
            reply=result.response,
            tool_traces=traces,
            actions=result.actions,
            method=result.method,
        )

    # -----------------------------------------------------------------------
    # A/B Experimentation Routes
    # -----------------------------------------------------------------------

    @app.get(
        "/experiments",
        response_model=ExperimentListResponse,
        tags=["experimentation"],
        summary="List active online A/B experiments and variant splits",
    )
    def list_experiments() -> ExperimentListResponse:
        mgr = get_experiment_manager()
        experiments = mgr.list_experiments()
        return ExperimentListResponse(experiments=experiments)  # type: ignore[arg-type]

    @app.post(
        "/experiments/conversion",
        response_model=ExperimentConversionResponse,
        tags=["experimentation"],
        summary="Record conversion event for an A/B test variant",
    )
    def record_experiment_conversion(payload: ExperimentConversionRequest) -> ExperimentConversionResponse:
        mgr = get_experiment_manager()
        mgr.record_conversion(payload.experiment, payload.variant, payload.event)
        return ExperimentConversionResponse(success=True, recorded=True)

    # -----------------------------------------------------------------------
    # Recipe Verification & Safety Guardrail Route
    # -----------------------------------------------------------------------

    @app.post(
        "/recipes/verify",
        response_model=VerifyRecipeResponse,
        tags=["recipes"],
        summary="Verify culinary authenticity, edibility, and food safety of a recipe before publishing",
    )
    async def verify_recipe_endpoint(payload: VerifyRecipeRequest) -> VerifyRecipeResponse:
        return await verify_recipe_with_ai(payload)

    @app.post(
        "/recipes/estimate-nutrition",
        response_model=EstimateNutritionResponse,
        tags=["recipes"],
        summary="Estimate macronutrient and caloric values per serving from ingredient quantities",
    )
    async def estimate_nutrition_endpoint(payload: EstimateNutritionRequest) -> EstimateNutritionResponse:
        return await estimate_recipe_nutrition(payload)

    return app


app = create_app()
