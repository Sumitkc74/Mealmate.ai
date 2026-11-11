"""Tests for Enterprise ML & AI features:
- Pluggable LLM Providers (Gemini, Azure OpenAI, OpenAI, Mock)
- Culinary Knowledge Graph (substitutions, allergen ontology, flavor pairings)
- Agentic AI Tool-calling (ReAct execution, kitchen tools, trace generation)
- A/B Testing & Experimentation Engine
- Azure AI Search adapter schema
- FastAPI endpoints for Knowledge Graph, Agent, and Experiments
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.agent import CulinaryAgent, registry, tool_convert_units
from app.azure_search import AzureAISearchClient
from app.experiments import Experiment, Variant, get_experiment_manager
from app.knowledge_graph import CulinaryKnowledgeGraph, get_knowledge_graph
from app.llm_provider import (
    AzureOpenAIProvider,
    FailoverLLMProvider,
    GeminiProvider,
    MockLLMProvider,
    OpenAIProvider,
    get_fallback_provider,
    get_llm_provider,
)
from app.main import create_app


@pytest.fixture(scope="module")
def client() -> TestClient:
    app = create_app()
    with TestClient(app) as test_client:
        yield test_client


# ---------------------------------------------------------------------------
# 1. LLM Provider Tests
# ---------------------------------------------------------------------------

def test_mock_llm_provider():
    mock = MockLLMProvider(responses={"hello": "world"})
    assert mock.is_available() is True
    assert mock.name == "mock"

    res_text = mock.generate_text("hello")
    assert res_text == "world"

    res_json = mock.generate_text("get json", json_mode=True)
    assert "reply" in res_json

    chat_reply = mock.generate_chat(
        system="test",
        history=[],
        user_message="ping",
    )
    assert "Mock chat reply" in chat_reply

    vec = mock.embed_text("test recipe")
    assert isinstance(vec, list)
    assert len(vec) == 32


def test_azure_openai_provider_offline():
    prov = AzureOpenAIProvider(
        endpoint="https://mealmate-test.openai.azure.com",
        api_key="",  # deliberately empty
    )
    assert prov.is_available() is False
    assert prov.generate_text("hi") is None
    assert prov.embed_text("recipe") is None


def test_openai_provider_offline():
    prov = OpenAIProvider(api_key="")
    assert prov.is_available() is False
    assert prov.generate_text("hi") is None


def test_get_llm_provider_factory():
    prov_mock = get_llm_provider("mock")
    assert prov_mock.name == "mock"

    prov_gemini = get_llm_provider("gemini")
    assert prov_gemini.name == "gemini"

    prov_failover = get_llm_provider("failover")
    assert prov_failover.name == "failover"


def test_failover_provider_cascades_on_primary_failure():
    primary = MockLLMProvider(available=True)
    primary.generate_text = lambda *args, **kwargs: None  # type: ignore[assignment]
    primary.generate_chat = lambda *args, **kwargs: None  # type: ignore[assignment]

    secondary = MockLLMProvider(
        responses={"ping": "pong", "chat_user": "secondary_chat_response"},
        available=True,
    )

    failover = FailoverLLMProvider(providers=[primary, secondary])
    assert failover.is_available() is True
    assert failover.name == "failover"

    text_res = failover.generate_text("ping")
    assert text_res == "pong"

    chat_res = failover.generate_chat(
        system="sys",
        history=[],
        user_message="chat_user",
    )
    assert chat_res == "secondary_chat_response"


def test_failover_provider_returns_primary_when_healthy():
    primary = MockLLMProvider(responses={"ping": "primary_pong"}, available=True)
    secondary = MockLLMProvider(responses={"ping": "secondary_pong"}, available=True)

    failover = FailoverLLMProvider(providers=[primary, secondary])
    assert failover.generate_text("ping") == "primary_pong"


def test_gemini_fails_over_to_secondary_when_gemini_unavailable(monkeypatch):
    from app import gemini

    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    mock_fallback = MockLLMProvider(
        responses={"test user": "fallback answer", "test chat": "fallback chat answer"},
        available=True,
    )
    monkeypatch.setattr(gemini, "_get_fallback_provider", lambda: mock_fallback)

    assert gemini.is_available() is True

    res = gemini.generate_text("test user")
    assert res == "fallback answer"

    chat_res = gemini.generate_chat(
        system="sys",
        history=[],
        user_message="test chat",
    )
    assert chat_res == "fallback chat answer"


def test_gemini_fails_over_when_gemini_throws_exception(monkeypatch):
    from app import gemini

    monkeypatch.setenv("GEMINI_API_KEY", "fake_key")

    class FakeGenerativeModel:
        def __init__(self, *args, **kwargs):
            pass

        def generate_content(self, *args, **kwargs):
            raise RuntimeError("Gemini 429 ResourceExhausted: rate limit exceeded")

        def start_chat(self, *args, **kwargs):
            class FakeChat:
                def send_message(self, *args, **kwargs):
                    raise RuntimeError("Gemini 503 Service Unavailable")

            return FakeChat()

    class FakeGenAI:
        GenerativeModel = FakeGenerativeModel

    monkeypatch.setattr(gemini, "_configure", lambda: FakeGenAI())

    mock_fallback = MockLLMProvider(
        responses={"failover user": "saved by fallback", "failover chat": "saved in chat"},
        available=True,
    )
    monkeypatch.setattr(gemini, "_get_fallback_provider", lambda: mock_fallback)

    res = gemini.generate_text("failover user")
    assert res == "saved by fallback"

    chat_res = gemini.generate_chat(
        system="sys",
        history=[],
        user_message="failover chat",
    )
    assert chat_res == "saved in chat"


# ---------------------------------------------------------------------------
# 2. Knowledge Graph Tests
# ---------------------------------------------------------------------------

def test_knowledge_graph_substitutes():
    kg = get_knowledge_graph()
    subs = kg.find_substitutes("buttermilk")
    assert len(subs) >= 2
    sub_names = [s.substitute.lower() for s in subs]
    assert any("lemon juice" in name or "vinegar" in name for name in sub_names)


def test_knowledge_graph_context_filter():
    kg = get_knowledge_graph()
    vegan_subs = kg.find_substitutes("egg", context="vegan")
    assert len(vegan_subs) >= 1
    assert any("flaxseed" in s.substitute.lower() or "aquafaba" in s.substitute.lower() for s in vegan_subs)


def test_knowledge_graph_allergen_avoidance():
    kg = get_knowledge_graph()
    # Butter substitutes without dairy
    subs = kg.find_substitutes("butter", avoid_allergens=["dairy"])
    for s in subs:
        assert "ghee" not in s.substitute.lower()


def test_knowledge_graph_allergen_expansion():
    kg = get_knowledge_graph()
    expanded_dairy = kg.expand_allergens(["dairy"])
    assert "milk" in expanded_dairy
    assert "butter" in expanded_dairy
    assert "cheese" in expanded_dairy


def test_knowledge_graph_flavor_pairings():
    kg = get_knowledge_graph()
    pairings = kg.get_flavor_complements("tomato")
    assert "basil" in pairings or "mozzarella" in pairings


def test_knowledge_graph_recipe_enrichment():
    kg = get_knowledge_graph()
    recipe = {
        "title": "Caprese Salad",
        "ingredients": ["tomato", "parmesan cheese", "garlic"],
    }
    enriched = kg.enrich_recipe(recipe)
    assert "kg_flavor_profiles" in enriched
    assert "kg_recommended_pairings" in enriched
    assert "umami" in enriched["kg_flavor_profiles"]


# ---------------------------------------------------------------------------
# 3. Agentic AI Tests
# ---------------------------------------------------------------------------

def test_agent_tool_registry():
    tools = registry.get_definitions()
    tool_names = [t["name"] for t in tools]
    assert "search_recipes" in tool_names
    assert "find_substitutes" in tool_names
    assert "calculate_sustainability" in tool_names
    assert "convert_units" in tool_names
    assert "add_to_plan" in tool_names


def test_agent_unit_conversion_tool():
    res = tool_convert_units(amount=2.0, from_unit="cup", to_unit="ml")
    assert res["result"] == pytest.approx(473.18, rel=1e-2)

    res_tbsp = tool_convert_units(amount=3.0, from_unit="tsp", to_unit="tbsp")
    assert res_tbsp["result"] == pytest.approx(1.0, rel=1e-1)


def test_agent_offline_heuristic_substitute():
    agent = CulinaryAgent()
    result = agent._heuristic_fallback("What can I substitute for buttermilk in pancakes?", None, None)
    assert len(result.response) > 10
    assert "substitute" in result.response.lower() or "buttermilk" in result.response.lower()


def test_agent_offline_heuristic_conversion():
    agent = CulinaryAgent()
    result = agent._heuristic_fallback("Convert 2 cups to ml", None, None)
    assert "473" in result.response


def test_agent_tool_calling_loop():
    import json
    # Mock LLM simulates tool call on turn 1 and synthesis on turn 2
    tool_call_json = json.dumps({
        "thought": "Need to convert units",
        "tool_call": {
            "name": "convert_units",
            "arguments": {"amount": 2.0, "from_unit": "cup", "to_unit": "ml"}
        }
    })
    synthesis_json = json.dumps({
        "thought": "Completed tool execution",
        "reply": "2 cups is equal to 473.18 ml."
    })
    prov = MockLLMProvider(responses={"Convert 2 cups to ml": tool_call_json})
    # Replace default second turn response
    agent = CulinaryAgent()
    agent.provider = prov

    result = agent.run("Convert 2 cups to ml")
    assert result.method == "agentic_tool_react"
    assert len(result.tool_traces) == 1
    assert result.tool_traces[0].tool_name == "convert_units"
    assert result.tool_traces[0].output["result"] == pytest.approx(473.18, rel=1e-2)


# ---------------------------------------------------------------------------
# 4. A/B Experimentation Engine Tests
# ---------------------------------------------------------------------------

def test_experiment_sticky_bucketing():
    exp = Experiment(
        name="test_sticky",
        description="Testing sticky bucket consistency",
        variants=[
            Variant(name="control", weight=50),
            Variant(name="treatment", weight=50),
        ],
    )
    user_a_first = exp.assign_variant("user_12345")
    user_a_second = exp.assign_variant("user_12345")
    assert user_a_first.name == user_a_second.name

    user_b_first = exp.assign_variant("user_99999")
    user_b_second = exp.assign_variant("user_99999")
    assert user_b_first.name == user_b_second.name


def test_experiment_manager():
    mgr = get_experiment_manager()
    exps = mgr.list_experiments()
    assert len(exps) >= 2
    exp_names = [e["name"] for e in exps]
    assert "recommender_algorithm_v2" in exp_names

    # Record conversion
    mgr.record_conversion("recommender_algorithm_v2", "control_hybrid", "recipe_clicked")


# ---------------------------------------------------------------------------
# 5. Azure AI Search Adapter Tests
# ---------------------------------------------------------------------------

def test_azure_search_schema():
    client = AzureAISearchClient(
        endpoint="https://mealmate-search.search.windows.net",
        api_key="mock_key",
        index_name="test-recipes",
    )
    schema = client.get_index_schema(vector_dim=768)
    assert schema["name"] == "test-recipes"
    fields = {f["name"]: f for f in schema["fields"]}
    assert "content_vector" in fields
    assert fields["content_vector"]["dimensions"] == 768
    assert "vectorSearch" in schema


# ---------------------------------------------------------------------------
# 6. API Route Integration Tests
# ---------------------------------------------------------------------------

def test_capabilities_endpoint_includes_enterprise_features(client: TestClient):
    resp = client.get("/capabilities")
    assert resp.status_code == 200
    data = resp.json()
    features = data["features"]
    assert features["knowledge_graph"] is True
    assert features["agent"] is True
    assert features["experiments"] is True
    assert features["azure_search"] is True


def test_knowledge_substitutes_endpoint(client: TestClient):
    resp = client.get("/knowledge/substitutes?ingredient=buttermilk")
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert len(data["substitutions"]) > 0


def test_knowledge_pairings_endpoint(client: TestClient):
    resp = client.get("/knowledge/pairings?ingredient=garlic")
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert isinstance(data["complements"], list)


def test_knowledge_graph_summary_endpoint(client: TestClient):
    resp = client.get("/knowledge/graph")
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["node_count"] >= 5


def test_agent_chat_endpoint(client: TestClient, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    payload = {
        "message": "What can I substitute for buttermilk?",
        "pantry": ["milk", "lemon"],
        "allergies": [],
    }
    resp = client.post("/agent/chat", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert len(data["reply"]) > 0


def test_experiments_endpoints(client: TestClient):
    # GET /experiments
    resp = client.get("/experiments")
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert len(data["experiments"]) >= 2

    # POST /experiments/conversion
    conv_payload = {
        "experiment": "recommender_algorithm_v2",
        "variant": "control_hybrid",
        "event": "recipe_cooked",
    }
    conv_resp = client.post("/experiments/conversion", json=conv_payload)
    assert conv_resp.status_code == 200
    assert conv_resp.json()["recorded"] is True
