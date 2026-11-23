import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useMe } from '@/hooks/useAuth';

/** Feature-specific sign-in notices for the routes that still need an account. */
const MESSAGES: Array<{ test: (path: string) => boolean; message: string }> = [
  {
    test: (p) => p === '/privacy/manage',
    message: 'Sign in to manage your personal data.',
  },
];

export function ProtectedRoute() {
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  const { isError } = useMe();

  // If /auth/me rejects (cookie invalid/expired), the api 401 interceptor clears auth.
  useEffect(() => {
    /* no-op: useMe runs side effects via store */
  }, [isError]);

  if (!user) {
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
  const user = useAuthStore((s) => s.user);
  if (user) return <Navigate to="/recipes" replace />;
  return <Outlet />;
}
