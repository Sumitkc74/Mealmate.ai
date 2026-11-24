import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApproveDeletion } from '@/hooks/useAuth';
import { extractErrorMessage } from '@/lib/api';
import { usePageMetadata } from '@/hooks/usePageMetadata';

/**
 * Landing page for the Approve link in the owner's review email
 * (lost-email path). The owner's click approves the request: the requester
 * and the account owner are both emailed, and the deletion is scheduled
 * 30 days out.
 *
 * The token is single-use, so the approve call fires exactly once: the ref
 * guard stops React StrictMode's dev double-invoke from consuming it twice.
 */
export function ApproveDeletionPage() {
  usePageMetadata({
    title: 'Approve Account Deletion | MealMate',
    description: 'Approve a MealMate account deletion request.',
  });

  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [done, setDone] = useState(false);
  const [deleteAt, setDeleteAt] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const approveDeletion = useApproveDeletion();
  const submittedRef = useRef(false);

  useEffect(() => {
    if (!token || submittedRef.current) return;
    submittedRef.current = true;
    approveDeletion
      .mutateAsync({ token })
      .then((data) => {
        setDeleteAt(data.deleteAt ?? null);
        setDone(true);
      })
      .catch((err) => {
        setFormError(
          extractErrorMessage(
            err,
            'This approval link is invalid or has expired.'
          )
        );
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="mx-auto mt-10 w-full max-w-md">
      <div className="rounded-2xl border border-line bg-card p-8 shadow-soft">
        <p className="mm-eyebrow">Delete an account</p>
        <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight text-ink">
          Approve <span className="italic text-brand-700">deletion</span>
        </h1>

        {!token ? (
          <div
            role="alert"
            className="mt-6 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            This approval link is missing its token.
          </div>
        ) : done ? (
          <p
            role="status"
            className="mt-6 rounded-md border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-sm text-brand-800"
          >
            Deletion approved. The requester and the account owner have been
            emailed
            {deleteAt ? `, and the account will be deleted on ${new Date(deleteAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}` : ''}
            {' '}unless the owner signs in first.
          </p>
        ) : formError ? (
          <div
            role="alert"
            className="mt-6 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {formError}
          </div>
        ) : (
          <p className="mt-6 text-sm text-ink-soft">Approving the request…</p>
        )}

        <p className="mt-7 text-center text-sm text-ink-soft">
          <Link to="/login" className="font-medium text-brand-700 hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
