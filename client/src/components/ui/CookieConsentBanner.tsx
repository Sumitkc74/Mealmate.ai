import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Button } from './Button';

export interface CookiePreferences {
  essential: true;
  analytics: boolean;
  marketing: boolean;
  decidedAt: string;
}

const STORAGE_KEY = 'mealmate_cookie_consent';

export function getStoredCookiePreferences(): CookiePreferences | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CookiePreferences) : null;
  } catch {
    return null;
  }
}

export function openCookiePreferencesModal() {
  window.dispatchEvent(new CustomEvent('mealmate:open-cookie-modal'));
}

export function CookieConsentBanner() {
  const [showBanner, setShowBanner] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [analyticsOptIn, setAnalyticsOptIn] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);

  useEffect(() => {
    const existing = getStoredCookiePreferences();
    if (!existing) {
      // Delay showing banner slightly to avoid layout shift on initial load
      const t = setTimeout(() => setShowBanner(true), 600);
      return () => clearTimeout(t);
    } else {
      setAnalyticsOptIn(existing.analytics);
      setMarketingOptIn(existing.marketing);
    }

    const handleReopen = () => {
      setShowModal(true);
    };

    window.addEventListener('mealmate:open-cookie-modal', handleReopen);
    return () => window.removeEventListener('mealmate:open-cookie-modal', handleReopen);
  }, []);

  function savePreferences(analytics: boolean, marketing: boolean) {
    const prefs: CookiePreferences = {
      essential: true,
      analytics,
      marketing,
      decidedAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // storage unavailable
    }
    setShowBanner(false);
    setShowModal(false);
  }

  function handleAcceptAll() {
    savePreferences(true, true);
  }

  function handleRejectNonEssential() {
    savePreferences(false, false);
  }

  function handleSaveCustom() {
    savePreferences(analyticsOptIn, marketingOptIn);
  }

  if (!showBanner && !showModal) return null;

  return (
    <>
      {/* ──────── Cookie Consent Banner (Bottom of Screen) ──────── */}
      {showBanner && !showModal && (
        <aside
          aria-label="Cookie and Storage Consent"
          className="fixed bottom-0 inset-x-0 z-50 p-4 md:p-6 bg-canvas/95 backdrop-blur-md border-t border-line shadow-2xl transition-all animate-in fade-in slide-in-from-bottom-4 duration-300"
        >
          <div className="mx-auto max-w-6xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="space-y-1 max-w-3xl">
              <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full bg-brand-600" />
                Privacy &amp; Cookie Preferences
              </h3>
              <p className="text-xs text-ink-soft leading-relaxed">
                MealMate uses local browser storage for strictly necessary authentication and security. We also request permission for privacy-preserving analytics and personalized preferences to improve our meal planner. You can customize or change these choices anytime.{' '}
                <Link to="/privacy" className="text-brand-700 underline font-medium hover:text-brand-800">
                  Read our Privacy Policy
                </Link>
                .
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0 w-full md:w-auto">
              <button
                type="button"
                onClick={() => setShowModal(true)}
                className="px-3 py-1.5 text-xs font-medium text-ink-soft hover:text-ink underline border border-transparent rounded-lg"
              >
                Customize
              </button>
              <button
                type="button"
                onClick={handleRejectNonEssential}
                className="px-4 py-2 text-xs font-semibold text-ink bg-card hover:bg-canvas-soft border border-line rounded-full shadow-sm transition"
              >
                Essential Only
              </button>
              <Button size="sm" onClick={handleAcceptAll} className="text-xs px-5 py-2">
                Accept All
              </Button>
            </div>
          </div>
        </aside>
      )}

      {/* ──────── Preferences Modal ──────── */}
      {showModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cookie-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm"
        >
          <div className="relative w-full max-w-lg rounded-2xl border border-line bg-card p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-200">
            <div>
              <h2 id="cookie-modal-title" className="font-serif text-xl font-semibold text-ink">
                Cookie &amp; Storage Preferences
              </h2>
              <p className="mt-1 text-xs text-ink-soft leading-relaxed">
                Configure which local storage technologies and analytics telemetry you permit MealMate to use.
              </p>
            </div>

            <div className="space-y-4 divide-y divide-line text-sm">
              {/* Category 1: Strictly Necessary */}
              <div className="pt-3 flex items-start justify-between gap-4">
                <div>
                  <div className="font-medium text-ink flex items-center gap-2">
                    <span>Strictly Necessary</span>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-brand-700 bg-brand-50 px-2 py-0.5 rounded-full border border-brand-200">
                      Required
                    </span>
                  </div>
                  <p className="text-xs text-ink-mute mt-1">
                    Enables core user authentication, secure JSON Web Token storage, session state, and security headers. Cannot be turned off.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked
                  disabled
                  aria-label="Strictly necessary cookies always enabled"
                  className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 cursor-not-allowed opacity-70"
                />
              </div>

              {/* Category 2: Functional & Analytics */}
              <div className="pt-3 flex items-start justify-between gap-4">
                <div>
                  <div className="font-medium text-ink">Performance &amp; Analytics</div>
                  <p className="text-xs text-ink-mute mt-1">
                    Helps us understand recipe recommendation accuracy, aggregate response times, and feature usage without tracking you across third-party websites.
                  </p>
                </div>
                <input
                  type="checkbox"
                  id="cookie-analytics-toggle"
                  checked={analyticsOptIn}
                  onChange={(e) => setAnalyticsOptIn(e.target.checked)}
                  aria-label="Allow performance and analytics cookies"
                  className="mt-1 h-4 w-4 rounded border-line-strong text-brand-600 focus:ring-brand-500 cursor-pointer"
                />
              </div>

              {/* Category 3: Communications */}
              <div className="pt-3 flex items-start justify-between gap-4">
                <div>
                  <div className="font-medium text-ink">Personalization &amp; Communications</div>
                  <p className="text-xs text-ink-mute mt-1">
                    Allows storage of UI layout preferences, active filters, and optional recipe newsletters.
                  </p>
                </div>
                <input
                  type="checkbox"
                  id="cookie-marketing-toggle"
                  checked={marketingOptIn}
                  onChange={(e) => setMarketingOptIn(e.target.checked)}
                  aria-label="Allow personalization cookies"
                  className="mt-1 h-4 w-4 rounded border-line-strong text-brand-600 focus:ring-brand-500 cursor-pointer"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-line">
              <Link to="/privacy" className="text-xs text-brand-700 underline font-medium">
                Detailed Privacy Policy
              </Link>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-3 py-1.5 text-xs text-ink-soft hover:text-ink font-medium"
                >
                  Cancel
                </button>
                <Button size="sm" onClick={handleSaveCustom} className="text-xs">
                  Save Preferences
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
