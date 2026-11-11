import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Recipe } from '@/types';
import { cn } from '@/lib/cn';

interface RecipeCardProps {
  recipe: Recipe;
  className?: string;
}

const difficultyColors: Record<string, string> = {
  easy: 'bg-canvas text-text border border-line',
  medium: 'bg-canvas text-text border border-line',
  hard: 'bg-canvas text-text border border-line',
};

export function RecipeCard({ recipe, className }: RecipeCardProps) {
  const total = (recipe.prepTime ?? 0) + (recipe.cookTime ?? 0);
  const [imageOk, setImageOk] = useState(true);
  const showImage = Boolean(recipe.imageUrl) && imageOk;
  const isAiGenerated = recipe.source === 'ai-generated';

  return (
    <Link
      to={`/recipes/${recipe.id}`}
      className={cn(
        'group flex flex-col overflow-hidden rounded-lg border border-line bg-card transition-colors hover:border-terracotta',
        className
      )}
    >
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-canvas">
        {showImage ? (
          <img
            src={recipe.imageUrl}
            alt={recipe.title}
            width={400}
            height={250}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform group-hover:scale-102"
            onError={() => setImageOk(false)}
          />
        ) : (
          <div className="flex h-full items-center justify-center font-serif text-xs text-text-muted">
            Recipe preview
          </div>
        )}
        {isAiGenerated && (
          <span
            className="absolute left-2.5 top-2.5 inline-flex items-center rounded border border-line bg-card/95 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide text-text"
            title="Drafted by MealMate AI: fully editable"
          >
            AI generated
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 font-serif text-base font-semibold text-text group-hover:text-terracotta transition-colors">
            {recipe.title}
          </h3>
          <span
            className={cn(
              'shrink-0 rounded px-1.5 py-0.5 text-[11px] font-mono capitalize',
              difficultyColors[recipe.difficulty] ?? 'bg-canvas text-text-muted border border-line'
            )}
          >
            {recipe.difficulty}
          </span>
        </div>

        {recipe.description && (
          <p className="line-clamp-2 text-xs text-text-muted leading-relaxed">{recipe.description}</p>
        )}

        <div className="mt-auto flex items-center gap-2 pt-2 text-xs font-mono text-text-muted">
          <span>{total} min</span>
          <span>·</span>
          <span>{recipe.servings} servings</span>
          {recipe.cuisine && (
            <>
              <span>·</span>
              <span className="capitalize">{recipe.cuisine}</span>
            </>
          )}
        </div>

        {recipe.tags && recipe.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {recipe.tags.slice(0, 3).map((t) => (
              <span
                key={t}
                className="rounded border border-line bg-canvas px-1.5 py-0.5 text-[10px] font-mono text-text-muted"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
