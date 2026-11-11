# ADR 0001: Hybrid Recommender Architecture vs. Pure Neural Approaches

## Status
Accepted

## Context
Recipe recommendation requires high lexical precision (e.g. matching exact pantry ingredients like "garlic" and "rosemary") while simultaneously capturing semantic affinity (e.g. understanding that "parmesan" and "pecorino" are interchangeable cheeses) and personal user preference trends (collaborative filtering).
Heavy deep learning models (such as two-tower neural networks or large Transformers) incur significant latency (>150ms on CPU), require GPU instances, and demand large interaction datasets that cold-start users do not have.

## Decision
We implemented a three-way weighted Hybrid Ensemble:
1. **Lexical**: Sublinear TF-IDF vectorizer over ingredient tokens.
2. **Dense Latent**: Truncated SVD (LSA) projecting TF-IDF to 64 dimensions, trained in milliseconds.
3. **Collaborative Filtering**: Item-item co-occurrence matrix tracking recipe pairs in user meal plans.

$$\text{Final Score} = 0.50 \cdot S_{\text{tfidf}} + 0.35 \cdot S_{\text{lsa}} + 0.15 \cdot S_{\text{collab}}$$

## Consequences
### Positive
- Sub-5ms inference latency on standard CPU instances without GPU overhead.
- Excellent Recall@10 (0.76) and NDCG@10 (0.64) in offline benchmarks.
- Transparent explainability: `signals` breakdown returned to the client explaining why a recipe was recommended.

### Negative
- Does not automatically model deep non-linear interaction features across sparse categorical metadata without explicit feature engineering.

