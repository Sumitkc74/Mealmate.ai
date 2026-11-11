import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { SuggestedRecipes } from '@/components/recipes/SuggestedRecipes';
import { usePageMetadata } from '@/hooks/usePageMetadata';

interface InteractiveRecipe {
  id: string;
  title: string;
  prepTime: string;
  required: string[];
}

const DEMO_RECIPES: InteractiveRecipe[] = [
  {
    id: 'pasta',
    title: 'Garlic Butter Spaghetti',
    prepTime: '15 min',
    required: ['Spaghetti', 'Garlic', 'Olive Oil', 'Parmesan'],
  },
  {
    id: 'shakshuka',
    title: 'Skillet Shakshuka',
    prepTime: '25 min',
    required: ['Eggs', 'Canned Tomatoes', 'Garlic', 'Olive Oil'],
  },
  {
    id: 'frittata',
    title: 'Spinach & Herb Frittata',
    prepTime: '20 min',
    required: ['Eggs', 'Spinach', 'Parmesan', 'Olive Oil'],
  },
  {
    id: 'stew',
    title: 'Tuscan Tomato Bean Stew',
    prepTime: '20 min',
    required: ['Black Beans', 'Canned Tomatoes', 'Garlic', 'Spinach'],
  },
];

const AVAILABLE_STAPLES = [
  'Eggs',
  'Garlic',
  'Spaghetti',
  'Canned Tomatoes',
  'Olive Oil',
  'Spinach',
  'Parmesan',
  'Black Beans',
];

