import { Link } from 'react-router-dom';
import { usePageMetadata } from '@/hooks/usePageMetadata';

export function NotFoundPage() {
  usePageMetadata({
    title: 'Page Not Found (404) | MealMate',
    description:
      'The page you requested could not be found. Return to the MealMate homepage or access recipes, planner, and pantry management tools in our kitchen portal.',
  });

  return (
    <div className="mx-auto max-w-lg py-16 px-4 text-center">
      <span className="inline-flex items-center rounded border border-line bg-canvas px-3 py-1 font-mono text-xs font-semibold text-terracotta">
        Error 404
      </span>
      <h1 className="mt-4 font-serif text-3xl md:text-4xl font-semibold tracking-tight text-ink">
        Page Not Found
      </h1>
      <p className="mt-3 text-sm text-ink-soft leading-relaxed max-w-md mx-auto">
        The link you followed may be broken or the page may have been moved. Return to the
        kitchen dashboard or jump directly to one of our tools below.
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          to="/"
          className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-ink px-5 py-2.5 text-sm font-medium text-canvas transition-colors hover:bg-terracotta"
        >
          Return to homepage
        </Link>
        <Link
          to="/recipes"
          className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-line bg-card px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-canvas"
        >
          Browse recipes
        </Link>
      </div>

      <div className="mt-10 border-t border-line pt-6">
        <p className="text-xs uppercase tracking-wider text-ink-mute font-mono mb-3">
          Popular Kitchen Destinations
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4 text-xs font-medium text-ink-soft">
          <Link to="/planner" className="hover:text-terracotta underline">
            Weekly Planner
          </Link>
          <span className="text-line-strong">·</span>
          <Link to="/pantry" className="hover:text-terracotta underline">
            Pantry Inventory
          </Link>
          <span className="text-line-strong">·</span>
          <Link to="/grocery" className="hover:text-terracotta underline">
            Grocery Lists
          </Link>
          <span className="text-line-strong">·</span>
          <Link to="/nutrition" className="hover:text-terracotta underline">
            Nutrition Analytics
          </Link>
        </div>
      </div>
    </div>
  );
}
