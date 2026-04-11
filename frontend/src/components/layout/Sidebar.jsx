import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Briefcase, Brain, BarChart3,
  FileBarChart2, Settings, LogOut, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useState } from 'react';
import useAuthStore from '../../store/authStore';

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/dashboard/deals', icon: Briefcase, label: 'Deals' },
  { to: '/dashboard/intelligence', icon: Brain, label: 'Market Intelligence' },
  { to: '/dashboard/comps', icon: BarChart3, label: 'Comps' },
  { to: '/dashboard/reports', icon: FileBarChart2, label: 'Reports / Exports' },
  { to: '/dashboard/settings', icon: Settings, label: 'Admin / Settings' },
];

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const { logout, user } = useAuthStore();

  return (
    <aside
      className={`${collapsed ? 'w-16' : 'w-60'} bg-gray-900 text-gray-300 flex flex-col transition-all duration-200 min-h-screen`}
    >
      {/* Logo / header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-800">
        {!collapsed && (
          <span className="text-lg font-bold text-white tracking-tight">REDIP</span>
        )}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="p-1 hover:bg-gray-800 rounded transition-colors"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 space-y-1 px-2">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/dashboard'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-primary-600 text-white'
                  : 'hover:bg-gray-800 hover:text-white'
              }`
            }
            title={collapsed ? label : undefined}
          >
            <Icon size={18} className="flex-shrink-0" />
            {!collapsed && <span>{label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* User / logout */}
      <div className="border-t border-gray-800 p-4">
        {!collapsed && user && (
          <div className="mb-3 text-xs">
            <div className="text-white font-medium truncate">{user.name}</div>
            <div className="text-gray-500 truncate">{user.email}</div>
            <div className="text-gray-500 capitalize">{user.role}</div>
          </div>
        )}
        <button
          onClick={logout}
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-red-400 transition-colors w-full"
          title={collapsed ? 'Logout' : undefined}
        >
          <LogOut size={16} />
          {!collapsed && <span>Logout</span>}
        </button>
      </div>
    </aside>
  );
}