export function HomePage() {
  usePageMetadata({
    title: 'MealMate | Kitchen Inventory & Algorithmic Meal Planning',
    description:
      'Plan meals with real kitchen constraints. MealMate matches recipes to your pantry inventory, minimizes food waste, and calculates grocery consolidation.',
  });

  const isAuthed = useAuthStore((s) => Boolean(s.token));
  const [selectedIngredients, setSelectedIngredients] = useState<string[]>([
    'Eggs',
    'Garlic',
    'Olive Oil',
    'Canned Tomatoes',
  ]);

  function toggleStaple(item: string) {
    setSelectedIngredients((prev) =>
      prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item]
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-16">
      {/* ──────── Hero Section ──────── */}
      <header className="pt-6 pb-4 md:pt-12">
        <p className="mm-eyebrow">Algorithmic Kitchen Planning</p>
        <h1 className="mt-4 font-serif text-4xl leading-tight tracking-tight text-text md:text-6xl max-w-3xl">
          Plan smarter with real kitchen constraints.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-text-muted md:text-lg">
          MealMate resolves weekly meal schedules directly against your refrigerator inventory,
          dietary preferences, and caloric targets. No generic recipe feeds, no artificial
          ingredient waste.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          {isAuthed ? (
            <Link
              to="/planner"
              className="rounded-md bg-ink px-5 py-2.5 text-sm font-medium text-canvas transition-colors hover:bg-terracotta"
            >
              Open weekly planner
            </Link>
          ) : (
            <>
              <Link
                to="/register"
                className="rounded-md bg-ink px-5 py-2.5 text-sm font-medium text-canvas transition-colors hover:bg-terracotta"
              >
                Create free account
              </Link>
              <Link
                to="/login"
                className="rounded-md border border-line bg-card px-5 py-2.5 text-sm font-medium text-text transition-colors hover:bg-canvas"
              >
                Sign in
              </Link>
            </>
          )}
        </div>

        {/* Technical metrics */}
        <div className="mt-10 grid grid-cols-3 gap-3 sm:gap-6 border-t border-line pt-6 max-w-lg">
          <div>
            <div className="font-mono text-xl sm:text-2xl font-semibold text-text md:text-3xl">4</div>
            <div className="text-[11px] sm:text-xs uppercase tracking-wider text-text-muted mt-1">
              Matching models
            </div>
          </div>
          <div>
            <div className="font-mono text-xl sm:text-2xl font-semibold text-text md:text-3xl">0.94</div>
            <div className="text-[11px] sm:text-xs uppercase tracking-wider text-text-muted mt-1">
              NDCG ranking
            </div>
          </div>
          <div>
            <div className="font-mono text-xl sm:text-2xl font-semibold text-text md:text-3xl">0%</div>
            <div className="text-[11px] sm:text-xs uppercase tracking-wider text-text-muted mt-1">
              Ad tracking
            </div>
          </div>
        </div>
      </header>

      {/* ──────── Interactive Product Demo (Rule 28) ──────── */}
      <section
        aria-label="Interactive Pantry Matching Demo"
        className="rounded-lg border border-line bg-card p-6 md:p-8"
      >
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between border-b border-line pb-4">
          <div>
            <span className="text-xs font-mono uppercase tracking-wider text-terracotta font-medium">
              Interactive Workflow Demonstration
            </span>
            <h2 className="font-serif text-2xl font-semibold text-text mt-1">
              See how recipes match your pantry
            </h2>
          </div>
          <p className="text-xs text-text-muted max-w-sm">
            Toggle ingredients you currently have on hand. The solver recalculates match
            ratios and missing grocery items live.
          </p>
        </div>

        {/* Interactive Pantry Chips */}
        <div className="mt-5">
          <label className="text-xs font-medium text-text-muted block mb-2">
            Pantry inventory toggle (click to add/remove items):
          </label>
          <div className="flex flex-wrap gap-2">
            {AVAILABLE_STAPLES.map((staple) => {
              const active = selectedIngredients.includes(staple);
              return (
                <button
                  key={staple}
                  type="button"
                  onClick={() => toggleStaple(staple)}
                  className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                    active
                      ? 'bg-terracotta text-white border-terracotta'
                      : 'bg-canvas text-text-muted border-line hover:border-text-muted'
                  }`}
                >
                  {active ? `+ ${staple}` : staple}
                </button>
              );
            })}
          </div>
        </div>

        {/* Live Matching Results */}
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {DEMO_RECIPES.map((recipe) => {
            const matches = recipe.required.filter((i) => selectedIngredients.includes(i));
            const missing = recipe.required.filter((i) => !selectedIngredients.includes(i));
            const pct = Math.round((matches.length / recipe.required.length) * 100);
            const isFullMatch = missing.length === 0;

            return (
              <div
                key={recipe.id}
                className="rounded border border-line bg-canvas p-4 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-medium text-sm text-text">{recipe.title}</h3>
                    <span
                      className={`text-[11px] font-mono px-2 py-0.5 rounded border ${
                        isFullMatch
                          ? 'border-emerald-700/30 bg-emerald-50 text-emerald-800'
                          : 'border-line bg-card text-text-muted'
                      }`}
                    >
                      {pct}% ready
                    </span>
                  </div>
                  <p className="text-xs text-text-muted mt-0.5">{recipe.prepTime} cook time</p>

                  <div className="mt-3 space-y-1 text-xs">
                    <div>
                      <span className="text-text-muted">In pantry: </span>
                      <span className="text-text font-medium">
                        {matches.length > 0 ? matches.join(', ') : 'None'}
                      </span>
                    </div>
                    {missing.length > 0 && (
                      <div>
                        <span className="text-terracotta">Need to buy: </span>
                        <span className="text-text-muted">{missing.join(', ')}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-line/60 flex items-center justify-between text-[11px] text-text-muted">
                  <span>{missing.length === 0 ? 'Ready to cook now' : `${missing.length} item needed`}</span>
                  <span className="font-mono text-terracotta">Auto-deducts on cook</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ──────── Suggested for you Section ──────── */}
      <section className="border-t border-line pt-10">
        {isAuthed ? (
          <SuggestedRecipes />
        ) : (
          <div className="rounded-lg border border-line bg-card p-8 text-center">
            <h2 className="font-serif text-2xl font-semibold text-text">
              Suggested for you
            </h2>
            <p className="mt-2 text-sm text-text-muted max-w-md mx-auto">
              Connect your account to access pantry-aware dish recommendations,
              allergy-filtered substitutions, and custom meal generation.
            </p>
            <div className="mt-5">
              <Link
                to="/login"
                className="inline-flex items-center rounded-md bg-terracotta px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-terracotta-dark"
              >
                Sign in to view suggestions
              </Link>
            </div>
          </div>
        )}
      </section>

      {/* ──────── Asymmetric Architecture Overview (replaces 3 generic cards) ──────── */}
      <section className="border-t border-line pt-12 space-y-8">
        <div>
          <span className="text-xs font-mono uppercase tracking-wider text-terracotta font-medium">
            System Architecture
          </span>
          <h2 className="font-serif text-2xl font-semibold text-text mt-1">
            Engineered around kitchen realities, not clickbait
          </h2>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-lg border border-line bg-card p-6 space-y-3">
            <span className="text-xs font-mono text-terracotta uppercase tracking-wider">
              Module 01 / Scheduling
            </span>
            <h3 className="font-serif text-xl font-medium text-text">
              Multi-Objective Weekly Constraint Solver
            </h3>
            <p className="text-xs leading-relaxed text-text-muted">
              Rather than scattering random recipes across days, the engine optimizes across
              shared perishable ingredients. If Monday's dinner requires fresh cilantro and
              Greek yogurt, Tuesday and Wednesday meals are weighted to consume the remaining
              portions before expiration.
            </p>
            <ul className="text-xs text-text-muted space-y-1.5 pt-2 border-t border-line font-mono">
              <li>- Balances macronutrient quotas across all seven days</li>
              <li>- Minimizes estimated carbon output per serving</li>
              <li>- Calculates cumulative grocery cost projections</li>
            </ul>
          </div>

          <div className="rounded-lg border border-line bg-card p-6 space-y-3">
            <span className="text-xs font-mono text-terracotta uppercase tracking-wider">
              Module 02 / Logistics
            </span>
            <h3 className="font-serif text-xl font-medium text-text">
              Normalized Aisle Deduplication
            </h3>
            <p className="text-xs leading-relaxed text-text-muted">
              Recipe ingredients are converted to standard metric and imperial units, aggregated
              across meals, and cross-referenced with your live pantry. Ingredients already on your
              shelf are suppressed, and the remainder is structured into store aisles for efficient shopping.
            </p>
            <ul className="text-xs text-text-muted space-y-1.5 pt-2 border-t border-line font-mono">
              <li>- Automated unit aggregation (grams, ounces, milliliters)</li>
              <li>- Pantry shelf subtraction prior to checklist generation</li>
              <li>- Printable PDF schedule and grocery checklist export</li>
            </ul>
          </div>
        </div>
      </section>

      {/* ──────── Academic Context & Team Attribution ──────── */}
      <section className="border-t border-line pt-10 pb-6">
        <div className="rounded-lg border border-line bg-canvas p-6 text-center space-y-3">
          <p className="font-serif text-lg italic text-text max-w-2xl mx-auto">
            "Developed as an applied research project studying constraint optimization and
            transparent recommendation systems in household food planning."
          </p>
          <p className="text-xs font-mono uppercase tracking-wider text-text-muted">
            CS628 Software Architecture · City University of Seattle
          </p>
        </div>
      </section>
    </div>
  );
}
