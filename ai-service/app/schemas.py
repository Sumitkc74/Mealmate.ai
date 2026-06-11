"""Pydantic schemas for request/response validation."""

from typing import Literal

from pydantic import BaseModel, Field


Strategy = Literal["tfidf", "lsa", "collab", "hybrid"]
PlannerObjective = Literal["balanced", "eco", "budget", "pantry"]


class HealthResponse(BaseModel):
    success: bool = True
    service: str = "mealmate-ai-service"
    version: str = "0.2.0"
    env: str
    model_loaded: bool


class RecommendRequest(BaseModel):
    ingredients: list[str] = Field(
        ..., min_length=1, description="Ingredients available in the user's pantry."
    )
    dietary_preferences: list[str] = Field(default_factory=list)
    allergies: list[str] = Field(
        default_factory=list,
        description="Recipes containing any allergen substring will be excluded.",
    )
    top_k: int = Field(default=5, ge=1, le=50)
    strategy: Strategy = Field(
        default="hybrid",
        description=(
            "Ranking strategy: 'tfidf' (lexical), 'lsa' (semantic latent space), "
            "'collab' (item-item collaborative), or 'hybrid' (weighted ensemble)."
        ),
    )
    liked_recipe_ids: list[str] = Field(
        default_factory=list,
        description=(
            "Recipes the user has previously planned or favourited. Used by the "
            "collaborative-filter and hybrid strategies to personalise ranking."
        ),
    )


class SignalContribution(BaseModel):
    """Per-strategy score contribution to a hybrid recommendation."""

    name: str
    score: float
    weight: float


class RecommendedRecipe(BaseModel):
    recipe_id: str
    title: str
    score: float
    matched_ingredients: list[str] = Field(default_factory=list)
    reason: str = ""
    signals: list[SignalContribution] = Field(default_factory=list)


class RecommendResponse(BaseModel):
    success: bool = True
    count: int
    strategy: Strategy = "hybrid"
    results: list[RecommendedRecipe]


class SimilarRequest(BaseModel):
    top_k: int = Field(default=5, ge=1, le=20)
    strategy: Strategy = Field(
        default="tfidf",
        description="Vector space to use for similarity (tfidf, lsa, collab, hybrid).",
    )


class SimilarResponse(BaseModel):
    success: bool = True
    recipe_id: str
    count: int
    strategy: Strategy = "tfidf"
    results: list[RecommendedRecipe]


class MealPlanRequest(BaseModel):
    ingredients: list[str] = Field(default_factory=list)
    dietary_preferences: list[str] = Field(default_factory=list)
    allergies: list[str] = Field(default_factory=list)
    use_llm: bool = Field(
        default=False,
        description=(
            "If true and GEMINI_API_KEY is configured, use the LLM strategy; "
            "otherwise falls back to the heuristic."
        ),
    )
    objective: PlannerObjective = Field(
        default="balanced",
        description=(
            "Multi-objective weighting preset: 'balanced' (default), 'eco' "
            "(minimise CO2 emissions), 'budget' (minimise cost), 'pantry' "
            "(maximise pantry utilisation)."
        ),
    )
    weights: dict[str, float] | None = Field(
        default=None,
        description=(
            "Optional manual override of multi-objective weights. Recognised keys: "
            "similarity, eco, cost, pantry, variety. Values must be non-negative."
        ),
    )


class MealPlanSlot(BaseModel):
    slot: str
    recipe_id: str
    title: str
    tags: list[str] = Field(default_factory=list)
    co2_kg: float | None = None
    cost_usd: float | None = None
    eco_score: float | None = None


class MealPlanDay(BaseModel):
    day: str
    meals: list[MealPlanSlot]
    co2_kg: float | None = None
    cost_usd: float | None = None


class SustainabilitySummary(BaseModel):
    co2_kg: float
    cost_usd: float
    eco_score: float
    meals: int


class MealPlanResponse(BaseModel):
    success: bool = True
    strategy: Literal["heuristic", "llm"] = Field(
        description="Which generator produced the plan."
    )
    objective: PlannerObjective = "balanced"
    weights: dict[str, float] = Field(default_factory=dict)
    days: list[MealPlanDay]
    sustainability: SustainabilitySummary | None = None


