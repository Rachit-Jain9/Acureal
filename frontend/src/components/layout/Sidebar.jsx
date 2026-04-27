import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Briefcase, Brain, BarChart3,
  FileBarChart2, Settings, LogOut, ChevronLeft, ChevronRight, X,
} from 'lucide-react';
import { useState } from 'react';
import { clsx } from 'clsx';
import useAuthStore from '../../store/authStore';

const navItems = [
  { to: '/dashboard',              icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/dashboard/deals',        icon: Briefcase,        label: 'Deals' },
  { to: '/dashboard/intelligence', icon: Brain,            label: 'Market Intelligence' },
  { to: '/dashboard/comps',        icon: BarChart3,        label: 'Comps' },
  { to: '/dashboard/reports',      icon: FileBarChart2,    label: 'Reports / Exports' },
  { to: '/dashboard/settings',     icon: Settings,         label: 'Admin / Settings' },
];

// Two rendering modes share this component:
//   • Desktop (md+): static column, width toggles 60 ↔ 16 via `collapsed`.
//   • Mobile (< md): off-canvas drawer controlled by `mobileOpen`, with a
//     backdrop that closes on tap. Desktop collapse is ignored on mobile —
//     the drawer always opens at full width for touch legibility.
export default function Sidebar({ mobileOpen = false, onMobileClose = () => {} }) {
  const [collapsed, setCollapsed] = useState(false);
  const { logout, user } = useAuthStore();

  const desktopWidth = collapsed ? 'md:w-16' : 'md:w-60';

  return (
    <>
      {/* Backdrop — visible only when the mobile drawer is open */}
      <button
        type="button"
        aria-hidden={!mobileOpen}
        tabIndex={-1}
        onClick={onMobileClose}
        className={clsx(
          'fixed inset-0 z-30 bg-black/40 md:hidden transition-opacity duration-200',
          mobileOpen ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
      />

      <aside
        className={clsx(
          'flex flex-col transition-transform duration-200 md:transition-all',
          'bg-bg-secondary text-content-secondary border-r border-hairline',
          // Mobile: fixed drawer, slides in from the left.
          'fixed inset-y-0 left-0 z-40 w-60',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          // Desktop: static column, no transform.
          'md:static md:translate-x-0 md:min-h-screen',
          desktopWidth,
        )}
      >
        {/* Logo / header */}
        <div className="flex items-center justify-between p-4 border-b border-hairline">
          {!collapsed && (
            <div className="flex items-baseline gap-1.5">
              <span className="font-serif text-lg font-semibold tracking-tight text-content-primary">
                REDIP
              </span>
              <span className="w-1.5 h-1.5 rounded-sm inline-block bg-premium" />
            </div>
          )}
          {/* Mobile close */}
          <button
            onClick={onMobileClose}
            className="p-1 rounded transition-colors hover:bg-surface md:hidden text-content-secondary"
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
          {/* Desktop collapse */}
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="p-1 rounded transition-colors hover:bg-surface hidden md:inline-flex text-content-secondary"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 space-y-0.5 px-2">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/dashboard'}
              className={({ isActive }) =>
                clsx(
                  'group flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors relative',
                  isActive
                    ? 'bg-accent-soft text-accent font-medium'
                    : 'text-content-secondary hover:bg-surface',
                )
              }
              title={collapsed ? label : undefined}
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r-sm bg-accent" />
                  )}
                  <Icon size={17} className="flex-shrink-0" />
                  {!collapsed && <span>{label}</span>}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* User / logout */}
        <div className="p-4 border-t border-hairline">
          {!collapsed && user && (
            <div className="mb-3 text-xs">
              <div className="font-medium truncate text-content-primary">{user.name}</div>
              <div className="truncate text-content-muted">{user.email}</div>
              <div className="capitalize text-content-muted">{user.role}</div>
            </div>
          )}
          <button
            onClick={logout}
            className="flex items-center gap-2 text-sm transition-colors w-full text-content-muted hover:text-data-negative"
            title={collapsed ? 'Logout' : undefined}
          >
            <LogOut size={15} />
            {!collapsed && <span>Logout</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
