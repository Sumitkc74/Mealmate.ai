# MealMate Recommender Evaluation
_Corpus: **64 recipes** · Pantry sample: **30 %** of each recipe's ingredients · Top-K: **10** · Seed: **42**_

## Held-out pantry-completion proxy
For each recipe we sample 30 % of its ingredients as the user query, then check whether the held-out recipe re-appears in each strategy's top-K. The collaborative strategy additionally receives one synthetic 'liked' recipe drawn from a tag-matched neighbour.

| Strategy | Recall@5 | Recall@10 | MRR | NDCG@10 | Median latency (ms) | Queries |
|---|---:|---:|---:|---:|---:|---:|
| `tfidf` | 1.000 | 1.000 | 0.915 | 0.937 | 3.47 | 64 |
| `lsa` | 1.000 | 1.000 | 0.908 | 0.931 | 3.71 | 64 |
| `collab` | 0.109 | 0.250 | 0.057 | 0.101 | 3.81 | 64 |
| `hybrid` | 1.000 | 1.000 | 0.915 | 0.937 | 3.63 | 64 |

**Best NDCG@10:** `tfidf` with NDCG@10 = 0.937 (100.0 % recall@10).

_Limitations:_ this is an offline proxy; the synthetic pantry comes from the held-out recipe itself, which biases the lexical signal. The intended use is to track *relative* improvement from adding the LSA and collaborative signals to TF-IDF and to set a baseline before deploying online A/B tests.