# ---------------------------------------------------------------------------
# Cooking-assistant chat
# ---------------------------------------------------------------------------


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., min_length=1, max_length=4000)


class ChatRequest(BaseModel):
    """A turn-based cooking-assistant request.

    The full prior conversation is sent on every call (the AI service is
    stateless). Optional context blocks let the client steer answers.
    """

    messages: list[ChatMessage] = Field(..., min_length=1, max_length=20)
    pantry: list[str] = Field(default_factory=list)
    dietary_preferences: list[str] = Field(default_factory=list)
    allergies: list[str] = Field(default_factory=list)
    recipe_context: str | None = Field(
        default=None,
        max_length=4000,
        description="Optional recipe text to ground answers (e.g. when chatting from a recipe page).",
    )


class ChatSuggestion(BaseModel):
    label: str
    prompt: str


# Days of week + meal slot literals — must match the Node server's MealPlan
# model so the server can apply actions without re-mapping strings.
DayOfWeek = Literal[
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"
]
MealSlot = Literal["breakfast", "lunch", "dinner"]


class AddToPlanAction(BaseModel):
    """The assistant wants to place a recipe in the user's weekly plan."""

    type: Literal["add_to_plan"] = "add_to_plan"
    recipe_query: str = Field(
        ...,
        min_length=1,
        max_length=120,
        description="Free-text recipe name the user asked for. The server fuzzy-matches against the recipe DB.",
    )
    day: DayOfWeek
    slot: MealSlot
    week_offset: int = Field(
        default=0,
        ge=0,
        le=8,
        description="0 = current week (Mon-Sun), 1 = next week, etc.",
    )
    target_date: str | None = Field(
        default=None,
        pattern=r"^\d{4}-\d{2}-\d{2}$",
        description=(
            "Optional ISO date (YYYY-MM-DD) when the user named an explicit "
            "calendar date (e.g. 'june 4', '5/30', '2026-06-04'). When "
            "present, the server derives the correct (day, week_offset) from "
            "this date and ignores the fields above \u2014 this prevents off-by-one-week "
            "errors when 'this Thursday' vs 'next Thursday' is ambiguous."
        ),
    )


# Discriminated union — new action types can be added here without breaking
# existing clients (they'll see them as unknown and ignore).
ChatAction = AddToPlanAction


class ChatResponse(BaseModel):
    success: bool = True
    reply: str
    strategy: Literal["llm", "fallback"]
    suggestions: list[ChatSuggestion] = Field(default_factory=list)
    actions: list[ChatAction] = Field(
        default_factory=list,
        description=(
            "Structured side-effects the assistant wants to perform. The Node "
            "server interprets and applies them, then returns `applied_actions`."
        ),
    )


# ---------------------------------------------------------------------------
# AI recipe generator (used as a fallback when the user asks to add a dish
# that doesn't exist in the library yet)
# ---------------------------------------------------------------------------


class GenerateRecipeRequest(BaseModel):
    query: str = Field(
        ..., min_length=2, max_length=120,
        description="Dish name (and optional qualifiers like 'spicy', 'vegetarian').",
    )
    dietary_preferences: list[str] = Field(default_factory=list)
    allergies: list[str] = Field(default_factory=list)


