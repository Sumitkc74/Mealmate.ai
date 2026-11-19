/**
 * Cookie-consent storage helpers shared by the consent banner, the app
 * layout, and the privacy page.
 * Kept in its own module (no components here) so the banner file only
 * exports its component — see react-refresh/only-export-components.
 */

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

export function saveCookiePreferences(analytics: boolean, marketing: boolean): void {
  const prefs: CookiePreferences = {
    essential: true,
    analytics,
    marketing,
    decidedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // storage unavailable — preferences simply aren't persisted
  }
}

export function openCookiePreferencesModal() {
  window.dispatchEvent(new CustomEvent('mealmate:open-cookie-modal'));
}
