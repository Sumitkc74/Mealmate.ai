import { useDrag } from 'react-dnd';
import { useRef } from 'react';
import type { Recipe } from '@/types';
import { DRAG_TYPE_RECIPE, type RecipeDragItem } from './dnd';
import { cn } from '@/lib/cn';

interface DraggableRecipeProps {
  recipe: Recipe;
}

export function DraggableRecipe({ recipe }: DraggableRecipeProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [{ isDragging }, drag] = useDrag<RecipeDragItem, unknown, { isDragging: boolean }>(() => ({
    type: DRAG_TYPE_RECIPE,
    item: { id: recipe.id, title: recipe.title },
    collect: (monitor) => ({ isDragging: monitor.isDragging() }),
  }));
  drag(ref);

  const total = (recipe.prepTime ?? 0) + (recipe.cookTime ?? 0);
  return (
    <div
      ref={ref}
      className={cn(
        'cursor-grab rounded-md border border-gray-200 bg-white p-2 text-sm shadow-sm transition',
        'hover:border-brand-300 hover:shadow active:cursor-grabbing',
        isDragging && 'opacity-40'
      )}
    >
      <div className="font-medium text-gray-900 line-clamp-1">{recipe.title}</div>
      <div className="mt-0.5 text-xs font-mono text-text-muted">
        {total} min · {recipe.servings} serv
      </div>
    </div>
  );
}
