import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, className, id, ...rest },
  ref
) {
  const inputId = id ?? rest.name;
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-ink-soft">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        aria-invalid={Boolean(error) || undefined}
        className={cn(
          'h-11 rounded-xl border bg-card px-3.5 text-base sm:text-sm text-ink outline-none transition',
          'placeholder:text-ink-mute',
          'focus:ring-2 focus:ring-offset-0',
          error
            ? 'border-red-400 focus:border-red-500 focus:ring-red-200'
            : 'border-line-strong focus:border-brand-500 focus:ring-brand-200',
          className
        )}
        {...rest}
      />
      {error ? (
        <p className="text-xs text-red-700">{error}</p>
      ) : hint ? (
        <p className="text-xs text-ink-mute">{hint}</p>
      ) : null}
    </div>
  );
});
