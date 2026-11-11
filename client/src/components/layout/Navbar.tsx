import { useState, useEffect } from 'react';
import { NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useLogout } from '@/hooks/useAuth';
import { cn } from '@/lib/cn';

const links = [
  { to: '/recipes', label: 'Recipes' },
  { to: '/planner', label: 'Planner' },
  { to: '/grocery', label: 'Grocery' },
  { to: '/nutrition', label: 'Nutrition' },
  { to: '/pantry', label: 'Pantry' },
];

export function Navbar() {
  const user = useAuthStore((s) => s.user);
  const isAuthed = useAuthStore((s) => Boolean(s.token));
  const logout = useLogout();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Close mobile menu whenever location changes
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  // Close mobile menu on Escape key press
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && mobileMenuOpen) {
        setMobileMenuOpen(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileMenuOpen]);

  function handleLogout() {
    setMobileMenuOpen(false);
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <nav className="sticky top-0 z-30 border-b border-line bg-canvas">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-3">
          {/* Mobile Menu Hamburger Button (Items 3 & 4) */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-nav-menu"
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            className="flex h-11 w-11 items-center justify-center rounded-md border border-line bg-card text-ink transition-colors hover:bg-canvas md:hidden"
          >
            {mobileMenuOpen ? (
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            ) : (
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <line x1="4" y1="6" x2="20" y2="6" />
                <line x1="4" y1="12" x2="20" y2="12" />
                <line x1="4" y1="18" x2="20" y2="18" />
              </svg>
            )}
          </button>

          {/* Brand Logo */}
          <Link to="/" className="group flex items-center gap-2.5">
            <span
              aria-hidden
              className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 font-serif text-sm font-semibold text-white shadow-soft transition group-hover:bg-brand-700"
            >
              M
            </span>
            <span className="font-serif text-xl font-semibold tracking-tight text-ink">
              Meal<span className="text-brand-700">Mate</span>
            </span>
          </Link>
        </div>

        {/* Desktop Navigation Links */}
        {isAuthed && (
          <ul className="hidden items-center gap-0.5 md:flex">
            {links.map((l) => (
              <li key={l.to}>
                <NavLink
                  to={l.to}
                  className={({ isActive }) =>
                    cn(
                      'rounded-full px-3.5 py-2 text-sm font-medium transition-colors min-h-[44px] inline-flex items-center',
                      isActive
                        ? 'bg-brand-50 text-brand-800'
                        : 'text-ink-soft hover:bg-canvas-soft hover:text-ink'
                    )
                  }
                >
                  {l.label}
                </NavLink>
              </li>
            ))}
          </ul>
        )}

        {/* Desktop Auth Controls */}
        <div className="flex items-center gap-2">
          {isAuthed ? (
            <>
              <span className="hidden text-sm text-ink-soft sm:inline">
                Hi, <span className="font-medium text-ink">{user?.name ?? 'there'}</span>
              </span>
              <button
                onClick={handleLogout}
                className="inline-flex min-h-[44px] items-center rounded-full px-3.5 py-2 text-sm font-medium text-ink-soft hover:bg-canvas-soft hover:text-ink"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link
                to="/login"
                className="inline-flex min-h-[44px] items-center rounded-full px-3.5 py-2 text-sm font-medium text-ink-soft hover:bg-canvas-soft hover:text-ink"
              >
                Sign in
              </Link>
              <Link
                to="/register"
                className="inline-flex min-h-[44px] items-center rounded-full bg-ink px-4 py-2 text-sm font-semibold text-canvas shadow-soft transition hover:bg-brand-700"
              >
                Get started
              </Link>
            </>
          )}
        </div>
      </div>

      {/* Accessible Mobile Menu Drawer (Items 3 & 4) */}
      {mobileMenuOpen && (
        <div
          id="mobile-nav-menu"
          className="border-b border-line bg-card px-4 py-4 md:hidden animate-fadeIn"
        >
          {isAuthed ? (
            <div className="space-y-3">
              <div className="border-b border-line pb-2 text-xs text-ink-mute">
                Signed in as <span className="font-medium text-ink">{user?.name ?? user?.email}</span>
              </div>
              <ul className="flex flex-col gap-1">
                {links.map((l) => (
                  <li key={l.to}>
                    <NavLink
                      to={l.to}
                      onClick={() => setMobileMenuOpen(false)}
                      className={({ isActive }) =>
                        cn(
                          'flex min-h-[44px] w-full items-center rounded-md px-3.5 py-2 text-sm font-medium transition-colors',
                          isActive
                            ? 'bg-brand-50 text-brand-800 font-semibold'
                            : 'text-ink-soft hover:bg-canvas-soft hover:text-ink'
                        )
                      }
                    >
                      {l.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
              <div className="border-t border-line pt-2">
                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex min-h-[44px] w-full items-center rounded-md px-3.5 py-2 text-sm font-medium text-red-700 hover:bg-red-50 transition-colors"
                >
                  Sign out
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2 pt-1">
              <Link
                to="/login"
                onClick={() => setMobileMenuOpen(false)}
                className="flex min-h-[44px] w-full items-center justify-center rounded-md border border-line bg-canvas px-4 py-2.5 text-sm font-medium text-ink hover:bg-canvas-soft"
              >
                Sign in
              </Link>
              <Link
                to="/register"
                onClick={() => setMobileMenuOpen(false)}
                className="flex min-h-[44px] w-full items-center justify-center rounded-md bg-ink px-4 py-2.5 text-sm font-semibold text-canvas hover:bg-brand-700"
              >
                Create account
              </Link>
            </div>
          )}
        </div>
      )}
    </nav>
  );
}
