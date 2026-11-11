# 🥗 MealMate

> **CS628 Masters Project — Team T03**
> Sumit K C · Thao Bui · Vishal Krishna Kumar
> Instructor: Prof. Sivakumar Visweswaran · City University of Seattle

AI-powered meal planning, pantry tracking, smart grocery list generation, and nutrition analytics — built as a 3-tier full-stack application.

---

## ✨ Features

### Core (all original, fully tested)
- **Auth** — JWT-based register / login, role-aware routes, persisted Zustand store on the client.
- **Recipes** — full CRUD with debounced URL-synced search, faceted filters (cuisine / tag / difficulty / max prep time), pagination, slug-based detail pages.
- **Pantry** — chip-style ingredient editor, dietary preferences, allergies — all persisted on the user document.
- **Drag-and-drop meal planner** — `react-dnd` weekly grid with sidebar drawer + mobile picker fallback, auto-creates plans on demand.
- **Smart grocery lists** — generated from a meal plan with category-grouped UI, optimistic checkbox toggles and progress bar.
- **Nutrition dashboard** — Recharts bar / stacked-bar visualisations of weekly calories and macros, plus daily breakdown table.
- **Animated UI** — framer-motion page transitions, staggered card entrance for similar recipes, animated AI status banners and assistant typing indicator, springy floating action button.
- **Production polish** — global error boundary, helmet + rate-limit + CORS on the API, Zod validation on every endpoint, structured pino logs, central error handler, optimistic React Query mutations, accessible UI primitives.

### Advanced AI / ML (paper-grade additions)
- **Hybrid recommender** — weighted blend of three classical signals: TF-IDF (lexical), LSA via TruncatedSVD (latent semantic), and item-item collaborative co-occurrence. Each result carries a `signals` array with per-strategy contributions for explainability. Strategy is user-selectable from the UI dropdown.
- **Multi-objective meal planner** — four optimisation presets (`balanced`, `eco`, `budget`, `pantry`) with overridable weights summing to 1.0. Heuristic and LLM paths both return per-meal, per-day and weekly sustainability summaries (CO₂ kg, USD cost, normalised eco-score).
- **Sustainability scoring** — ingredient-level CO₂ × cost database (categorised: produce, dairy, meat, seafood, grain, oil, spice, sweetener) seeded from Poore & Nemecek (2018) order-of-magnitude figures. Surfaced via a dedicated panel on the planner + a per-recipe `/footprint` endpoint.
- **Pantry vision** — fridge / shelf photo upload → Gemini Vision → structured pantry items. SHA-256 fingerprint cache to dedupe identical images. Graceful structured `available: false` payload when the LLM is not configured.
- **Observability** — Prometheus `/metrics` endpoints on both the AI service and Node API (request counters, latency histograms, LLM call counters, cache hit/miss). Correlation-ID middleware threads `X-Correlation-ID` through logs and downstream calls. OpenAPI 3.0.3 spec + Swagger UI at `/api/docs`.
- **Realtime collaboration** — Socket.IO gateway at `/api/realtime` with JWT auth and per-meal-plan rooms. The planner page auto-refreshes whenever another browser tab / device edits the same plan.
- **Offline + PWA** — `vite-plugin-pwa` installs a service worker with stale-while-revalidate caching of read-only recipe and capabilities endpoints; web manifest enables installable home-screen icon.
- **PDF export** — client-side jsPDF generators for the weekly meal plan (with sustainability summary + per-day CO₂ / cost) and the categorised grocery list.
- **TTL-LRU LLM cache** — thread-safe cache for every Gemini call (chat, planner, smart paste, vision), wired to Prometheus hit/miss counters.
- **Evaluation harness** — leave-one-out pantry-completion proxy in `ai-service/eval/run_eval.py` that scores TF-IDF / LSA / collab / hybrid on Recall@5/10, MRR, NDCG@10 and median latency, writing `eval_results.json` + `eval_report.md`.

### Recipe & assistant features (kept and extended)
- **AI recommendations** — the *Suggested for you* panel now exposes the strategy dropdown and per-card signal breakdowns.
- **Similar recipes (nearest-neighbour)** — every recipe detail page renders a *You might also like* panel; strategy is configurable on the same query.
- **AI “Generate my week” planner** — one-click, auto-fills the entire 7-day × 3-meal plan from your pantry + dietary preferences + allergies + chosen objective. Deterministic heuristic by default; optional Gemini-backed strategy with graceful heuristic fallback.
- **Gemini cooking assistant** — floating chat widget available everywhere once you log in. Multi-turn, profile-aware (knows your pantry, preferences and allergies), with auto-generated follow-up suggestion chips. Falls back to a deterministic offline reply when no API key is configured.
- **Smart pantry paste** — paste freeform text (“half a red onion, 200 g chicken breast, leftover rice…”) and the AI service extracts structured ingredient/quantity/unit triples. Gemini path when configured, regex/keyword fallback otherwise — always works offline.

