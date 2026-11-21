import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useMe } from '@/hooks/useAuth';

/** Feature-specific sign-in notices for the routes that still need an account. */
const MESSAGES: Array<{ test: (path: string) => boolean; message: string }> = [
  { test: (p) => p === '/recipes/new', message: 'Sign in to add a recipe.' },
  {
    test: (p) => p.startsWith('/recipes/') && p.endsWith('/edit'),
    message: 'Sign in to edit this recipe.',
  },
  {
    test: (p) => p === '/privacy/manage',
    message: 'Sign in to manage your personal data.',
  },
];

export function ProtectedRoute() {
  const token = useAuthStore((s) => s.token);
  const location = useLocation();
  const { isError } = useMe();

  // If /auth/me rejects (token invalid/expired), the api 401 interceptor clears auth.
  useEffect(() => {
    /* no-op: useMe runs side effects via store */
  }, [isError]);

  if (!token) {
    const match = MESSAGES.find((m) => m.test(location.pathname));
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname, ...(match ? { message: match.message } : {}) }}
      />
    );
  }
  return <Outlet />;
}

export function PublicOnlyRoute() {
  const token = useAuthStore((s) => s.token);
  if (token) return <Navigate to="/recipes" replace />;
  return <Outlet />;
}