class GeneratedIngredient(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    quantity: float | None = Field(default=None, ge=0)
    unit: str | None = Field(default=None, max_length=20)


class GeneratedNutrition(BaseModel):
    calories: float | None = Field(default=None, ge=0)
    protein: float | None = Field(default=None, ge=0)
    carbs: float | None = Field(default=None, ge=0)
    fat: float | None = Field(default=None, ge=0)
    fiber: float | None = Field(default=None, ge=0)
    sugar: float | None = Field(default=None, ge=0)
    sodium: float | None = Field(default=None, ge=0)


class GeneratedRecipe(BaseModel):
    title: str = Field(..., min_length=2, max_length=200)
    description: str = Field(default="", max_length=2000)
    cuisine: str | None = Field(default=None, max_length=50)
    tags: list[str] = Field(default_factory=list, max_length=20)
    ingredients: list[GeneratedIngredient] = Field(..., min_length=1, max_length=40)
    instructions: list[str] = Field(..., min_length=1, max_length=30)
    prep_time: int = Field(..., ge=0, le=600)
    cook_time: int = Field(..., ge=0, le=600)
    servings: int = Field(..., ge=1, le=20)
    nutrition: GeneratedNutrition = Field(default_factory=GeneratedNutrition)
    difficulty: Literal["easy", "medium", "hard"] = "medium"
    image_url: str | None = Field(default=None)
    source: str = Field(default="ai-generated", max_length=100)


class GenerateRecipeResponse(BaseModel):
    success: bool
    strategy: Literal["llm", "unavailable"] = "llm"
    recipe: GeneratedRecipe | None = None
    message: str | None = None


# ---------------------------------------------------------------------------
# Smart pantry parser (text + vision)
# ---------------------------------------------------------------------------


class PantryParseRequest(BaseModel):
    text: str = Field(
        ...,
        min_length=1,
        max_length=2000,
        description="Freeform text the user pasted, e.g. 'half a red onion, 2 tomatoes, leftover rice'.",
    )


class ParsedPantryItem(BaseModel):
    ingredient: str
    quantity: str | None = None
    unit: str | None = None


class PantryParseResponse(BaseModel):
    success: bool = True
    strategy: Literal["llm", "heuristic"]
    items: list[ParsedPantryItem]


class PantryVisionRequest(BaseModel):
    image_base64: str = Field(
        ...,
        min_length=20,
        max_length=10_000_000,
        description="Base64-encoded image (with or without 'data:image/...;base64,' prefix).",
    )
    hint: str | None = Field(
        default=None,
        max_length=500,
        description="Optional free-text hint, e.g. 'this is the bottom shelf of my fridge'.",
    )


class PantryVisionResponse(BaseModel):
    success: bool = True
    available: bool
    items: list[ParsedPantryItem] = Field(default_factory=list)
    message: str | None = None


# ---------------------------------------------------------------------------
# Sustainability
# ---------------------------------------------------------------------------


class IngredientFootprintOut(BaseModel):
    name: str
    category: str
    co2_kg: float
    cost_usd: float


class RecipeFootprintResponse(BaseModel):
    success: bool = True
    recipe_id: str
    title: str
    co2_kg: float
    cost_usd: float
    eco_score: float
    categories: list[str]
    breakdown: list[IngredientFootprintOut]


# ---------------------------------------------------------------------------
# Interaction tracking (powers collaborative filter)
# ---------------------------------------------------------------------------


class InteractionRecordRequest(BaseModel):
    recipe_ids: list[str] = Field(
        ...,
        min_length=2,
        max_length=50,
        description=(
            "Recipes that co-occurred in a single user session (e.g. a weekly "
            "meal plan). Pairwise co-occurrence boosts the collab matrix."
        ),
    )


class InteractionRecordResponse(BaseModel):
    success: bool = True
    pairs: int

class RAGSuggestRequest(BaseModel):
    pantry: list[str] = Field(
        ...,
        description="Ingredients available (from manual entry or pantry vision scan)",
        example=["turkey", "rice", "broccoli", "garlic", "olive oil"],
    )
    dietary_preferences: list[str] = Field(default=[])
    allergies: list[str] = Field(default=[])
    top_k: int = Field(default=5, ge=1, le=20)


class RAGSuggestResponse(BaseModel):
    success: bool
    suggestion: str
    recipes: list[dict]
    method: str
    rag_available: bool

class RAGQueryRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=500)
    top_k: int = Field(default=5, ge=1, le=10)

class RAGQueryResponse(BaseModel):
    success: bool
    answer: str
    recipes: list[dict]
    method: str
    rag_available: bool

class RAGIndexRecipe(BaseModel):
    id: str
    title: str
    cuisine: str = ""
    ingredients: list[str] = []
    tags: list[str] = []
    instructions: list[str] = []

class RAGIndexRequest(BaseModel):
    recipes: list[RAGIndexRecipe]

class RAGIndexResponse(BaseModel):
    success: bool
    indexed: int
