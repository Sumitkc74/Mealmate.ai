from fastapi.testclient import TestClient

from app.main import app


def test_health_endpoint() -> None:
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["service"] == "mealmate-ai-service"
    assert body["model_loaded"] is True


def test_recommend_endpoint_returns_results() -> None:
    client = TestClient(app)
    response = client.post(
        "/recommend",
        json={"ingredients": ["chicken", "rice", "garlic"], "top_k": 3},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["count"] == 3
    assert len(body["results"]) == 3
    assert body["results"][0]["score"] >= body["results"][1]["score"]


def test_recommend_validation_error() -> None:
    client = TestClient(app)
    response = client.post("/recommend", json={"top_k": 0})
    assert response.status_code == 422
