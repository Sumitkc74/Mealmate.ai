import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';

export interface JwtPayload {
  sub: string; // user id
  role: 'user' | 'admin';
  /** Must match the user's current tokenVersion; bumped on password reset. */
  tokenVersion: number;
}

export function signAccessToken(payload: JwtPayload): string {
  const options: SignOptions = { expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'] };
  return jwt.sign(payload, env.JWT_SECRET, options);
}

export function verifyAccessToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET);
  if (typeof decoded === 'string' || !decoded.sub) {
    throw new Error('Invalid token payload');
  }
  return {
    sub: String(decoded.sub),
    role: (decoded as JwtPayload).role ?? 'user',
    // Tokens issued before tokenVersion existed carry none; treat them as
    // version 0 so they keep working until the user next resets their
    // password (which bumps the stored version and invalidates them).
    tokenVersion: typeof (decoded as JwtPayload).tokenVersion === 'number' ? (decoded as JwtPayload).tokenVersion : 0,
  };
}