### Legal, Privacy & Compliance (GDPR / CCPA / COPPA)
- **Data Subject Rights & Portability** — dedicated self-service portal at `/privacy/manage` with single-click GDPR Art. 15 / 20 / CCPA machine-readable JSON data export (`GET /api/auth/me/export`) and GDPR Art. 17 cascading erasure (`DELETE /api/auth/me`) wiping user profiles, meal plans, grocery lists, and recipes.
- **Sensitive Dietary Consent** — explicit opt-in checkboxes for processing health-adjacent dietary preferences and allergen profiles under GDPR Art. 9(2)(a).
- **Age Restriction Enforcement** — mandatory COPPA (13+) and EEA GDPR (16+) age gating on account registration.
- **Cookie & Storage Consent Banner** — GDPR / ePrivacy Directive compliant cookie consent dialog with fine-grained category controls (Necessary, Analytics, Preferences, Marketing) and persistent preference re-opening.
- **Medical & Dietetic Disclaimers** — non-medical advice warning banners across Recipe Details, Nutrition Dashboard, and AI Assistant clarifying that meal suggestions do not constitute licensed medical or dietitian care.
- **Open Source License Catalog** — transparent third-party attribution portal at `/attributions` documenting all MIT, Apache 2.0, and BSD-3 dependencies.
- **FTC Claim Substantiation** — documented offline benchmark citations (`NDCG@10`) for homepage recommendation claims.
- **Audit Documentation** — comprehensive regulatory evaluation matrix in [`docs/LEGAL_COMPLIANCE_AUDIT.md`](docs/LEGAL_COMPLIANCE_AUDIT.md).

---

## 🏗️ Architecture

| Layer | Tech | Folder |
|---|---|---|
| Frontend | React 18 · Vite 5 · TypeScript · Tailwind · TanStack Query · Zustand · React DnD · Recharts · framer-motion | [`client/`](client) |
| Backend API | Node.js 20 · Express 4 · TypeScript · Mongoose · Zod · pino · JWT | [`server/`](server) |
| AI / ML Service | Python 3.12 · FastAPI · scikit-learn (TF-IDF + cosine) · Google Gemini SDK (optional) | [`ai-service/`](ai-service) |
| Database | MongoDB 7 — system install **not required**; the repo ships an embedded dev Mongo via [`server/scripts/dev-mongo.mjs`](server/scripts/dev-mongo.mjs) | local: `.mongo-data/` · docker: `mongo` service |
| Orchestration | Docker Compose (optional) | [`docker-compose.yml`](docker-compose.yml) |
| CI | GitHub Actions (lint, typecheck, tests, docker build) | [`.github/workflows/ci.yml`](.github/workflows/ci.yml) |

```
┌────────────┐   /api/*     ┌────────────┐   /recommend   ┌────────────┐
│  React SPA │ ───────────► │  Express   │ ─────────────► │  FastAPI   │
│  (nginx)   │              │  + Mongo   │                │  + sklearn │
└────────────┘              └────────────┘                └────────────┘
```

---

## 🚀 Quick start

Pick one of two paths. Both produce the same app at <http://localhost:3000>.

| Path | Best for | Prereqs |
|---|---|---|
| **A. Local dev (no Docker)** ← *what we use day-to-day* | hot-reload coding, demos, low overhead | Node ≥ 20 · Python ≥ 3.12 · npm · git |
| **B. Docker Compose** | one-shot bring-up with no toolchain on the host | Docker 24+ · Compose v2 |

---

## 🅰️ Local dev — no Docker (recommended)

This is the path actively maintained for the team and how the app is being run today. **You do *not* need to install MongoDB** — [`server/scripts/dev-mongo.mjs`](server/scripts/dev-mongo.mjs) spins up an embedded persistent MongoDB on `127.0.0.1:27017` via `mongodb-memory-server` and writes its files to `server/.mongo-data/` (gitignored).

### Prerequisites

