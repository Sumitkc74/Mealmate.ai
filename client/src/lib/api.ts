import axios, { AxiosError, type AxiosInstance } from 'axios';
import { useAuthStore } from '@/stores/authStore';

/**
 * API base URL, resolved at call time so tests can stub the env.
 *
 * In production the client is served by Vercel and the API is proxied
 * through the same origin (/api → Render, /static → Render — see
 * client/vercel.json), so the auth cookie is first-party and the browser
 * reliably stores and sends it. A cross-site Render URL here would make
 * the session depend on third-party cookie support, which browsers
 * increasingly block — that is what broke sign-in on the live site (the
 * server was fine; the browser never held the session). In local dev,
 * VITE_API_URL (http://localhost:5000/api) is honoured, falling back to
 * the Vite proxy on /api.
 */
export function getApiBaseUrl(): string {
  if (import.meta.env.PROD) return '/api';
  return import.meta.env.VITE_API_URL ?? '/api';
}

/**
 * Resolve a recipe image URL for display. Absolute URLs (remote photos,
 * generated images) pass through unchanged. Server-relative paths such as
 * `/static/recipe-images/<hash>.jpg` are hosted by the API server, so they
 * must be resolved against the API origin — used verbatim they would hit
 * the Vercel origin instead, which answers with the SPA HTML and the image
 * silently fails to load. In production the API origin is the page origin
 * itself (the /static rewrite proxies to Render); in dev it is VITE_API_URL.
 */
export function resolveImageUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  if (url.startsWith('/')) {
    try {
      return new URL(getApiBaseUrl(), window.location.origin).origin + url;
    } catch {
      return url;
    }
  }
  return url;
}

export const api: AxiosInstance = axios.create({
  baseURL: getApiBaseUrl(),
  timeout: 15_000,
  // Send the httpOnly auth cookie on every request (the JWT lives in the
  // cookie, not in JS). In production this is now same-origin (Vercel
  // frontend, proxied API), so the cookie is first-party.
  withCredentials: true,
});

// Only the session check (GET /auth/me) is authoritative for "are we signed
// in". A 401 from any other call (migration, recipes, plans, AI) must not
// sign the user out — it may be transient, and useMe re-validates the
// session on the next load. Previously any 401 while a user was present
// logged them out, so one failed background call nuked the session.
function isSessionCheck(error: AxiosError): boolean {
  const url = error.config?.url ?? '';
  const path = url.split('?')[0] ?? '';
  const method = (error.config?.method ?? '').toLowerCase();
  return method === 'get' && (path === '/auth/me' || path.endsWith('/auth/me'));
}

// Grace period after a successful login/register: the server just proved
// the session valid (it set the cookie and returned the user), so a 401
// from the immediate post-auth /me validation is transient — cookie/proxy
// timing or a cold Render — not a dead session. Logging out on it destroys
// a session that was just established (seen live: registration drops the
// session on first navigation while sign-in works). The window covers the
// 15s axios timeout, so even a slow validation response is protected.
// After the window, a 401 is treated as a real session failure again.
const POST_AUTH_GRACE_MS = 20_000;

// Auto-logout on a 401 from the session check, and surface a friendly message.
api.interceptors.response.use(
  (res) => res,
  (error: AxiosError<{ message?: string }>) => {
    if (error.response?.status === 401 && isSessionCheck(error)) {
      const { user, logout, authedAt } = useAuthStore.getState();
      const inGrace = authedAt !== null && Date.now() - authedAt < POST_AUTH_GRACE_MS;
      // Only force logout if we actually had a user (not for failed login attempts),
      // and not within the post-auth grace window.
      if (user && !inGrace) logout();
    }
    return Promise.reject(error);
  }
);

export function extractErrorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { message?: string; details?: unknown } | undefined;
    if (data?.message) return data.message;
    if (err.message) return err.message;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}

/**
 * Whether the failed request can be retried by submitting a new one.
 * The server sets `details.retryable` on deletion-link failures (unknown,
 * expired, or cancelled links); already-approved and already-deleted
 * links are not retryable. Anything without that flag is not retryable.
 */
export function extractErrorRetryable(err: unknown): boolean {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as
      | { details?: { retryable?: boolean } }
      | undefined;
    return data?.details?.retryable === true;
  }
  return false;
}
