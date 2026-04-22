import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Briefcase, Brain, BarChart3,
  FileBarChart2, Settings, LogOut, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useState } from 'react';
import useAuthStore from '../../store/authStore';

const navItems = [
  { to: '/dashboard',              icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/dashboard/deals',        icon: Briefcase,        label: 'Deals' },
  { to: '/dashboard/intelligence', icon: Brain,            label: 'Market Intelligence' },
  { to: '/dashboard/comps',        icon: BarChart3,        label: 'Comps' },
  { to: '/dashboard/reports',      icon: FileBarChart2,    label: 'Reports / Exports' },
  { to: '/dashboard/settings',     icon: Settings,         label: 'Admin / Settings' },
];

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const { logout, user } = useAuthStore();

  return (
    <aside
      className={`${collapsed ? 'w-16' : 'w-60'} flex flex-col transition-all duration-200 min-h-screen`}
      style={{
        backgroundColor: 'var(--color-bg-secondary)',
        color: 'var(--color-text-secondary)',
        borderRight: '1px solid var(--color-border-primary)',
      }}
    >
      {/* Logo / header */}
      <div
        className="flex items-center justify-between p-4"
        style={{ borderBottom: '1px solid var(--color-border-primary)' }}
      >
        {!collapsed && (
          <div className="flex items-baseline gap-1.5">
            <span
              className="font-serif text-lg font-semibold tracking-tight"
              style={{ color: 'var(--color-text-primary)' }}
            >
              REDIP
            </span>
            <span
              className="w-1.5 h-1.5 rounded-sm inline-block"
              style={{ backgroundColor: 'var(--color-brand-premium)' }}
            />
          </div>
        )}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="p-1 rounded transition-colors hover:bg-surface"
          style={{ color: 'var(--color-text-secondary)' }}
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
              `group flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors relative ${
                isActive ? 'font-medium' : ''
              }`
            }
            style={({ isActive }) => ({
              backgroundColor: isActive ? 'var(--color-brand-accent-soft)' : 'transparent',
              color: isActive ? 'var(--color-brand-accent)' : 'var(--color-text-secondary)',
            })}
            title={collapsed ? label : undefined}
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span
                    className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r-sm"
                    style={{ backgroundColor: 'var(--color-brand-accent)' }}
                  />
                )}
                <Icon size={17} className="flex-shrink-0" />
                {!collapsed && <span>{label}</span>}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User / logout */}
      <div
        className="p-4"
        style={{ borderTop: '1px solid var(--color-border-primary)' }}
      >
        {!collapsed && user && (
          <div className="mb-3 text-xs">
            <div
              className="font-medium truncate"
              style={{ color: 'var(--color-text-primary)' }}
            >
              {user.name}
            </div>
            <div className="truncate" style={{ color: 'var(--color-text-muted)' }}>
              {user.email}
            </div>
            <div className="capitalize" style={{ color: 'var(--color-text-muted)' }}>
              {user.role}
            </div>
          </div>
        )}
        <button
          onClick={logout}
          className="flex items-center gap-2 text-sm transition-colors w-full"
          style={{ color: 'var(--color-text-muted)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-data-negative)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-muted)')}
          title={collapsed ? 'Logout' : undefined}
        >
          <LogOut size={15} />
          {!collapsed && <span>Logout</span>}
        </button>
      </div>
    </aside>
  );
}
