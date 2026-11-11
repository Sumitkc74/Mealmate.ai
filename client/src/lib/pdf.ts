/**
 * Client-side PDF generators using jsPDF.
 *
 * Two flagship reports are produced:
 *   - `generateWeekPlanPdf(plan)`  → 1-page weekly meal plan
 *   - `generateGroceryListPdf(items, title)` → categorised grocery list
 *
 * Both download the PDF immediately to the user's browser; no server round-trip.
 */
import { jsPDF } from 'jspdf';
import type { MealPlanResponse } from '@/hooks/useAiPlanner';
import type { GroceryItem, MealPlan, Recipe, Slot } from '@/types';

const PAGE_MARGIN = 14;
const LINE_HEIGHT = 6;

function header(doc: jsPDF, title: string, subtitle?: string): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(title, PAGE_MARGIN, 18);
  if (subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text(subtitle, PAGE_MARGIN, 24);
    doc.setTextColor(0);
  }
  doc.setDrawColor(15, 118, 110);
  doc.line(PAGE_MARGIN, 28, 196, 28);
  return 34;
}

function footer(doc: jsPDF): void {
  const pages = doc.getNumberOfPages();
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(140);
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    doc.text(
      `MealMate · generated ${new Date().toLocaleString()} · page ${i}/${pages}`,
      PAGE_MARGIN,
      290
    );
  }
  doc.setTextColor(0);
}

export function generateWeekPlanPdf(plan: MealPlanResponse, weekLabel?: string): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = header(
    doc,
    'Weekly Meal Plan',
    `${weekLabel ?? 'Generated week'} · objective: ${plan.objective ?? plan.strategy}`
  );

  if (plan.sustainability) {
    const s = plan.sustainability;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('Sustainability summary', PAGE_MARGIN, y);
    y += LINE_HEIGHT;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(
      `CO₂ ≈ ${s.co2_kg.toFixed(1)} kg · cost ≈ $${s.cost_usd.toFixed(2)} · ` +
        `eco-score ${(s.eco_score * 100).toFixed(0)}% · ${s.meals} meals`,
      PAGE_MARGIN,
      y
    );
    y += LINE_HEIGHT + 2;
  }

  plan.days.forEach((day) => {
    if (y > 270) {
      doc.addPage();
      y = 20;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(day.day.toUpperCase(), PAGE_MARGIN, y);
    if (typeof day.co2_kg === 'number' && typeof day.cost_usd === 'number') {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(120);
      doc.text(
        `CO₂ ${day.co2_kg.toFixed(1)} kg · $${day.cost_usd.toFixed(2)}`,
        160,
        y,
        { align: 'right' }
      );
      doc.setTextColor(0);
    }
    y += LINE_HEIGHT;
    day.meals.forEach((meal) => {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      const eco =
        typeof meal.eco_score === 'number' ? ` · eco ${(meal.eco_score * 100).toFixed(0)}%` : '';
      doc.text(`  ${meal.slot.padEnd(10, ' ')} ${meal.title}${eco}`, PAGE_MARGIN, y);
      y += LINE_HEIGHT;
    });
    y += 2;
  });

  footer(doc);
  doc.save(`mealmate-plan-${weekLabel ?? 'week'}.pdf`);
}

export function generateGroceryListPdf(items: GroceryItem[], title = 'Grocery List'): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = header(doc, title, `${items.length} items`);

  // group items by category
  const groups = new Map<string, GroceryItem[]>();
  items.forEach((item) => {
    const cat = item.category ?? 'other';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)?.push(item);
  });

  Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([category, group]) => {
      if (y > 270) {
        doc.addPage();
        y = 20;
      }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(category.toUpperCase(), PAGE_MARGIN, y);
      y += LINE_HEIGHT;
      group.forEach((item) => {
        if (y > 280) {
          doc.addPage();
          y = 20;
        }
        const checkbox = item.checked ? '[x]' : '[ ]';
        const qty = item.quantity
          ? ` — ${item.quantity}${item.unit ? ' ' + item.unit : ''}`
          : '';
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.text(`${checkbox} ${item.ingredient}${qty}`, PAGE_MARGIN + 2, y);
        y += LINE_HEIGHT;
      });
      y += 2;
    });

  footer(doc);
  doc.save(`mealmate-grocery-${new Date().toISOString().split('T')[0]}.pdf`);
}

export function generateSavedPlanPdf(plan: MealPlan, weekLabel?: string): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = header(
    doc,
    'Weekly Meal Plan — Fridge Schedule',
    `${weekLabel ?? 'Weekly Plan'} · Prepared with MealMate.ai`
  );

  const SLOTS: Slot[] = ['breakfast', 'lunch', 'dinner'];

  plan.days.forEach((day) => {
    if (y > 255) {
      doc.addPage();
      y = 20;
    }
    // Day banner
    doc.setFillColor(240, 253, 244);
    doc.roundedRect(PAGE_MARGIN, y - 4, 182, 7, 1.5, 1.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(22, 101, 52);
    doc.text(day.day.toUpperCase(), PAGE_MARGIN + 3, y + 1);
    doc.setTextColor(0);
    y += LINE_HEIGHT + 2;

    let hasMeals = false;
    SLOTS.forEach((slot) => {
      const meal = day[slot];
      if (!meal) return;
      hasMeals = true;

      const slotName = slot.toUpperCase();
      let title = '';
      let meta = '';

      if (typeof meal === 'object' && meal !== null) {
        const recipe = meal as Recipe;
        title = recipe.title;
        const parts: string[] = [];
        if (recipe.prepTime) parts.push(`prep ${recipe.prepTime}m`);
        if (recipe.cookTime) parts.push(`cook ${recipe.cookTime}m`);
        if (recipe.nutrition?.calories) parts.push(`${recipe.nutrition.calories} kcal`);
        if (parts.length > 0) meta = ` (${parts.join(' · ')})`;
      } else if (typeof meal === 'string') {
        title = 'Scheduled Recipe';
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(100);
      doc.text(slotName.padEnd(10, ' '), PAGE_MARGIN + 4, y);
      doc.setTextColor(20);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.text(`${title}${meta}`, PAGE_MARGIN + 28, y);
      y += LINE_HEIGHT;
    });

    if (!hasMeals) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9);
      doc.setTextColor(150);
      doc.text('No meals scheduled', PAGE_MARGIN + 4, y);
      doc.setTextColor(0);
      y += LINE_HEIGHT;
    }

    y += 2;
  });

  // Refrigerator memo box
  if (y < 265) {
    y += 4;
    doc.setDrawColor(200, 200, 200);
    doc.setFillColor(249, 250, 251);
    doc.roundedRect(PAGE_MARGIN, y, 182, 16, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(75, 85, 99);
    doc.text('Refrigerator Notes & Prep Tips:', PAGE_MARGIN + 4, y + 6);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('• Pre-chop fresh vegetables on Sunday to save 20 minutes on busy weeknights.', PAGE_MARGIN + 4, y + 11);
  }

  footer(doc);
  doc.save(`mealmate-plan-${weekLabel ? weekLabel.replace(/\s+/g, '-') : 'fridge-schedule'}.pdf`);
}

