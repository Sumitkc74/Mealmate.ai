import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Top-level React error boundary. Catches render-time exceptions in any child
 * component and surfaces a recovery UI instead of leaving the app blank.
 *
 * Async errors (fetch failures etc.) are handled per-component via TanStack
 * Query's `isError` state - this boundary is for genuine render crashes.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface to the console for dev; in production this is where a Sentry
    // (or similar) hook would go.
    // eslint-disable-next-line no-console
    console.error('Unhandled render error:', error, info.componentStack);
  }

  private handleReset = (): void => {
    this.setState({ error: null });
  };

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          role="alert"
          className="mx-auto mt-16 max-w-lg space-y-4 rounded-lg border border-red-200 bg-red-50 p-6 text-center"
        >
          <h1 className="text-2xl font-bold text-red-800">Something went wrong</h1>
          <p className="text-sm text-red-700">
            MealMate hit an unexpected error. You can try again, or reload the page.
          </p>
          <pre className="overflow-auto rounded bg-white/70 p-2 text-left text-xs text-red-900">
            {this.state.error.message}
          </pre>
          <div className="flex justify-center gap-2">
            <Button variant="secondary" onClick={this.handleReset}>
              Try again
            </Button>
            <Button onClick={this.handleReload}>Reload</Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
