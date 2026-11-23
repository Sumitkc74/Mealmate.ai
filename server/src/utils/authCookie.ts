import type { Response } from 'express';
import { env } from '../config/env';

/**
 * The JWT lives in an httpOnly cookie, not localStorage, so JavaScript (and
 * any XSS payload or pasted DevTools snippet) cannot read it. The browser
 * sends it automatically on every request to the API origin.
 */
export const AUTH_COOKIE_NAME = 'mealmate_token';

/** How long the cookie (and the JWT inside it) stays valid. */
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function cookieOptions() {
  const isProduction = env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    // Cross-site in production (Vercel frontend, Render API), so the cookie
    // must be SameSite=None + Secure. Same-origin in local dev, where Secure
    // would stop the browser sending it over plain http.
    secure: isProduction,
    sameSite: (isProduction ? 'none' : 'lax') as 'none' | 'lax',
    maxAge: COOKIE_MAX_AGE_MS,
    path: '/',
  };
}

/** Set the httpOnly auth cookie after login / register. */
export function setAuthCookie(res: Response, token: string): void {
  res.cookie(AUTH_COOKIE_NAME, token, cookieOptions());
}

/** Clear the auth cookie (logout / account deletion). */
export function clearAuthCookie(res: Response): void {
  res.clearCookie(AUTH_COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
}
