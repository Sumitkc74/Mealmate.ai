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
  setAuth: (payload: { user: User }) => void;
  setUser: (user: User) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      setAuth: ({ user }) => set({ user }),
      setUser: (user) => set({ user }),
      logout: () => set({ user: null }),
    }),
    {
      name: 'mealmate.auth',
      partialize: (state) => ({ user: state.user }),
    }
  )
);

export const selectIsAuthenticated = (state: AuthState): boolean => Boolean(state.user);
