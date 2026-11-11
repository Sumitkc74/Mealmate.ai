import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { api, extractErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { usePageMetadata } from '@/hooks/usePageMetadata';

export function ProfilePrivacyPage() {
  usePageMetadata({
    title: 'Manage Personal Data & Consent | MealMate',
    description:
      'Export your account data, manage dietary health consent, update privacy preferences, or request permanent account erasure from MealMate self-service portal.',
  });

  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  const [exportLoading, setExportLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [confirmInput, setConfirmInput] = useState('');
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleExportData() {
    setExportLoading(true);
    setFeedbackMessage(null);
    setErrorMessage(null);
    try {
      const response = await api.get('/auth/me/export', { responseType: 'blob' });
      const blob = new Blob([response.data], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `mealmate-data-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setFeedbackMessage('Your data export archive has been downloaded successfully.');
    } catch (err) {
      setErrorMessage(extractErrorMessage(err, 'Failed to export your data archive.'));
    } finally {
      setExportLoading(false);
    }
  }

  async function handleDeleteAccount() {
    if (confirmInput.trim().toUpperCase() !== 'DELETE') {
      setErrorMessage('Please type DELETE exactly to confirm account deletion.');
      return;
    }

    setDeleteLoading(true);
    setErrorMessage(null);
    try {
      await api.delete('/auth/me');
      logout();
      navigate('/', { replace: true });
    } catch (err) {
      setErrorMessage(extractErrorMessage(err, 'Could not delete your account. Please try again.'));
      setDeleteLoading(false);
    }
  }

  if (!user || !token) {
    return (
      <div className="mx-auto max-w-md py-12 text-center space-y-4">
        <h2 className="font-serif text-2xl font-semibold text-ink">Sign in required</h2>
        <p className="text-sm text-ink-soft">Please sign in to manage your privacy settings and exercise data rights.</p>
        <Link to="/login" className="inline-block rounded-full bg-ink px-6 py-2.5 text-sm font-semibold text-canvas">
          Sign In
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl py-6 space-y-8 text-ink">
      <header className="border-b border-line pb-5 space-y-2">
        <p className="mm-eyebrow">Data Subject Rights &amp; Privacy</p>
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-ink">
          Privacy &amp; Data Management Portal
        </h1>
        <p className="text-sm text-ink-soft leading-relaxed">
          Manage your personal data, exercise your GDPR/CCPA statutory rights, download your portability archive, or permanently erase your account.
        </p>
      </header>

      {feedbackMessage && (
        <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
          {feedbackMessage}
        </div>
      )}

      {errorMessage && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
          {errorMessage}
        </div>
      )}

      {/* ──────── What & Why Data is Collected ──────── */}
      <section className="space-y-4 rounded-2xl border border-line bg-card p-6 shadow-soft">
        <h2 className="font-serif text-xl font-semibold text-ink">What Data We Currently Hold About You</h2>
        <div className="grid md:grid-cols-2 gap-4 text-xs">
          <div className="border border-line rounded-xl p-3 bg-canvas space-y-1">
            <span className="font-semibold text-ink">Account Profile</span>
            <p className="text-ink-soft">Name: {user.name}</p>
            <p className="text-ink-soft">Email: {user.email}</p>
            <p className="text-ink-mute text-[11px] mt-1">Purpose: Account authentication and transactional notifications.</p>
          </div>

          <div className="border border-line rounded-xl p-3 bg-canvas space-y-1">
            <span className="font-semibold text-ink">Dietary &amp; Allergy Data</span>
            <p className="text-ink-soft">
              Preferences: {user.dietaryPreferences?.length ? user.dietaryPreferences.join(', ') : 'None specified'}
            </p>
            <p className="text-ink-soft">
              Allergies: {user.allergies?.length ? user.allergies.join(', ') : 'None specified'}
            </p>
            <p className="text-ink-mute text-[11px] mt-1">Purpose: Used strictly with your explicit consent to filter safe recipes.</p>
          </div>

          <div className="border border-line rounded-xl p-3 bg-canvas space-y-1">
            <span className="font-semibold text-ink">Pantry Ingredients</span>
            <p className="text-ink-soft">
              {user.pantry?.length ?? 0} tracked item(s) in your digital pantry.
            </p>
            <p className="text-ink-mute text-[11px] mt-1">Purpose: Prevents duplicate grocery purchases and calculates waste reduction.</p>
          </div>

          <div className="border border-line rounded-xl p-3 bg-canvas space-y-1">
            <span className="font-semibold text-ink">Meal Plans &amp; Groceries</span>
            <p className="text-ink-soft">Active weekly schedules and custom lists.</p>
            <p className="text-ink-mute text-[11px] mt-1">Purpose: Powering the interactive meal planner grid and PDF export.</p>
          </div>
        </div>
      </section>

      {/* ──────── Right to Data Portability ──────── */}
      <section className="space-y-4 rounded-2xl border border-line bg-card p-6 shadow-soft">
        <div className="space-y-1">
          <h2 className="font-serif text-xl font-semibold text-ink">Download Your Data Archive (Data Portability)</h2>
          <p className="text-xs text-ink-soft leading-relaxed">
            Under GDPR Article 20 and CCPA, you have the right to receive all personal data you provided to us in a structured, commonly used, and machine-readable JSON format.
          </p>
        </div>
        <div>
          <Button
            type="button"
            onClick={handleExportData}
            loading={exportLoading}
            variant="secondary"
            className="text-xs"
          >
            Export Complete Personal Data (.JSON)
          </Button>
        </div>
      </section>

      {/* ──────── Right to Erasure / Delete Account ──────── */}
      <section className="space-y-4 rounded-2xl border border-red-200 bg-red-50/30 p-6">
        <div className="space-y-1">
          <h2 className="font-serif text-xl font-semibold text-red-950">Delete Account &amp; Personal Data (Right to be Forgotten)</h2>
          <p className="text-xs text-red-900/80 leading-relaxed">
            Permanently delete your user profile, authentication credentials, dietary and allergy data, pantry logs, authored recipes, and meal plans. This action is irreversible.
          </p>
        </div>
        <div>
          <button
            type="button"
            onClick={() => setShowDeleteModal(true)}
            className="rounded-full bg-red-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-red-700 transition"
          >
            Delete My Account &amp; All Data
          </button>
        </div>
      </section>

      {/* ──────── Delete Confirmation Modal ──────── */}
      {showDeleteModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm"
        >
          <div className="relative w-full max-w-md rounded-2xl border border-line bg-card p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-200">
            <div>
              <h3 id="delete-dialog-title" className="font-serif text-xl font-semibold text-red-900">
                Confirm Account &amp; Data Deletion
              </h3>
              <p className="mt-2 text-xs text-ink-soft leading-relaxed">
                This will permanently delete your account, your email, your pantry items, and all saved meal plans in accordance with GDPR Article 17. This cannot be undone.
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="confirm-delete-input" className="block text-xs font-medium text-ink">
                Type <strong className="font-bold text-red-700">DELETE</strong> to confirm:
              </label>
              <input
                id="confirm-delete-input"
                type="text"
                value={confirmInput}
                onChange={(e) => setConfirmInput(e.target.value)}
                placeholder="DELETE"
                className="w-full rounded-xl border border-line-strong px-3 py-2 text-sm text-ink focus:border-red-600 focus:outline-none focus:ring-2 focus:ring-red-100"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
              <button
                type="button"
                onClick={() => {
                  setShowDeleteModal(false);
                  setConfirmInput('');
                }}
                className="px-3 py-2 text-xs font-medium text-ink-soft hover:text-ink"
              >
                Cancel
              </button>
              <Button
                type="button"
                onClick={handleDeleteAccount}
                loading={deleteLoading}
                disabled={confirmInput.trim().toUpperCase() !== 'DELETE'}
                className="bg-red-600 hover:bg-red-700 text-white text-xs px-4"
              >
                Permanently Delete Everything
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
