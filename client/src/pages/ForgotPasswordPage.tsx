import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useForgotPassword } from '@/hooks/useAuth';
import { extractErrorMessage } from '@/lib/api';
import { usePageMetadata } from '@/hooks/usePageMetadata';

export function ForgotPasswordPage() {
  usePageMetadata({
    title: 'Forgot Password | MealMate',
    description: 'Request a password reset link for your MealMate account.',
  });

  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const forgotPassword = useForgotPassword();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setFormError('Please enter your email address.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setFormError('Please enter a valid email address format (e.g. name@domain.com).');
      return;
    }

    try {
      await forgotPassword.mutateAsync({ email: trimmedEmail.toLowerCase() });
      setSent(true);
    } catch (err) {
      setFormError(extractErrorMessage(err, 'Could not send a reset link. Please try again.'));
    }
  }

  return (
    <div className="mx-auto mt-10 w-full max-w-md">
      <div className="rounded-2xl border border-line bg-card p-8 shadow-soft">
        <p className="mm-eyebrow">Reset your password</p>
        <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight text-ink">
          Forgot your <span className="italic text-brand-700">password?</span>
        </h1>
        <p className="mt-2 text-sm text-ink-soft">
          Enter the email you signed up with and we&apos;ll send you a link to reset it.
        </p>

        {sent ? (
          <p role="status" className="mt-6 rounded-md border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-sm text-brand-800">
            If an account exists for that email, a password reset link is on its way.
            Check your inbox (and spam folder) — the link works for 1 hour.
          </p>
        ) : (
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

            {formError && (
              <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {formError}
              </div>
            )}

            <Button type="submit" loading={forgotPassword.isPending} className="w-full">
              Send reset link
            </Button>
          </form>
        )}

        <p className="mt-7 text-center text-sm text-ink-soft">
          Remembered it?{' '}
          <Link to="/login" className="font-medium text-brand-700 hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
