import { describe, it, expect } from 'vitest';
import { generateIcsString, extractMealsFromPlan } from '@/lib/calendarExport';
import type { MealPlan } from '@/types';
import type { MealPlanResponse } from '@/hooks/useAiPlanner';

describe('Calendar Export (.ics / iCalendar)', () => {
  it('generates valid RFC 5545 iCalendar string from a saved database MealPlan', () => {
    const mockPlan: MealPlan = {
      id: 'p1',
      user: 'u1',
      weekStartDate: '2026-10-12T00:00:00.000Z',
      days: [
        {
          day: 'Monday',
          breakfast: {
            id: 'r1',
            title: 'Avocado Toast with Egg',
            description: 'Crispy sourdough topped with smashed avocado and egg',
            prepTimeMinutes: 5,
            cookTimeMinutes: 5,
            servings: 1,
            ingredients: [{ name: 'Eggs', quantity: 2, unit: 'pcs' }],
            instructions: ['Toast bread', 'Poach egg'],
            nutrition: { calories: 350, protein: 14, carbs: 28, fat: 18 },
          } as never,
          lunch: null,
          dinner: {
            id: 'r2',
            title: 'Grilled Salmon with Quinoa',
            description: 'Healthy omega-3 packed salmon dish',
            prepTimeMinutes: 10,
            cookTimeMinutes: 15,
            servings: 2,
            ingredients: [{ name: 'Salmon', quantity: 300, unit: 'g' }],
            instructions: ['Grill salmon'],
            nutrition: { calories: 520, protein: 42, carbs: 30, fat: 22 },
          } as never,
        },
      ],
    };

    const events = extractMealsFromPlan(mockPlan);
    expect(events).toHaveLength(2);
    expect(events[0]?.title).toBe('Avocado Toast with Egg');
    expect(events[0]?.slot).toBe('breakfast');
    expect(events[1]?.title).toBe('Grilled Salmon with Quinoa');
    expect(events[1]?.slot).toBe('dinner');

    const icsContent = generateIcsString(mockPlan);
    expect(icsContent).toContain('BEGIN:VCALENDAR');
    expect(icsContent).toContain('VERSION:2.0');
    expect(icsContent).toContain('SUMMARY:🍳 Breakfast: Avocado Toast with Egg');
    expect(icsContent).toContain('SUMMARY:🍽️ Dinner: Grilled Salmon with Quinoa');
    expect(icsContent).toContain('BEGIN:VEVENT');
    expect(icsContent).toContain('END:VEVENT');
    expect(icsContent).toContain('END:VCALENDAR');
  });

  it('generates valid iCalendar string from AI-generated MealPlanResponse', () => {
    const mockAiPlan: MealPlanResponse = {
      success: true,
      objective: 'balanced',
      strategy: 'heuristic',
      days: [
        {
          day: 'Tuesday',
          co2_kg: 1.2,
          cost_usd: 8.5,
          meals: [
            {
              slot: 'Lunch',
              title: 'Mediterranean Lentil Salad',
              recipe_id: 'r3',
              co2_kg: 0.4,
              cost_usd: 2.5,
              eco_score: 0.95,
              tags: ['mediterranean', 'healthy'],
            },
          ],
        },
      ],
      sustainability: {
        co2_kg: 8.4,
        cost_usd: 45.0,
        eco_score: 0.9,
        meals: 7,
      },
    };

    const icsContent = generateIcsString(mockAiPlan, '2026-10-12T00:00:00.000Z');
    expect(icsContent).toContain('BEGIN:VCALENDAR');
    expect(icsContent).toContain('SUMMARY:🥗 Lunch: Mediterranean Lentil Salad');
    expect(icsContent).toContain('Eco-score: 95%');
    expect(icsContent).toContain('END:VCALENDAR');
  });
});
