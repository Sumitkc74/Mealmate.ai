import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useConfirmDeletion } from '@/hooks/useAuth';
import { extractErrorMessage, extractErrorRetryable } from '@/lib/api';
import { usePageMetadata } from '@/hooks/usePageMetadata';

/**
 * Landing page for the deletion-confirmation link emailed to the registered
 * address (email-access path). The link click is the verification, so this
 * page confirms the request and schedules the deletion 30 days out.
 *
 * The token is single-use, so the confirm call fires exactly once: the ref
 * guard stops React StrictMode's dev double-invoke from consuming it twice.
 */
export function ConfirmDeletionPage() {
  usePageMetadata({
    title: 'Confirm Account Deletion | MealMate',
    description: 'Confirm your MealMate account deletion request.',
  });

  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [done, setDone] = useState(false);
  const [deleteAt, setDeleteAt] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const confirmDeletion = useConfirmDeletion();
  const submittedRef = useRef(false);

  useEffect(() => {
    if (!token || submittedRef.current) return;
    submittedRef.current = true;
    confirmDeletion
      .mutateAsync({ token })
      .then((data) => {
        setDeleteAt(data.deleteAt ?? null);
        setDone(true);
      })
      .catch((err) => {
        setFormError(
          extractErrorMessage(
            err,
            'This confirmation link is invalid or has expired. Request a new one.'
          )
        );
        setCanRetry(extractErrorRetryable(err));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="mx-auto mt-10 w-full max-w-md">
      <div className="rounded-2xl border border-line bg-card p-8 shadow-soft">
        <p className="mm-eyebrow">Delete your account</p>
        <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight text-ink">
          Confirm <span className="italic text-brand-700">deletion</span>
        </h1>

        {!token ? (
          <div
            role="alert"
            className="mt-6 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            This confirmation link is missing its token. Request a new one below.
          </div>
        ) : done ? (
          <p
            role="status"
            className="mt-6 rounded-md border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-sm text-brand-800"
          >
            Your account deletion is scheduled
            {deleteAt ? ` for ${new Date(deleteAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}` : ''}
            . Signing in at any point before then cancels it.
          </p>
        ) : formError ? (
          <div
            role="alert"
            className="mt-6 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {formError}
          </div>
        ) : (
          <p className="mt-6 text-sm text-ink-soft">Confirming your request…</p>
        )}

        <p className="mt-7 text-center text-sm text-ink-soft">
          {!token || (formError && canRetry) ? (
            <Link
              to="/request-deletion"
              className="font-medium text-brand-700 hover:underline"
            >
              Request a new confirmation link
            </Link>
          ) : (
            <Link to="/login" className="font-medium text-brand-700 hover:underline">
              Back to sign in
            </Link>
          )}
        </p>
      </div>
    </div>
  );
}
