import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import CommandPalette from '../common/CommandPalette';
import EmailVerificationBanner from '../common/EmailVerificationBanner';
import ProductTour from '../onboarding/ProductTour';

export default function Layout() {
  // The multi-currency display layer was retired 2026-05-24 — every
  // figure is rendered in INR Crores now. No subscriber needed.

  // Mobile-drawer state for the sidebar. Desktop (md+) ignores this and
  // always renders the sidebar inline; mobile slides it in over the content
  // with a backdrop. Closed on every route change so the drawer doesn't
  // stay open after a navigation click.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const location = useLocation();
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  return (
    <div
      className="flex min-h-screen"
      style={{
        backgroundColor: 'var(--color-bg-primary)',
        color: 'var(--color-text-primary)',
      }}
    >
      <Sidebar mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <Header onMobileMenuOpen={() => setMobileNavOpen(true)} />
        <EmailVerificationBanner />
        <main className="flex-1 p-4 sm:p-6 overflow-auto min-w-0">
          <Outlet />
        </main>
      </div>
      {/* Cmd+K palette is mounted once and overlays everything when toggled. */}
      <CommandPalette />
      {/* Product tour — auto-opens for users who haven't completed it yet,
          replayable from Settings. Renders nothing once dismissed. */}
      <ProductTour />
    </div>
  );
}
