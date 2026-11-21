import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useResetPassword } from '@/hooks/useAuth';
import { extractErrorMessage } from '@/lib/api';
import { usePageMetadata } from '@/hooks/usePageMetadata';

export function ResetPasswordPage() {
  usePageMetadata({
    title: 'Reset Password | MealMate',
    description: 'Choose a new password for your MealMate account.',
  });

  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const resetPassword = useResetPassword();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (password.length < 8) {
      setFormError('Password must be at least 8 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setFormError('The two passwords do not match.');
      return;
    }

    try {
      await resetPassword.mutateAsync({ token, password });
      setDone(true);
    } catch (err) {
      setFormError(
        extractErrorMessage(
          err,
          'This reset link is invalid or has expired. Request a new one.'
        )
      );
    }
  }

  return (
    <div className="mx-auto mt-10 w-full max-w-md">
      <div className="rounded-2xl border border-line bg-card p-8 shadow-soft">
        <p className="mm-eyebrow">Reset your password</p>
        <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight text-ink">
          Choose a <span className="italic text-brand-700">new password</span>
        </h1>

        {!token ? (
          <div role="alert" className="mt-6 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            This reset link is missing its token. Request a new reset link below.
          </div>
        ) : done ? (
          <p role="status" className="mt-6 rounded-md border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-sm text-brand-800">
            Password reset. Sign in with your new password.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="mt-7 flex flex-col gap-4" noValidate>
            <Input
              type="password"
              name="password"
              label="New password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
            <Input
              type="password"
              name="confirmPassword"
              label="Confirm new password"
              autoComplete="new-password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
            />

            {formError && (
              <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {formError}
              </div>
            )}

            <Button type="submit" loading={resetPassword.isPending} className="w-full">
              Reset password
            </Button>
          </form>
        )}

        <p className="mt-7 text-center text-sm text-ink-soft">
          {!token ? (
            <>
              <Link to="/forgot-password" className="font-medium text-brand-700 hover:underline">
                Request a new reset link
              </Link>
            </>
          ) : (
            <>
              <Link to="/login" className="font-medium text-brand-700 hover:underline">
                Back to sign in
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
