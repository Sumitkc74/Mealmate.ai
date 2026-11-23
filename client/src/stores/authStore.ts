import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@/types';

/**
 * Auth state. The JWT lives in an httpOnly cookie set by the server — it is
 * never stored here (localStorage is readable by any script, so a stored
 * token is one XSS away from full account takeover). The client only keeps
 * the user profile; "signed in" means a user is present, and the server
 * re-validates the cookie on every request.
 */
interface AuthState {
  user: User | null;
  /**
   * Timestamp (ms) of the last successful login/register. The api 401
   * interceptor uses it to avoid destroying a just-established session on
   * a transient 401 from the immediate post-auth /me validation (cookie /
   * proxy timing, cold Render): the server just proved the session valid
   * by setting the cookie and returning the user, so a 401 in the first
   * seconds after auth cannot mean the session is dead. Not persisted —
   * the grace only applies within the page session that just authed.
   */
  authedAt: number | null;
  setAuth: (payload: { user: User }) => void;
  setUser: (user: User) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      authedAt: null,
      setAuth: ({ user }) => set({ user, authedAt: Date.now() }),
      setUser: (user) => set({ user }),
      logout: () => set({ user: null, authedAt: null }),
    }),
    {
      name: 'mealmate.auth',
      partialize: (state) => ({ user: state.user }),
    }
  )
);

export const selectIsAuthenticated = (state: AuthState): boolean => Boolean(state.user);
