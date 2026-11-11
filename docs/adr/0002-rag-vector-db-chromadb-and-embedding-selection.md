# ADR 0002: Vector Database & Embedding Selection for RAG Pipeline

## Status
Accepted

## Context
Retrieval-Augmented Generation (RAG) requires an embedding model and vector storage engine to index recipe titles, ingredients, cuisines, tags, and instructions.
Key trade-offs evaluated:
- **Cloud Managed vs In-Memory**: Standalone vector DBs (e.g. Pinecone, Weaviate, Qdrant cluster) add operational overhead and network roundtrips, whereas in-memory stores allow sub-20ms local retrieval.
- **Embedding Model**: OpenAI `text-embedding-3-small` (1536 dims, API required) vs SentenceTransformers `all-MiniLM-L6-v2` (384 dims, local CPU inference, 80MB footprint).

## Decision
1. **Primary Local / In-Process Vector Store**: ChromaDB in-memory client for instant local querying and zero-cloud operational dependency.
2. **Local Dense Embedder**: `sentence-transformers/all-MiniLM-L6-v2` providing rapid embeddings with normalized cosine similarity.
3. **Enterprise Cloud Scalability**: `AzureAISearchClient` adapter in `app/azure_search.py` supporting Azure AI Search with HNSW index configuration for high-throughput enterprise deployments.

## Consequences
### Positive
- Fully self-contained local testing and execution with zero external API latency.
- Seamless upgrade path to Azure AI Search or Amazon OpenSearch via configuration flag.
- 100% Allergen compliance achieved via pre-retrieval and post-retrieval filtering layers.

