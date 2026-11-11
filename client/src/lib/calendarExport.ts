import type { MealPlan, MealPlanDay, Recipe, DayName, Slot } from '@/types';
import type { MealPlanResponse } from '@/hooks/useAiPlanner';
import { DAYS_OF_WEEK } from '@/lib/week';

const SLOT_TIMES: Record<Slot, { startHour: number; startMin: number; durationMin: number; emoji: string }> = {
  breakfast: { startHour: 8, startMin: 0, durationMin: 45, emoji: '🍳' },
  lunch: { startHour: 12, startMin: 30, durationMin: 45, emoji: '🥗' },
  dinner: { startHour: 18, startMin: 30, durationMin: 60, emoji: '🍽️' },
};

function formatIcsDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function escapeIcsText(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

export interface CalendarMealEvent {
  dayName: DayName;
  slot: Slot;
  title: string;
  recipe?: Recipe;
  recipeId?: string;
  description?: string;
  date: Date;
}

export function extractMealsFromPlan(
  plan: MealPlan | MealPlanResponse,
  baseDate?: Date | string
): CalendarMealEvent[] {
  const events: CalendarMealEvent[] = [];

  let start: Date;
  if ('weekStartDate' in plan && plan.weekStartDate) {
    start = new Date(plan.weekStartDate);
  } else if (baseDate) {
    start = new Date(baseDate);
  } else {
    start = new Date();
  }

  // Ensure start is a valid date
  if (isNaN(start.getTime())) {
    start = new Date();
  }

  if ('strategy' in plan && 'days' in plan && Array.isArray(plan.days)) {
    // MealPlanResponse from AI planner
    plan.days.forEach((dayPlan) => {
      const dayIdx = DAYS_OF_WEEK.indexOf(dayPlan.day as DayName);
      const offsetDays = dayIdx >= 0 ? dayIdx : 0;
      const dayDate = new Date(start.getTime() + offsetDays * 24 * 60 * 60 * 1000);

      dayPlan.meals.forEach((meal) => {
        const slot = (meal.slot.toLowerCase() as Slot) in SLOT_TIMES
          ? (meal.slot.toLowerCase() as Slot)
          : 'dinner';
        events.push({
          dayName: dayPlan.day as DayName,
          slot,
          title: meal.title,
          recipeId: meal.recipe_id,
          description: `Eco-score: ${Math.round((meal.eco_score ?? 0.8) * 100)}% · CO₂: ${(meal.co2_kg ?? 0.5).toFixed(1)} kg`,
          date: dayDate,
        });
      });
    });
  } else if ('days' in plan && Array.isArray(plan.days)) {
    // Database MealPlan
    (plan.days as MealPlanDay[]).forEach((dayPlan) => {
      const dayIdx = DAYS_OF_WEEK.indexOf(dayPlan.day);
      const offsetDays = dayIdx >= 0 ? dayIdx : 0;
      const dayDate = new Date(start.getTime() + offsetDays * 24 * 60 * 60 * 1000);

      (['breakfast', 'lunch', 'dinner'] as Slot[]).forEach((slot) => {
        const item = dayPlan[slot];
        if (!item) return;

        if (typeof item === 'object' && item !== null) {
          const recipe = item as Recipe;
          events.push({
            dayName: dayPlan.day,
            slot,
            title: recipe.title,
            recipe,
            recipeId: recipe.id ?? (recipe as { _id?: string })._id,
            description: recipe.description,
            date: dayDate,
          });
        } else if (typeof item === 'string') {
          events.push({
            dayName: dayPlan.day,
            slot,
            title: `Scheduled ${slot.toUpperCase()}`,
            recipeId: item,
            date: dayDate,
          });
        }
      });
    });
  }

  return events;
}

export function generateIcsString(
  plan: MealPlan | MealPlanResponse,
  baseDate?: Date | string
): string {
  const events = extractMealsFromPlan(plan, baseDate);
  const nowStr = formatIcsDate(new Date());

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MealMate.ai//Weekly Meal Planner//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:MealMate Weekly Plan',
    'X-WR-TIMEZONE:UTC',
  ];

  events.forEach((ev, idx) => {
    const timing = SLOT_TIMES[ev.slot] ?? SLOT_TIMES.dinner;
    const start = new Date(ev.date);
    start.setHours(timing.startHour, timing.startMin, 0, 0);

    const end = new Date(start.getTime() + timing.durationMin * 60 * 1000);

    const slotLabel = ev.slot.charAt(0).toUpperCase() + ev.slot.slice(1);
    const summary = `${timing.emoji} ${slotLabel}: ${ev.title}`;

    let desc = ev.description ? `${ev.description}\n\n` : '';
    if (ev.recipe) {
      if (ev.recipe.prepTime || ev.recipe.cookTime) {
        desc += `⏱️ Prep: ${ev.recipe.prepTime ?? 0}m | Cook: ${ev.recipe.cookTime ?? 0}m\n`;
      }
      if (ev.recipe.nutrition?.calories) {
        desc += `🔥 Calories: ${ev.recipe.nutrition.calories} kcal | Protein: ${ev.recipe.nutrition.protein ?? 0}g\n`;
      }
      if (ev.recipe.ingredients && ev.recipe.ingredients.length > 0) {
        desc += `\n🛒 Ingredients:\n` + ev.recipe.ingredients.map((i) => `• ${i.name} (${i.quantity ?? ''} ${i.unit ?? ''})`).join('\n') + '\n';
      }
    }
    if (ev.recipeId) {
      desc += `\n🔗 View Recipe: https://mealmate.ai/recipes/${ev.recipeId}`;
    }

    lines.push(
      'BEGIN:VEVENT',
      `UID:mealmate-${Date.now()}-${idx}-${start.getTime()}@mealmate.ai`,
      `DTSTAMP:${nowStr}`,
      `DTSTART:${formatIcsDate(start)}`,
      `DTEND:${formatIcsDate(end)}`,
      `SUMMARY:${escapeIcsText(summary)}`,
      `DESCRIPTION:${escapeIcsText(desc)}`,
      'LOCATION:Home Kitchen',
      'STATUS:CONFIRMED',
      'END:VEVENT'
    );
  });

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export function downloadPlanIcs(
  plan: MealPlan | MealPlanResponse,
  baseDate?: Date | string,
  filename?: string
): void {
  const icsData = generateIcsString(plan, baseDate);
  const blob = new Blob([icsData], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename ?? `mealmate-plan-${new Date().toISOString().slice(0, 10)}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function getGoogleCalendarUrl(event: {
  title: string;
  details?: string;
  location?: string;
  start: Date;
  end: Date;
}): string {
  const base = 'https://calendar.google.com/calendar/render?action=TEMPLATE';
  const startStr = formatIcsDate(event.start);
  const endStr = formatIcsDate(event.end);
  const params = new URLSearchParams({
    text: event.title,
    dates: `${startStr}/${endStr}`,
    details: event.details || '',
    location: event.location || 'Kitchen',
  });
  return `${base}&${params.toString()}`;
}
