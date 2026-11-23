import type request from 'supertest';

/**
 * Extract the JWT from the httpOnly auth cookie set by login / register.
 * The token is no longer returned in the response body, so tests read it
 * from the Set-Cookie header instead.
 */
export function tokenFromCookie(res: request.Response): string {
  const setCookie = res.headers['set-cookie'] as string[] | undefined;
  const cookie = setCookie?.find((c) => c.startsWith('mealmate_token='));
  if (!cookie) throw new Error('No mealmate_token cookie in response');
  const token = cookie.split(';')[0]?.slice('mealmate_token='.length);
  if (!token) throw new Error('No mealmate_token cookie in response');
  return token;
}
