import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useMealPlans } from '@/hooks/useMealPlans';
import { useWeeklyNutrition } from '@/hooks/useNutrition';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Link } from 'react-router-dom';
import { formatWeekRange } from '@/lib/week';
import { MedicalDisclaimerBanner } from '@/components/ui/MedicalDisclaimerBanner';
import { usePageMetadata } from '@/hooks/usePageMetadata';

export function NutritionPage() {
  usePageMetadata({
    title: 'Nutrition & Macronutrient Analytics | MealMate',
    description:
      'Analyze weekly calorie, protein, carbohydrate, and fat breakdowns calculated directly from your scheduled meal plans with MealMate nutrition analytics.',
  });

  const { data: plans, isLoading: loadingPlans } = useMealPlans();
  const [planId, setPlanId] = useState<string>('');

  // Default to the most recent plan when plans first load.
  useEffect(() => {
    if (!planId && plans && plans.length > 0 && plans[0]) setPlanId(plans[0].id);
  }, [plans, planId]);

  const { data: nutrition, isLoading: loadingNutrition } = useWeeklyNutrition(planId || undefined);

  const chartData = nutrition?.days.map((d) => ({
    day: d.day.slice(0, 3),
    Calories: Math.round(d.nutrition.calories),
    Protein: Math.round(d.nutrition.protein),
    Carbs: Math.round(d.nutrition.carbs),
    Fat: Math.round(d.nutrition.fat),
  }));

  if (loadingPlans) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!plans || plans.length === 0) {
    return (
      <EmptyState
        title="No meal plans yet"
        description="Create a plan and assign some recipes to see weekly nutrition."
        action={
          <Link
            to="/planner"
            className="inline-block rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Open planner
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Nutrition</h1>
          <p className="text-sm text-gray-600">Weekly macros across your meal plan.</p>
        </div>
        <select
          value={planId}
          onChange={(e) => setPlanId(e.target.value)}
          className="h-10 rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
          aria-label="Select meal plan"
        >
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name ?? formatWeekRange(new Date(p.weekStartDate))}
            </option>
          ))}
        </select>
      </header>

      <MedicalDisclaimerBanner compact />

      {loadingNutrition || !nutrition ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard label="Total calories" value={nutrition.total.calories} unit="kcal" />
            <SummaryCard label="Avg / day" value={nutrition.average.calories} unit="kcal" />
            <SummaryCard label="Total protein" value={nutrition.total.protein} unit="g" />
            <SummaryCard label="Avg protein / day" value={nutrition.average.protein} unit="g" />
          </div>

          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-gray-900">Calories per day</h2>
            <div className="mt-3 h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="Calories" fill="#16a34a" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-gray-900">Macros per day (g)</h2>
            <div className="mt-3 h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Protein" stackId="m" fill="#0ea5e9" />
                  <Bar dataKey="Carbs" stackId="m" fill="#f59e0b" />
                  <Bar dataKey="Fat" stackId="m" fill="#ef4444" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-gray-900">Daily breakdown</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-gray-500">
                    <th className="py-2 font-semibold">Day</th>
                    <th className="py-2 font-semibold">Calories</th>
                    <th className="py-2 font-semibold">Protein</th>
                    <th className="py-2 font-semibold">Carbs</th>
                    <th className="py-2 font-semibold">Fat</th>
                  </tr>
                </thead>
                <tbody>
                  {nutrition.days.map((d) => (
                    <tr key={d.day} className="border-t border-gray-100">
                      <td className="py-2 font-medium text-gray-900">{d.day}</td>
                      <td className="py-2 text-gray-700">{Math.round(d.nutrition.calories)}</td>
                      <td className="py-2 text-gray-700">{Math.round(d.nutrition.protein)} g</td>
                      <td className="py-2 text-gray-700">{Math.round(d.nutrition.carbs)} g</td>
                      <td className="py-2 text-gray-700">{Math.round(d.nutrition.fat)} g</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

interface SummaryCardProps {
  label: string;
  value: number;
  unit: string;
}

function SummaryCard({ label, value, unit }: SummaryCardProps) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900">
        {Math.round(value)}
        <span className="ml-1 text-sm font-normal text-gray-500">{unit}</span>
      </p>
    </div>
  );
}
