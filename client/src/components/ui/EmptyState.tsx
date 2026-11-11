import { cn } from '@/lib/cn';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed border-line bg-card px-6 py-12 text-center',
        className
      )}
    >
      {icon && (
        <div className="mb-2 text-2xl text-text-muted" aria-hidden>
          {icon}
        </div>
      )}
      <h3 className="font-serif text-lg font-semibold text-text">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-md text-xs leading-relaxed text-text-muted">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
