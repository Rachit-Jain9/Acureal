import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Briefcase, Brain, BarChart3,
  FileBarChart2, Settings, LogOut, ChevronLeft, ChevronRight, X,
  Shield, Map, Database, Inbox, Activity, Beaker, Sparkles, ShieldCheck,
} from 'lucide-react';
import { useState } from 'react';
import { clsx } from 'clsx';
import useAuthStore from '../../store/authStore';
import { isPlatformAdmin } from '../../utils/permissions';

// `tourId` is consumed by the product-tour coachmarks (data-tour attribute
// on the NavLink). Steps for nav items the user can't see (e.g. admin
// items for a Viewer) are filtered out at tour-start, so adding a tourId
// here is the only thing needed to make a nav item tour-aware.
const primaryNavItems = [
  { to: '/dashboard',              icon: LayoutDashboard, label: 'Dashboard',            tourId: 'nav-dashboard' },
  { to: '/dashboard/deals',        icon: Briefcase,        label: 'Deals',               tourId: 'nav-deals' },
  { to: '/dashboard/intelligence', icon: Brain,            label: 'Market Intelligence', tourId: 'nav-intelligence' },
  { to: '/dashboard/comps',        icon: BarChart3,        label: 'Comps',               tourId: 'nav-comps' },
  { to: '/dashboard/reports',      icon: FileBarChart2,    label: 'Reports / Exports',   tourId: 'nav-reports' },
];

// Admin group: shared data curation surfaces. Visible only to roles that can
// actually contribute (editor and above). Viewers see nothing here — they
// don't approve zones or evidence facts.
const adminNavItems = [
  { to: '/dashboard/admin/master-plan',          icon: Map,      label: 'Master Plan',         tourId: 'nav-master-plan' },
  { to: '/dashboard/admin/parcel-intelligence',  icon: Database, label: 'Parcel Intelligence', tourId: 'nav-parcel-intel' },
  { to: '/dashboard/admin/comps-queue',          icon: Inbox,    label: 'Comps Review Queue',  tourId: 'nav-comps-queue' },
  { to: '/dashboard/admin/ai-usage',             icon: Activity, label: 'AI Usage & Cost',     tourId: 'nav-ai-usage' },
  { to: '/dashboard/admin/ab-eval',              icon: Beaker,   label: 'A/B Evaluations',     tourId: 'nav-ab-eval' },
  { to: '/dashboard/admin/learning-signals',     icon: Sparkles, label: 'Learning Signals',    tourId: 'nav-learning-signals' },
  { to: '/dashboard/admin/audit-trail',          icon: ShieldCheck, label: 'Audit Trail',      tourId: 'nav-audit-trail' },
];

const tailNavItems = [
  { to: '/dashboard/settings', icon: Settings, label: 'Settings', tourId: 'nav-settings' },
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
  // Cross-org admin surfaces (Master Plan, AI Usage, etc.) are only for the
  // REDIP platform operator(s) — NOT every workspace owner. See utils/permissions.
  const showAdminGroup = isPlatformAdmin(user);

  const renderItem = ({ to, icon: Icon, label, tourId }) => (
    <NavLink
      key={to}
      to={to}
      end={to === '/dashboard'}
      data-tour={tourId}
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
  );

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
          {primaryNavItems.map(renderItem)}

          {showAdminGroup && (
            <>
              <div
                className={clsx(
                  'pt-4 pb-1 px-3 text-[11px] font-medium uppercase tracking-wider text-content-muted',
                  collapsed && 'sr-only',
                )}
                aria-hidden={collapsed}
              >
                <span className="inline-flex items-center gap-1.5">
                  <Shield size={11} />
                  Admin
                </span>
              </div>
              {adminNavItems.map(renderItem)}
            </>
          )}

          <div className="pt-4 pb-1 px-3" aria-hidden="true" />
          {tailNavItems.map(renderItem)}
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
