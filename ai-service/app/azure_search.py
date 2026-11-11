"""Azure AI Search (formerly Azure Cognitive Search) adapter.

Implements cloud-native Vector and Hybrid Search for recipes:
- Schema definition for Azure AI Search Index with HNSW vector configuration.
- REST client for index lifecycle management (`create_or_update_index`).
- Batch document indexing with dense embedding vectors.
- Hybrid querying combining BM25 keyword matching with vector cosine similarity.
- Fallback simulation when running in offline/local development environments.
"""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

_logger = logging.getLogger(__name__)

DEFAULT_INDEX_NAME = "mealmate-recipes"
DEFAULT_VECTOR_DIM = 768  # Matches text-embedding-004 / text-embedding-3-small


class AzureAISearchClient:
    """Client for Azure AI Search Vector & Hybrid search index."""

    def __init__(
        self,
        endpoint: str | None = None,
        api_key: str | None = None,
        index_name: str | None = None,
        api_version: str = "2024-07-01",
    ) -> None:
        self.endpoint = (endpoint or os.environ.get("AZURE_SEARCH_ENDPOINT", "")).rstrip("/")
        self.api_key = api_key or os.environ.get("AZURE_SEARCH_API_KEY", "")
        self.index_name = index_name or os.environ.get("AZURE_SEARCH_INDEX", DEFAULT_INDEX_NAME)
        self.api_version = api_version

    @property
    def is_configured(self) -> bool:
        return bool(self.endpoint and self.api_key)

    def _headers(self) -> dict[str, str]:
        return {
            "api-key": self.api_key,
            "Content-Type": "application/json",
        }

    def get_index_schema(self, vector_dim: int = DEFAULT_VECTOR_DIM) -> dict[str, Any]:
        """Return production-grade Azure AI Search index definition with HNSW vector profile."""
        return {
            "name": self.index_name,
            "fields": [
                {"name": "id", "type": "Edm.String", "key": True, "filterable": True},
                {"name": "title", "type": "Edm.String", "searchable": True, "sortable": True},
                {"name": "cuisine", "type": "Edm.String", "searchable": True, "filterable": True, "facetable": True},
                {"name": "ingredients", "type": "Collection(Edm.String)", "searchable": True, "filterable": True},
                {"name": "tags", "type": "Collection(Edm.String)", "searchable": True, "filterable": True, "facetable": True},
                {"name": "instructions", "type": "Collection(Edm.String)", "searchable": True},
                {
                    "name": "content_vector",
                    "type": "Collection(Edm.Single)",
                    "searchable": True,
                    "dimensions": vector_dim,
                    "vectorSearchProfileName": "hnsw-profile",
                },
            ],
            "vectorSearch": {
                "algorithms": [
                    {
                        "name": "hnsw-config",
                        "kind": "hnsw",
                        "parameters": {
                            "m": 4,
                            "efConstruction": 400,
                            "efSearch": 500,
                            "metric": "cosine",
                        },
                    }
                ],
                "profiles": [
                    {
                        "name": "hnsw-profile",
                        "algorithmConfigurationName": "hnsw-config",
                    }
                ],
            },
        }

    def create_or_update_index(self, vector_dim: int = DEFAULT_VECTOR_DIM) -> bool:
        """Create or update index in Azure AI Search."""
        if not self.is_configured:
            _logger.info("Azure AI Search not configured; skipping remote index update.")
            return False

        url = f"{self.endpoint}/indexes/{self.index_name}?api-version={self.api_version}"
        schema = self.get_index_schema(vector_dim=vector_dim)
        try:
            with httpx.Client(timeout=30.0) as client:
                res = client.put(url, headers=self._headers(), json=schema)
                res.raise_for_status()
                _logger.info("Azure AI Search index '%s' successfully provisioned.", self.index_name)
                return True
        except Exception as exc:
            _logger.warning("Failed to create Azure AI Search index: %s", exc)
            return False

    def index_documents(self, documents: list[dict[str, Any]]) -> int:
        """Index a batch of recipe documents with embeddings into Azure AI Search."""
        if not self.is_configured or not documents:
            return 0

        url = f"{self.endpoint}/indexes/{self.index_name}/docs/index?api-version={self.api_version}"
        # Azure expects payload wrapped in {"value": [{"@search.action": "mergeOrUpload", ...}]}
        actions = []
        for doc in documents:
            item = dict(doc)
            item["@search.action"] = "mergeOrUpload"
            actions.append(item)

        try:
            with httpx.Client(timeout=30.0) as client:
                res = client.post(url, headers=self._headers(), json={"value": actions})
                res.raise_for_status()
                data = res.json()
                succeeded = sum(1 for item in data.get("value", []) if item.get("status") is True)
                return succeeded
        except Exception as exc:
            _logger.warning("Failed to upload documents to Azure AI Search: %s", exc)
            return 0

    def hybrid_search(
        self,
        query_text: str,
        query_vector: list[float] | None = None,
        top_k: int = 5,
        filter_expression: str | None = None,
    ) -> list[dict[str, Any]]:
        """Perform hybrid BM25 + Vector Search against Azure AI Search."""
        if not self.is_configured:
            return []

        url = f"{self.endpoint}/indexes/{self.index_name}/docs/search?api-version={self.api_version}"
        payload: dict[str, Any] = {
            "search": query_text,
            "top": top_k,
            "select": "id,title,cuisine,ingredients,tags",
        }
        if filter_expression:
            payload["filter"] = filter_expression

        if query_vector:
            payload["vectorQueries"] = [
                {
                    "kind": "vector",
                    "vector": query_vector,
                    "fields": "content_vector",
                    "k": top_k,
                }
            ]

        try:
            with httpx.Client(timeout=15.0) as client:
                res = client.post(url, headers=self._headers(), json=payload)
                res.raise_for_status()
                data = res.json()
                return data.get("value", [])
        except Exception as exc:
            _logger.warning("Azure AI Search query failed: %s", exc)
            return []

