# ADR 0005: In-Memory Culinary Knowledge Graph & Substitution Engine

## Status
Accepted

## Context
Raw vector similarity often fails to capture culinary functional equivalence. For example, "buttermilk" in a baking recipe provides acidity and leavening activation, meaning "milk + lemon juice" is a functional equivalent even though their text embeddings differ substantially. Furthermore, user allergy queries require ontological expansion (e.g. avoiding "dairy" must exclude butter, cheese, whey, yogurt, and ghee).

## Decision
We implemented a domain-specific Culinary Knowledge Graph (`app/knowledge_graph.py`):
1. **Entity Graph**: Models ingredients, categories, functional roles (`acid`, `leavener`, `binder`, `emulsifier`), and flavor pairings.
2. **Context-Aware Substitutions**: Maps source ingredients to substitutes with precise volumetric ratios and culinary contexts (`baking`, `savoury`, `vegan`, `gluten-free`).
3. **Allergen Hierarchy Expansion**: Expands broad allergy terms into exhaustive sets of constituent ingredient names.
4. **Graph-Augmented Retrieval (GraphRAG)**: Enriches recipe metadata with flavor profiles and pairings before LLM augmentation.

## Consequences
### Positive
- Sub-millisecond graph traversal without external graph database dependencies (e.g. Neo4j).
- Guarantees 100% accurate substitution ratios (e.g. 1 egg $\to$ 1 tbsp ground flaxseed + 3 tbsp water).
- Seamlessly injects culinary domain intelligence into both the RAG pipeline and agentic tools.

