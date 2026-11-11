import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { AnimatePresence, motion } from 'framer-motion';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { RecipeDrawer } from '@/components/planner/RecipeDrawer';
import { MealSlot } from '@/components/planner/MealSlot';
import { RecipePickerModal } from '@/components/planner/RecipePickerModal';
import { SustainabilityPanel } from '@/components/planner/SustainabilityPanel';
import { ExportPlanPdfButton } from '@/components/planner/ExportPlanPdfButton';
import {
  useMealPlans,
  useMealPlan,
  useCreateMealPlan,
  useAssignSlot,
  useGenerateGrocery,
} from '@/hooks/useMealPlans';
import {
  useGenerateWeekPlan,
  type MealPlanResponse,
  type PlannerObjective,
} from '@/hooks/useAiPlanner';
import { useAiStatus } from '@/hooks/useAiStatus';
import { useMealPlanRealtime } from '@/hooks/useMealPlanRealtime';
import {
  DAYS_OF_WEEK,
  addDays,
  formatWeekRange,
  startOfWeekMondayUTC,
  toIsoDate,
} from '@/lib/week';
import { extractErrorMessage } from '@/lib/api';
import { usePageMetadata } from '@/hooks/usePageMetadata';
import type { DayName, Recipe, Slot, MealPlan } from '@/types';

const SLOTS: Slot[] = ['breakfast', 'lunch', 'dinner'];
const OBJECTIVES: { value: PlannerObjective; label: string; hint: string }[] = [
  { value: 'balanced', label: 'Balanced', hint: 'similarity + eco + cost + pantry' },
  { value: 'eco', label: 'Eco-first', hint: 'minimise CO₂ footprint' },
  { value: 'budget', label: 'Budget', hint: 'minimise grocery cost' },
  { value: 'pantry', label: 'Use my pantry', hint: 'maximise pantry overlap' },
];

function recipeFromSlot(value: unknown): Recipe | null {
  if (!value || typeof value === 'string') return null;

  const recipe = value as Recipe & { _id?: string };
  if (!recipe.id && recipe._id) {
    return { ...recipe, id: String(recipe._id) };
  }

  return recipe;
}