- Node.js **≥ 20** (verified on 20 and 24)
- Python **≥ 3.12** (verified on 3.12 and 3.14)
- npm ≥ 10, git
- *(optional)* a [Google AI Studio](https://aistudio.google.com/app/apikey) key to unlock the Gemini-powered features

> On Python 3.14, pass `--only-binary=:all:` to pip so it grabs prebuilt scikit-learn / numpy wheels instead of trying to compile from source.

### 1. Clone the repo

```bash
git clone https://github.com/<your-org-or-user>/mealmate.git
cd mealmate
```

### 2. Install dependencies (once)

```bash
# Backend API
cd server     && npm install && cd ..

# Frontend
cd client     && npm install && cd ..
```

Then create the Python virtualenv for the AI service:

**Windows (PowerShell)**
```powershell
cd ai-service
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt -r requirements-dev.txt
cd ..
```

**macOS / Linux**
```bash
cd ai-service
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
cd ..
```

### 3. Create the three `.env` files

Each package ships an `.env.example` with safe development defaults. Copy them — the real `.env` files are gitignored.

**Windows (PowerShell)**
```powershell
Copy-Item .\server\.env.example     .\server\.env
Copy-Item .\client\.env.example     .\client\.env
Copy-Item .\ai-service\.env.example .\ai-service\.env
```

**macOS / Linux**
```bash
cp server/.env.example     server/.env
cp client/.env.example     client/.env
cp ai-service/.env.example ai-service/.env
```

The defaults already work out of the box:

- `server/.env` — `MONGO_URI=mongodb://127.0.0.1:27017/mealmate`, dev `JWT_SECRET`, `AI_SERVICE_URL=http://localhost:8000`. **Replace `JWT_SECRET` with a fresh 48+ char random string before any deployment.**
- `client/.env` — points Vite at the local API and AI service.
- `ai-service/.env` — leaves `GEMINI_API_KEY=` empty. Paste your Google AI Studio key here to enable the cooking assistant, smart pantry paste, vision pantry capture, and the LLM-backed week planner. The default model is **`gemini-3.5-flash`** (override via `GEMINI_MODEL`). Without a key, every AI surface degrades gracefully to its deterministic offline path.

### 4. Start the four services (four terminals)

Keep each terminal open — they stream logs while you develop.

| # | Folder | Command | Listens on |
|---|---|---|---|
| 1 | `server/`     | `node scripts/dev-mongo.mjs`                                       | `mongodb://127.0.0.1:27017` |
| 2 | `ai-service/` | `python -m uvicorn app.main:app --host 127.0.0.1 --port 8000`      | <http://localhost:8000>     |
| 3 | `server/`     | `npm run dev`                                                      | <http://localhost:5000>     |
| 4 | `client/`     | `npm run dev`                                                      | <http://localhost:3000>     |

**Windows (PowerShell) — copy-paste, one block per terminal**

```powershell
# Terminal 1 — embedded MongoDB (data persists to server\.mongo-data\)
cd path\to\mealmate\server
node .\scripts\dev-mongo.mjs
```

```powershell
# Terminal 2 — FastAPI AI / ML service
cd path\to\mealmate\ai-service
.\.venv\Scripts\Activate.ps1
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

```powershell
# Terminal 3 — Express API (wait until terminals 1 + 2 are up)
cd path\to\mealmate\server
npm run dev
```

```powershell
# Terminal 4 — Vite React client
cd path\to\mealmate\client
npm run dev
```

**macOS / Linux** — identical, with `source .venv/bin/activate` instead of `.\.venv\Scripts\Activate.ps1` and forward-slash paths.

When everything is healthy you should see:

```
[dev-mongo] running at mongodb://127.0.0.1:27017/
INFO:     Uvicorn running on http://127.0.0.1:8000
INFO: ✅ MongoDB connected: 127.0.0.1/mealmate
INFO: 🚀 MealMate server listening on http://localhost:5000 [development]
VITE v5.4.21  ready  ➜  Local: http://localhost:3000/
```

### 5. Seed the recipe collection (one-time)

Open a fifth, short-lived terminal:

```bash
cd server
npm run seed
# → Seed complete. Upserted 64 recipes; collection now has 64.
```

### 6. Open the app

| URL | What |
|---|---|
| **<http://localhost:3000>**        | React client (Vite, proxies `/api/*` → `:5000`) |
| <http://localhost:5000/api/health> | Express health check |
| <http://localhost:5000/api/docs>   | OpenAPI 3.0.3 / Swagger UI |
| <http://localhost:5000/metrics>    | Prometheus metrics (server) |
| <http://localhost:8000/health>     | AI service health check |
| <http://localhost:8000/metrics>    | Prometheus metrics (AI service) |

Register a new account, drop a few recipes into the planner, and the AI panels (recommendations, week planner, assistant) will light up. With no Gemini key set, the heuristic fallbacks kick in automatically.

### 7. Stopping & resetting

- `Ctrl+C` in each terminal stops that service.
- Delete `server/.mongo-data/` to wipe users / recipes / meal plans and start fresh.
- Or set `MONGO_EPHEMERAL=1` before `node scripts/dev-mongo.mjs` for an in-memory-only DB (no persistence).

---

## 🅱️ Alternative — Docker Compose

Prerequisites: Docker 24+ and Docker Compose v2.

```bash
git clone https://github.com/<your-org-or-user>/mealmate.git
cd mealmate

# Optional: override secrets via a root .env
echo "JWT_SECRET=$(openssl rand -base64 48)" > .env

docker compose up --build
```

| URL | What |
|---|---|
| <http://localhost:8080>            | React client (nginx, proxies `/api/*` to the server) |
| <http://localhost:8080/api/health> | Server health |
| (internal) `ai-service:8000`       | AI microservice — internal-only by default |

Seed inside the running stack and tear it down when finished:

```bash
docker compose exec server npm run seed
docker compose down -v   # -v also wipes the Mongo volume
```

---

## 🧪 Testing

| Layer | Command | Stack |
|---|---|---|
| Server | `cd mealmate/server && npm test` | Jest + Supertest + `mongodb-memory-server` |
| Client | `cd mealmate/client && npm test` | Vitest + React Testing Library + jsdom |
| AI service | `cd mealmate/ai-service && pytest -q` | pytest + FastAPI TestClient |

Current totals: **59 server** · **14 client** · **55 AI** · = **128 tests, all green**.

The server suite covers auth, recipes CRUD + search/filter, meal plans (with realtime broadcasts), grocery aggregation, nutrition rollups, and the AI proxy routes (recommend / similar / plan-week / chat / pantry-parse / pantry-vision / footprint / interactions / capabilities) with the Python service mocked at the `aiClient` boundary. The AI suite covers TF-IDF + LSA + collab training, hybrid recommendation ranking, similar-recipe lookup, both heuristic and LLM-fallback paths of the week-planner (across all four objectives), sustainability scoring, TTL-LRU cache invariants, the cooking-assistant chat (Gemini mocked), the smart pantry parser, the pantry-vision graceful-degradation path, and the capabilities probe.

### 📊 Recommender evaluation

`ai-service/eval/run_eval.py` runs a leave-one-out pantry-completion proxy across 64 seed recipes (seed = 42, 30 % of ingredients masked per query, top-k = 10):

| Strategy | Recall@5 | Recall@10 | MRR | NDCG@10 | Median latency |
|----------|---------:|----------:|------:|--------:|---------------:|
| TF-IDF   | **1.00** | **1.00**  | 0.915 | 0.937   | 1.54 ms |
| LSA      | **1.00** | **1.00**  | 0.908 | 0.931   | 1.57 ms |
| Collab   | 0.11     | 0.25      | 0.057 | 0.101   | 1.65 ms |
| Hybrid   | **1.00** | **1.00**  | 0.915 | 0.937   | 1.73 ms |

On the bundled seed corpus the lexical signal saturates Recall, so TF-IDF and the hybrid are tied; the LSA signal trails by < 1 NDCG point. The collaborative-filtering channel is cold-start by construction (no real user interactions in the seed data) — it earns its keep once `POST /interactions/record` is fed from production telemetry. Methodology and rerun instructions are in [`ai-service/eval/README.md`](ai-service/eval/README.md).

---

## 📂 Project layout

```
mealmate/
├── client/              React + Vite SPA
│   ├── src/components/  UI primitives, layout, recipes, error boundary
│   ├── src/hooks/       useAuth, useRecipes, useRecommendations, …
│   ├── src/pages/       Routed pages
│   └── Dockerfile       Multi-stage Vite → nginx
├── server/              Node + Express API
│   ├── src/models/      Mongoose schemas (User, Recipe, MealPlan, GroceryList)
│   ├── src/controllers/ Auth, recipes, meal-plans, grocery, nutrition
│   ├── src/routes/      Express routers + Zod validation
│   ├── src/services/    aiClient (axios → ai-service)
│   ├── src/scripts/     seedRecipes.ts
│   └── Dockerfile       Multi-stage Node build
├── ai-service/          FastAPI + scikit-learn + Gemini
│   ├── app/             main, recommender, planner, chat, pantry_parser, gemini, schemas, config
│   ├── data/recipes.json  bundled training set (64 recipes, multi-cuisine)
│   └── Dockerfile       Python 3.12-slim
├── docker-compose.yml   Mongo + ai-service + server + client
└── .github/workflows/   CI: lint, typecheck, test, docker build
```

---

## 🔐 Security notes

- Passwords are hashed with `bcryptjs` (cost 10).
- JWTs are signed with HS256 and expire in 7 days by default.
- API: `helmet`, CORS allow-list, `express-rate-limit`, body-size limits.
- Validation: every request body / params / query is validated with Zod before the controller runs.
- Mongoose schemas are strict; user input never leaks into queries.
- `.env` files are gitignored; rotate the demo `JWT_SECRET` before any public deployment.

---

## 📜 License

Academic project — CS628 Spring 2026, City University of Seattle.
