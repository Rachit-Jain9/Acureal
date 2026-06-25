import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import CommandPalette from '../common/CommandPalette';
import EmailVerificationBanner from '../common/EmailVerificationBanner';
import ProductTour from '../onboarding/ProductTour';
import GuideCenter from '../guide/GuideCenter';

export default function Layout() {
  // The multi-currency display layer was retired 2026-05-24 — every
  // figure is rendered in INR Crores now. No subscriber needed.

  // Mobile-drawer state for the sidebar. Desktop (md+) ignores this and
  // always renders the sidebar inline; mobile slides it in over the content
  // with a backdrop. Closed on every route change so the drawer doesn't
  // stay open after a navigation click.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const location = useLocation();
  const mainRef = useRef(null);
  useEffect(() => {
    setMobileNavOpen(false);
    // Reset scroll to the top of the content panel on every route change so a
    // new page never opens half-scrolled. In-page evidence-ref scrolls fire on
    // the SAME pathname, so they're unaffected. Instant (no smooth) — a nav
    // should land at the top immediately, not animate a long scroll.
    mainRef.current?.scrollTo({ top: 0, left: 0 });
  }, [location.pathname]);

  return (
    <div
      className="flex min-h-screen"
      style={{
        backgroundColor: 'var(--color-bg-primary)',
        color: 'var(--color-text-primary)',
      }}
    >
      {/* Skip-to-content: first focusable element so keyboard users can
          jump past the sidebar + header straight to the page body. Visually
          hidden until focused, then surfaces as a floating chip. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-3 focus:left-3 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-content-inverse focus:shadow-editorial-lg"
      >
        Skip to content
      </a>
      <Sidebar mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <Header onMobileMenuOpen={() => setMobileNavOpen(true)} />
        <EmailVerificationBanner />
        <main ref={mainRef} id="main-content" tabIndex={-1} className="flex-1 p-4 sm:p-6 overflow-auto min-w-0">
          {/* Keyed by pathname so the content panel cross-fades on route change
              (180ms, reduced-motion gated). The shell never animates. Tab
              changes within a page use searchParams (same pathname) and are
              handled by the per-tab fade, not this. */}
          <div key={location.pathname} className="redip-route-fade">
            <Outlet />
          </div>
        </main>
      </div>
      {/* Cmd+K palette is mounted once and overlays everything when toggled. */}
      <CommandPalette />
      {/* The Guide — an always-available, searchable explainer for every page,
          tab and concept. Opened from the Header "?", Cmd-K, Settings, or a
          per-page "?". Renders nothing until opened. */}
      <GuideCenter />
      {/* Product tour — auto-opens for users who haven't completed it yet,
          replayable from Settings. Renders nothing once dismissed. */}
      <ProductTour />
    </div>
  );
}
