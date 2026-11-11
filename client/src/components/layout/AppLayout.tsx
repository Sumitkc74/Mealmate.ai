import { Outlet, useLocation, Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Navbar } from './Navbar';
import { AiAssistant } from '@/components/ai/AiAssistant';
import { CookieConsentBanner, openCookiePreferencesModal } from '@/components/ui/CookieConsentBanner';
import { useAuthStore } from '@/stores/authStore';

export function AppLayout() {
  const location = useLocation();
  const isAuthed = useAuthStore((s) => Boolean(s.token && s.user));
  return (
    <div className="flex min-h-screen flex-col bg-canvas text-ink">
      <Navbar />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6 py-6 sm:py-10">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>

      <footer className="border-t border-line bg-canvas-soft py-8 px-4 sm:px-6 text-center space-y-4">
        <div className="mx-auto max-w-4xl flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-ink-soft">
          <Link to="/privacy" className="hover:text-ink hover:underline">
            Privacy Policy
          </Link>
          <span className="text-line-strong">·</span>
          <Link to="/terms" className="hover:text-ink hover:underline">
            Terms of Service
          </Link>
          <span className="text-line-strong">·</span>
          <Link to="/attributions" className="hover:text-ink hover:underline">
            Licenses &amp; Attribution
          </Link>
          <span className="text-line-strong">·</span>
          <Link to="/privacy/manage" className="hover:text-ink hover:underline">
            Manage Personal Data
          </Link>
          <span className="text-line-strong">·</span>
          <button
            type="button"
            onClick={openCookiePreferencesModal}
            className="hover:text-ink hover:underline text-xs"
          >
            Cookie Preferences
          </button>
        </div>

        <div className="mx-auto max-w-2xl text-xs text-ink-soft flex flex-wrap items-center justify-center gap-3">
          <span>
            Support:{' '}
            <a href="mailto:support@mealmate.ai" className="text-terracotta hover:underline">
              support@mealmate.ai
            </a>
          </span>
          <span className="text-line-strong">·</span>
          <span>
            Phone:{' '}
            <a href="tel:+12066241688" className="text-terracotta hover:underline font-mono">
              +1 (206) 624-1688
            </a>
          </span>
        </div>

        <p className="mx-auto max-w-2xl text-[11px] text-ink-mute leading-relaxed">
          <strong>Notice:</strong> MealMate is an educational AI research prototype. Nutritional calculations and ingredient recommendations are computational estimates and do not replace professional medical or nutritional advice. Verify ingredients if managing severe allergies.
        </p>

        <p className="text-xs tracking-wide text-ink-mute">
          <span className="font-serif italic text-ink-soft">MealMate</span> · CS628 Team T03 ·{' '}
          {new Date().getFullYear()}
        </p>
      </footer>

      {isAuthed && <AiAssistant />}
      <CookieConsentBanner />
    </div>
  );
}