export function PlannerPage() {
  usePageMetadata({
    title: 'Weekly Meal Planner | MealMate',
    description:
      'Schedule your weekly breakfast, lunch, and dinner plans with automatic pantry ingredient matching and balanced daily macronutrient targets on MealMate.',
  });

  const navigate = useNavigate();
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeekMondayUTC());
  const [picker, setPicker] = useState<{ day: DayName; slot: Slot } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: plans, isLoading: loadingPlans } = useMealPlans();
  const weekIso = toIsoDate(weekStart);

  const planForWeek = useMemo<MealPlan | undefined>(() => {
    if (!plans) return undefined;
    return plans.find((p) => toIsoDate(new Date(p.weekStartDate)) === weekIso);
  }, [plans, weekIso]);

  const { data: plan, isLoading: loadingPlan } = useMealPlan(planForWeek?.id);
  const createPlan = useCreateMealPlan();
  const assignSlot = useAssignSlot();
  const genGrocery = useGenerateGrocery();
  const genWeek = useGenerateWeekPlan();
  const aiStatus = useAiStatus();
  const llmAvailable = aiStatus.llmOnline;
  const serviceOnline = aiStatus.serviceOnline;
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [useLlm, setUseLlm] = useState(false);
  const [objective, setObjective] = useState<PlannerObjective>('balanced');
  const [lastAiResponse, setLastAiResponse] = useState<MealPlanResponse | null>(null);

  // Subscribe to live updates for this plan so other browser tabs / devices
  // refresh automatically when slots change.
  useMealPlanRealtime(planForWeek?.id);

  async function ensurePlan(): Promise<MealPlan> {
    if (plan) return plan;
    if (planForWeek) return planForWeek;
    return createPlan.mutateAsync({ weekStartDate: weekIso });
  }

  async function handleAssign(day: DayName, slot: Slot, recipeId: string | null) {
    setError(null);
    try {
      const target = await ensurePlan();
      await assignSlot.mutateAsync({ planId: target.id, day, slot, recipeId });
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not update slot'));
    }
  }

  async function handleGenerateGrocery() {
    if (!plan) return;
    setError(null);
    try {
      const list = await genGrocery.mutateAsync({ mealPlanId: plan.id, usePantry: true });
      navigate(`/grocery/${list.id}`);
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not generate grocery list'));
    }
  }

  /**
   * Build a full week from the AI service. Recipes that aren't seeded into
   * Mongo (no `_id`) are skipped — the user can drag those in manually.
   */
  async function handleAiGenerate() {
    setError(null);
    setAiNote(null);
    try {
      const target = await ensurePlan();
      const ai = await genWeek.mutateAsync({
        useLlm: useLlm && llmAvailable,
        objective,
      });
      setLastAiResponse(ai);
      let assigned = 0;
      let skipped = 0;
      for (const d of ai.days) {
        for (const m of d.meals) {
          if (!m._id) {
            skipped += 1;
            continue;
          }
          const day = d.day.toLowerCase() as DayName;
          const slot = m.slot.toLowerCase() as Slot;
          if (!DAYS_OF_WEEK.includes(day) || !SLOTS.includes(slot)) continue;
          await assignSlot.mutateAsync({ planId: target.id, day, slot, recipeId: m._id });
          assigned += 1;
        }
      }
      const strategyLabel = ai.strategy === 'llm' ? 'LLM' : 'AI heuristic';
      const objectiveLabel = ai.objective ?? objective;
      setAiNote(
        skipped > 0
          ? `${strategyLabel} (${objectiveLabel}) filled ${assigned} slots; ${skipped} skipped (run \`npm run seed\` to add the bundled recipes).`
          : `${strategyLabel} (${objectiveLabel}) filled ${assigned} slots based on your pantry & preferences.`
      );
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not generate week plan'));
    }
  }

  const dayMap: Record<DayName, MealPlan['days'][number] | undefined> = useMemo(() => {
    const map = {} as Record<DayName, MealPlan['days'][number] | undefined>;
    if (plan) for (const d of plan.days) map[d.day] = d;
    return map;
  }, [plan]);

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Meal Planner</h1>
            <p className="text-sm text-gray-600">
              Drag recipes onto a slot, or click <span className="font-medium">+ Add</span>.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setWeekStart((w) => addDays(w, -7))}
            >
              ←
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setWeekStart(startOfWeekMondayUTC())}
            >
              Today
            </Button>
            <span className="px-2 text-sm font-medium text-gray-700">
              {formatWeekRange(weekStart)}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setWeekStart((w) => addDays(w, 7))}
            >
              →
            </Button>
          </div>
        </header>

        {error && (
          <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <AnimatePresence>
          {aiNote && (
            <motion.div
              key={aiNote}
              role="status"
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.22 }}
              className="rounded border border-line bg-card px-3 py-2 text-xs text-text"
            >
              {aiNote}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="grid gap-4 lg:grid-cols-[1fr,260px]">
          <div className="rounded-lg border border-line bg-card p-4">
            {loadingPlans || loadingPlan ? (
              <div className="grid grid-cols-[80px,repeat(7,1fr)] gap-2">
                {Array.from({ length: 8 * 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <div className="grid min-w-[760px] grid-cols-[88px_repeat(7,minmax(110px,1fr))] gap-2">
                    <div />
                    {DAYS_OF_WEEK.map((d, i) => {
                      const date = addDays(weekStart, i);
                      return (
                        <div key={d} className="text-center">
                          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            {d.slice(0, 3)}
                          </p>
                          <p className="text-xs text-gray-400">
                            {date.toLocaleDateString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              timeZone: 'UTC',
                            })}
                          </p>
                        </div>
                      );
                    })}

                    {SLOTS.map((slot) => (
                      <FragmentRow key={slot}>
                        <div className="flex items-center text-xs font-semibold uppercase tracking-wide text-gray-500">
                          {slot}
                        </div>
                        {DAYS_OF_WEEK.map((day) => {
                          const dayDoc = dayMap[day];
                          const r = recipeFromSlot(dayDoc?.[slot]);
                          return (
                            <MealSlot
                              key={`${day}-${slot}`}
                              day={day}
                              slot={slot}
                              recipe={r}
                              onAssign={(recipeId) => handleAssign(day, slot, recipeId)}
                              onClear={() => handleAssign(day, slot, null)}
                              onPickRequest={() => setPicker({ day, slot })}
                              disabled={assignSlot.isPending || createPlan.isPending}
                            />
                          );
                        })}
                      </FragmentRow>
                    ))}
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                  <select
                    value={objective}
                    onChange={(e) => setObjective(e.target.value as PlannerObjective)}
                    className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                    aria-label="Planner objective"
                    title="Optimisation objective for the AI planner"
                  >
                    {OBJECTIVES.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}: {o.hint}
                      </option>
                    ))}
                  </select>
                  {llmAvailable && serviceOnline && (
                    <label className="flex cursor-pointer items-center gap-1.5 rounded bg-card px-3 py-1.5 text-xs font-medium text-text border border-line transition hover:bg-canvas">
                      <input
                        type="checkbox"
                        checked={useLlm}
                        onChange={(e) => setUseLlm(e.target.checked)}
                        className="h-3.5 w-3.5 accent-brand-600"
                      />
                      Use Gemini (LLM)
                    </label>
                  )}
                  {serviceOnline ? (
                    <div>
                      <Button
                        variant="secondary"
                        onClick={handleAiGenerate}
                        loading={genWeek.isPending || assignSlot.isPending}
                        disabled={createPlan.isPending}
                        title="Auto-fill the week using your pantry, preferences and allergies"
                      >
                        Generate my week
                      </Button>
                    </div>
                  ) : (
                    <p className="text-xs text-amber-700 rounded bg-amber-50 border border-amber-200 px-3 py-1.5">
                      AI planner offline — click any slot to assign recipes manually.
                    </p>
                  )}
                  <ExportPlanPdfButton
                    plan={lastAiResponse}
                    weekLabel={formatWeekRange(weekStart)}
                    disabled={!lastAiResponse}
                  />
                  <Button
                    onClick={handleGenerateGrocery}
                    loading={genGrocery.isPending}
                    disabled={!plan}
                    className="bg-ink hover:bg-terracotta text-canvas"
                  >
                    Generate grocery list
                  </Button>
                </div>
              </>
            )}
          </div>

          <div className="hidden lg:block space-y-4">
            <RecipeDrawer />
            {lastAiResponse?.sustainability && <SustainabilityPanel plan={lastAiResponse} />}
          </div>
        </div>

        <RecipePickerModal
          open={Boolean(picker)}
          title={picker ? `Pick a recipe for ${picker.day} · ${picker.slot}` : ''}
          onClose={() => setPicker(null)}
          onPick={async (id) => {
            if (!picker) return;
            const target = picker;
            setPicker(null);
            await handleAssign(target.day, target.slot, id);
          }}
        />
      </div>
    </DndProvider>
  );
}

// Fragments inside grid layout (so each row of slots still flows column-wise).
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
