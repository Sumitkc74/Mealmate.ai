import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useLogin } from '@/hooks/useAuth';
import { extractErrorMessage } from '@/lib/api';
import { usePageMetadata } from '@/hooks/usePageMetadata';

interface LocationState {
  from?: string;
}

export function LoginPage() {
  usePageMetadata({
    title: 'Sign In | MealMate',
    description:
      'Sign in to your MealMate account to access your saved recipes, weekly meal planner, live pantry inventory, and automated grocery aisle consolidation.',
  });

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const login = useLogin();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as LocationState | null)?.from ?? '/recipes';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setFormError('Please enter your email address to sign in.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setFormError('Please enter a valid email address format (e.g. name@domain.com).');
      return;
    }
    if (!password) {
      setFormError('Please enter your password.');
      return;
    }

    try {
      await login.mutateAsync({ email: trimmedEmail.toLowerCase(), password });
      navigate(from, { replace: true });
    } catch (err) {
      setFormError(
        extractErrorMessage(
          err,
          'Incorrect email or password. Please verify your credentials or register for an account.'
        )
      );
    }
  }

  return (
    <div className="mx-auto mt-10 w-full max-w-md">
      <div className="rounded-2xl border border-line bg-card p-8 shadow-soft">
        <p className="mm-eyebrow">Welcome back</p>
        <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight text-ink">
          Sign in to <span className="italic text-brand-700">MealMate</span>
        </h1>
        <p className="mt-2 text-sm text-ink-soft">
          Continue planning your week with calm, AI-assisted recipes.
        </p>

        <form onSubmit={handleSubmit} className="mt-7 flex flex-col gap-4" noValidate>
          <Input
            type="email"
            name="email"
            label="Email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@domain.com"
          />
          <Input
            type="password"
            name="password"
            label="Password"
            autoComplete="current-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />

          {formError && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {formError}
            </div>
          )}

          <Button type="submit" loading={login.isPending} className="w-full">
            Sign in
          </Button>
        </form>

        <p className="mt-7 text-center text-sm text-ink-soft">
          New to MealMate?{' '}
          <Link to="/register" className="font-medium text-brand-700 hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
