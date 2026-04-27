import { useState } from 'react';
import { Bell, Search, Moon, Sun, Menu } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '../../store/authStore';
import useThemeStore from '../../store/themeStore';

export default function Header({ onMobileMenuOpen }) {
  const { user } = useAuthStore();
  const mode = useThemeStore((s) => s.mode);
  const toggleTheme = useThemeStore((s) => s.toggle);
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  const handleSearch = (e) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    navigate(`/dashboard/deals?search=${encodeURIComponent(q)}`);
    setQuery('');
  };

  return (
    <header className="px-4 sm:px-6 py-3 flex items-center justify-between gap-2 bg-bg-elevated border-b border-hairline">
      <div className="flex items-center gap-2 sm:gap-4 flex-1 min-w-0">
        {onMobileMenuOpen && (
          <button
            type="button"
            onClick={onMobileMenuOpen}
            className="p-2 -ml-2 rounded-md hover:bg-surface md:hidden flex-shrink-0 text-content-secondary"
            aria-label="Open menu"
          >
            <Menu size={18} />
          </button>
        )}
        <form onSubmit={handleSearch} className="relative max-w-md flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" size={16} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="w-full pl-9 pr-4 py-2 rounded-md text-sm focus:outline-none bg-bg-secondary text-content-primary border border-hairline"
          />
        </form>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={toggleTheme}
          aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          title={mode === 'dark' ? 'Switch to light (report) mode' : 'Switch to dark (work) mode'}
          className="p-2 rounded-md hover:bg-surface text-content-secondary"
        >
          {mode === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
        </button>

        <button
          className="p-2 rounded-md hover:bg-surface text-content-secondary"
          aria-label="Notifications"
        >
          <Bell size={17} />
        </button>

        <div className="flex items-center gap-2 pl-2">
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold select-none bg-accent text-white">
            {user?.name?.[0]?.toUpperCase() || 'U'}
          </div>
          <span className="text-sm hidden sm:block text-content-secondary">
            {user?.name}
          </span>
        </div>
      </div>
    </header>
  );
}
