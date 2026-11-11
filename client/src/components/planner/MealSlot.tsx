import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { useDrop } from 'react-dnd';
import type { DayName, Recipe, Slot } from '@/types';
import { DRAG_TYPE_RECIPE, type RecipeDragItem } from './dnd';
import { cn } from '@/lib/cn';

interface MealSlotProps {
  day: DayName;
  slot: Slot;
  recipe: Recipe | null;
  onAssign: (recipeId: string) => void;
  onClear: () => void;
  onPickRequest: () => void;
  disabled?: boolean;
}

const slotLabel: Record<Slot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
};

export function MealSlot({
  day,
  slot,
  recipe,
  onAssign,
  onClear,
  onPickRequest,
  disabled,
}: MealSlotProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [{ isOver, canDrop }, drop] = useDrop<
    RecipeDragItem,
    unknown,
    { isOver: boolean; canDrop: boolean }
  >(() => ({
    accept: DRAG_TYPE_RECIPE,
    canDrop: () => !disabled,
    drop: (item) => {
      onAssign(item.id);
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
      canDrop: monitor.canDrop(),
    }),
  }));
  drop(ref);

  const filled = Boolean(recipe);

  return (
    <div
      ref={ref}
      data-testid={`slot-${day}-${slot}`}
      className={cn(
        'flex min-h-[88px] flex-col rounded-md border-2 border-dashed p-2 text-xs transition',
        filled
          ? 'border-solid border-brand-200 bg-brand-50/40'
          : 'border-gray-200 bg-gray-50',
        isOver && canDrop && 'ring-2 ring-brand-400 ring-offset-1',
        disabled && 'opacity-60'
      )}
    >
      <div className="mb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-gray-500">
        <span>{slotLabel[slot]}</span>
        {filled && (
          <button
            onClick={onClear}
            aria-label={`Clear ${slot} on ${day}`}
            className="rounded px-1 text-text-muted hover:bg-card hover:text-terracotta font-mono text-xs"
          >
            ×
          </button>
        )}
      </div>

      {filled && recipe ? (
        <Link
          to={`/recipes/${recipe.id}`}
          // Clicking the filled tile opens the recipe detail page. The clear
          // button sits above this in the header and stops propagation via
          // its own click handler, so the link is never accidentally
          // triggered when the user removes the assignment.
          className="flex flex-1 flex-col rounded-sm outline-none transition hover:bg-canvas focus-visible:ring-2 focus-visible:ring-brand-400"
          aria-label={`Open recipe ${recipe.title}`}
        >
          <p className="line-clamp-2 text-sm font-medium text-ink hover:text-brand-700">
            {recipe.title}
          </p>
          <p className="mt-auto text-[10px] text-ink-soft">
            {(recipe.prepTime ?? 0) + (recipe.cookTime ?? 0)} min
          </p>
        </Link>
      ) : (
        <button
          onClick={onPickRequest}
          disabled={disabled}
          className="flex flex-1 items-center justify-center rounded text-gray-400 transition hover:bg-white hover:text-brand-700"
        >
          + Add
        </button>
      )}
    </div>
  );
}
