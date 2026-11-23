import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError';
import { verifyAccessToken, type JwtPayload } from '../utils/jwt';
import { User } from '../models/User';
import { AUTH_COOKIE_NAME } from '../utils/authCookie';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/**
 * Extract the JWT from the request. The httpOnly cookie is the primary
 * source (the browser sends it automatically); the Authorization header is
 * still accepted for API clients and for the transition from localStorage.
 */
function extractToken(req: Request): string | null {
  const fromCookie = (req.cookies as Record<string, unknown> | undefined)?.[AUTH_COOKIE_NAME];
  if (typeof fromCookie === 'string' && fromCookie) return fromCookie;
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const token = header.slice(7).trim();
    if (token) return token;
  }
  return null;
}

/**
 * Require a valid JWT (httpOnly cookie or `Authorization: Bearer <token>`).
 *
 * Besides the signature and expiry, this also verifies the token still
 * belongs to a live account: the user must still exist, and the token's
 * tokenVersion must match the user's current one. A password reset bumps
 * tokenVersion, so a token stolen before the reset stops working; deleting
 * the account makes every token fail here immediately.
 */
export async function protect(req: Request, _res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) return next(AppError.unauthorized('Missing or malformed Authorization header'));
  try {
    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.sub).select('tokenVersion').lean();
    if (!user) return next(AppError.unauthorized('Account no longer exists'));
    if ((user.tokenVersion ?? 0) !== payload.tokenVersion) {
      return next(AppError.unauthorized('Token revoked — please sign in again'));
    }
    req.user = payload;
    next();
  } catch {
    next(AppError.unauthorized('Invalid or expired token'));
  }
}

/**
 * Attach the user when a valid JWT is present, but never reject the request.
 * Public read-only endpoints use this so guests can browse while signed-in
 * users still get their personal context (pantry, preferences, allergies).
 * An absent, invalid, or revoked token simply means the caller is a guest.
 */
export async function optionalProtect(req: Request, _res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) return next();
  try {
    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.sub).select('tokenVersion').lean();
    // Revoked (password reset) or deleted account: treat as a guest.
    if (!user || (user.tokenVersion ?? 0) !== payload.tokenVersion) return next();
    req.user = payload;
  } catch {
    // Invalid or expired token: treat the caller as a guest.
  }
  next();
}

/** Restrict to specific roles (use after `protect`). */
export function requireRole(...roles: Array<'user' | 'admin'>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(AppError.unauthorized());
    if (!roles.includes(req.user.role)) return next(AppError.forbidden('Insufficient role'));
    next();
  };
}
