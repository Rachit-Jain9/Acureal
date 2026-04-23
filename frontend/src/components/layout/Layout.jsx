import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import useCurrencyPref from '../../hooks/useCurrencyPref';

export default function Layout() {
  // Subscribe once so a currency change anywhere in the app re-renders the
  // entire authenticated tree — formatCrores() reads pref_currencyCode and
  // pref_fx_rate from localStorage on every call, so the cascade alone is
  // enough to update every dashboard card, KPI, and deal-card figure.
  useCurrencyPref();
  return (
    <div
      className="flex min-h-screen"
      style={{
        backgroundColor: 'var(--color-bg-primary)',
        color: 'var(--color-text-primary)',
      }}
    >
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header />
        <main className="flex-1 p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
