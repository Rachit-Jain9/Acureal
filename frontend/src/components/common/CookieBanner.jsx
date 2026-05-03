// Minimal essentials-only cookie notice. Dismissed permanently per browser
// once the user clicks "Got it"; no preference manager because we use only
// essential cookies (auth + session).
//
// Uses design-system tokens (bg-bg-elevated, text-content-*) so the banner
// auto-adapts to whatever theme is active — light on public pages (where
// usePublicLightTheme has flipped the html attribute) and dark on the
// authenticated dashboard.

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

const STORAGE_KEY = 'cookie_notice_dismissed';
const STORAGE_VALUE = 'v1';

export default function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const dismissed = localStorage.getItem(STORAGE_KEY);
      if (dismissed !== STORAGE_VALUE) {
        // Defer mounting by one frame so SSR-style flash on first paint is
        // avoided when navigating from a public page.
        const id = window.requestAnimationFrame(() => setVisible(true));
        return () => window.cancelAnimationFrame(id);
      }
    } catch {
      setVisible(true);
    }
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, STORAGE_VALUE);
    } catch {
      // Ignore — user can dismiss again next session if storage is unavailable.
    }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      role="region"
      aria-label="Cookie notice"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[min(40rem,calc(100vw-1.5rem))]"
    >
      <div className="flex items-start gap-3 rounded-editorial border border-hairline bg-bg-elevated shadow-editorial p-3 sm:p-4">
        <p className="text-sm text-content-secondary leading-relaxed flex-1">
          REDIP uses only essential cookies to keep you signed in. No advertising, no third-party
          tracking.{' '}
          <a
            href="/cookies"
            className="text-accent underline underline-offset-2 hover:text-accent"
          >
            Learn more
          </a>
          .
        </p>
        <button
          type="button"
          onClick={dismiss}
          className="inline-flex shrink-0 items-center gap-1 rounded-sm px-3 py-1.5 text-xs font-medium bg-content-primary text-bg-elevated hover:opacity-90 transition-opacity duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-elevated"
        >
          Got it
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Close"
          className="shrink-0 -mr-1 -mt-1 rounded p-1 text-content-muted hover:text-content-primary transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
