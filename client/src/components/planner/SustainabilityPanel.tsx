import type { MealPlanResponse } from '@/hooks/useAiPlanner';

interface Props {
  plan: MealPlanResponse | null | undefined;
}

function ecoColor(score: number): string {
  if (score >= 0.75) return 'text-emerald-700 bg-emerald-50 ring-emerald-200';
  if (score >= 0.5) return 'text-amber-700 bg-amber-50 ring-amber-200';
  return 'text-rose-700 bg-rose-50 ring-rose-200';
}

/**
 * Read-only summary of the planner's sustainability + cost output. Shows
 * a weekly headline plus a per-day breakdown when those fields are present.
 */
export function SustainabilityPanel({ plan }: Props) {
  if (!plan?.sustainability) return null;
  const s = plan.sustainability;
  const eco = s.eco_score;

  return (
    <section className="rounded-lg border border-line bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-serif font-semibold text-text">
          Sustainability
        </h2>
        <p className="text-xs text-text-muted">
          Objective <span className="font-medium text-text">{plan.objective ?? 'balanced'}</span>{' '}
          · {s.meals} meals
        </p>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Metric label="CO₂ footprint" value={`${s.co2_kg.toFixed(1)} kg`} subtitle="per week" />
        <Metric label="Estimated cost" value={`$${s.cost_usd.toFixed(2)}`} subtitle="per week" />
        <div className={`rounded-lg p-3 ring-1 ${ecoColor(eco)}`}>
          <p className="text-xs uppercase tracking-wide">Eco score</p>
          <p className="mt-1 text-2xl font-semibold">{(eco * 100).toFixed(0)}%</p>
          <p className="text-xs">0 = high impact, 100 = low impact</p>
        </div>
      </div>

      {plan.days.some((d) => typeof d.co2_kg === 'number') && (
        <div className="mt-5">
          <h3 className="text-sm font-medium text-text">Daily breakdown</h3>
          <ul className="mt-2 divide-y divide-line text-sm">
            {plan.days.map((d) => (
              <li key={d.day} className="flex items-center justify-between py-1.5">
                <span className="capitalize text-text">{d.day}</span>
                <span className="text-xs font-mono text-text-muted">
                  {typeof d.co2_kg === 'number' ? `${d.co2_kg.toFixed(1)} kg CO₂` : '-'} ·{' '}
                  {typeof d.cost_usd === 'number' ? `$${d.cost_usd.toFixed(2)}` : '-'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {plan.weights && (
        <p className="mt-4 text-[11px] text-gray-500">
          Weights:{' '}
          {Object.entries(plan.weights)
            .map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`)
            .join(' · ')}
        </p>
      )}
    </section>
  );
}

function Metric({
  label,
  value,
  subtitle,
}: {
  label: string;
  value: string;
  subtitle?: string;
}) {
  return (
    <div className="rounded-lg bg-gray-50 p-3 ring-1 ring-gray-200">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p>
      {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
    </div>
  );
}
