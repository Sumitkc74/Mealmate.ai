import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useRequestDeletion } from '@/hooks/useAuth';
import { extractErrorMessage } from '@/lib/api';
import { usePageMetadata } from '@/hooks/usePageMetadata';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Locked-out account deletion request. The in-app Privacy delete needs a
 * session, so a user who cannot sign in uses this form instead.
 *
 * Two paths, picked by the "I can't access this email" checkbox:
 * - Unchecked: a confirmation link goes to the registered email; clicking
 *   it schedules the deletion.
 * - Checked: the request goes to the owner's inbox with the account's real
 *   details, so the owner can judge the claim; the owner's Approve click
 *   schedules the deletion.
 * Either way the account is deleted 30 days later, unless the owner signs
 * in — signing in cancels it.
 */
export function RequestDeletionPage() {
  usePageMetadata({
    title: 'Request Account Deletion | MealMate',
    description: 'Ask for your MealMate account to be deleted when you cannot sign in.',
  });

  const [email, setEmail] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [name, setName] = useState('');
  const [recipe, setRecipe] = useState('');
  const [deleteRecipes, setDeleteRecipes] = useState(false);
  const [cannotAccessEmail, setCannotAccessEmail] = useState(false);
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const requestDeletion = useRequestDeletion();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    const accountEmail = email.trim().toLowerCase();
    const reachEmail = contactEmail.trim().toLowerCase();
    const trimmedName = name.trim();
    if (!accountEmail || !EMAIL_PATTERN.test(accountEmail)) {
      setFormError('Please enter the email you signed up with.');
      return;
    }
    if (!reachEmail || !EMAIL_PATTERN.test(reachEmail)) {
      setFormError('Please enter an email we can reach you at.');
      return;
    }
    if (trimmedName.length < 2) {
      setFormError('Please enter your name (at least 2 characters).');
      return;
    }

    try {
      await requestDeletion.mutateAsync({
        email: accountEmail,
        contactEmail: reachEmail,
        name: trimmedName,
        recipe: recipe.trim() || undefined,
        deleteRecipes,
        cannotAccessEmail,
      });
      setSent(true);
    } catch (err) {
      setFormError(
        extractErrorMessage(err, 'Could not send your request. Please try again.')
      );
    }
  }

  return (
    <div className="mx-auto mt-10 w-full max-w-md">
      <div className="rounded-2xl border border-line bg-card p-8 shadow-soft">
        <p className="mm-eyebrow">Delete your account</p>
        <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight text-ink">
          Can&apos;t <span className="italic text-brand-700">sign in?</span>
        </h1>
        <p className="mt-2 text-sm text-ink-soft">
          Ask for your account to be deleted. If you can still open your
          sign-up inbox you&apos;ll get a confirmation link; if not, your
          request goes to us for review. Either way the account is deleted
          30 days later, unless you sign in — signing in cancels it.
        </p>

        {sent ? (
          <p
            role="status"
            className="mt-6 rounded-md border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-sm text-brand-800"
          >
            Request received. If an account exists for that email, check your
            inbox for next steps — if you cannot access that inbox, your
            request has been sent for review instead.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="mt-7 flex flex-col gap-4" noValidate>
            <Input
              type="email"
              name="email"
              label="Email you signed up with"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@domain.com"
            />
            <Input
              type="email"
              name="contactEmail"
              label="Email we can reach you at"
              autoComplete="email"
              required
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="name@domain.com"
            />
            <Input
              type="text"
              name="name"
              label="Your name"
              autoComplete="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your display name"
            />
            <Input
              type="text"
              name="recipe"
              label="A recipe you created (optional)"
              value={recipe}
              onChange={(e) => setRecipe(e.target.value)}
              placeholder="e.g. Tomato Basil Pasta"
            />

            <fieldset className="space-y-2">
              <legend className="text-xs font-medium text-ink">
                What should happen to your recipes?
              </legend>
              <label className="flex items-start gap-2 rounded-xl border border-line bg-canvas px-3 py-2 text-xs cursor-pointer">
                <input
                  type="radio"
                  name="delete-recipes-choice"
                  value="leave"
                  checked={!deleteRecipes}
                  onChange={() => setDeleteRecipes(false)}
                  className="mt-0.5 accent-red-600"
                />
                <span>
                  <span className="block font-medium text-ink">Leave</span>
                  <span className="block text-ink-soft">
                    My recipes stay in the shared library as community recipes, and anyone signed in can edit them.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 rounded-xl border border-line bg-canvas px-3 py-2 text-xs cursor-pointer">
                <input
                  type="radio"
                  name="delete-recipes-choice"
                  value="delete"
                  checked={deleteRecipes}
                  onChange={() => setDeleteRecipes(true)}
                  className="mt-0.5 accent-red-600"
                />
                <span>
                  <span className="block font-medium text-ink">Delete</span>
                  <span className="block text-ink-soft">
                    My recipes are permanently removed from the library.
                  </span>
                </span>
              </label>
            </fieldset>

            <label className="flex items-start gap-2 rounded-xl border border-line bg-canvas px-3 py-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                name="cannotAccessEmail"
                checked={cannotAccessEmail}
                onChange={(e) => setCannotAccessEmail(e.target.checked)}
                className="mt-0.5 accent-red-600"
              />
              <span>
                <span className="block font-medium text-ink">
                  I can&apos;t access this email anymore
                </span>
                <span className="block text-ink-soft">
                  Your request will be reviewed instead of confirmed by email.
                  Give your name and a recipe above so it can be checked.
                </span>
              </span>
            </label>

            {formError && (
              <div
                role="alert"
                className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
              >
                {formError}
              </div>
            )}

            <Button type="submit" loading={requestDeletion.isPending} className="w-full">
              Request account deletion
            </Button>
          </form>
        )}

        <p className="mt-7 text-center text-sm text-ink-soft">
          Remembered your password?{' '}
          <Link to="/login" className="font-medium text-brand-700 hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
