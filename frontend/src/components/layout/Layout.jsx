import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import useCurrencyPref from '../../hooks/useCurrencyPref';
import CommandPalette from '../common/CommandPalette';

export default function Layout() {
  // Subscribe once so a currency change anywhere in the app re-renders the
  // entire authenticated tree — formatCrores() reads pref_currencyCode and
  // pref_fx_rate from localStorage on every call, so the cascade alone is
  // enough to update every dashboard card, KPI, and deal-card figure.
  useCurrencyPref();

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
        <main className="flex-1 p-4 sm:p-6 overflow-auto min-w-0">
          <Outlet />
        </main>
      </div>
      {/* Cmd+K palette is mounted once and overlays everything when toggled. */}
      <CommandPalette />
    </div>
  );
}
