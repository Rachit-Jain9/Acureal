import { useState } from 'react';
import { Bell, Search, Moon, Sun } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '../../store/authStore';
import useThemeStore from '../../store/themeStore';

export default function Header() {
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
    <header
      className="px-6 py-3 flex items-center justify-between"
      style={{
        backgroundColor: 'var(--color-bg-elevated)',
        borderBottom: '1px solid var(--color-border-primary)',
      }}
    >
      <div className="flex items-center gap-4 flex-1">
        <form onSubmit={handleSearch} className="relative max-w-md flex-1">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2"
            size={16}
            style={{ color: 'var(--color-text-muted)' }}
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search deals, properties, comps…"
            className="w-full pl-9 pr-4 py-2 rounded-md text-sm focus:outline-none"
            style={{
              backgroundColor: 'var(--color-bg-secondary)',
              color: 'var(--color-text-primary)',
              border: '1px solid var(--color-border-primary)',
            }}
          />
        </form>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={toggleTheme}
          aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          title={mode === 'dark' ? 'Switch to light (report) mode' : 'Switch to dark (work) mode'}
          className="p-2 rounded-md hover:bg-surface"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {mode === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
        </button>

        <button
          className="p-2 rounded-md hover:bg-surface"
          style={{ color: 'var(--color-text-secondary)' }}
          aria-label="Notifications"
        >
          <Bell size={17} />
        </button>

        <div className="flex items-center gap-2 pl-2">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold select-none"
            style={{
              backgroundColor: 'var(--color-brand-accent)',
              color: 'white',
            }}
          >
            {user?.name?.[0]?.toUpperCase() || 'U'}
          </div>
          <span className="text-sm hidden sm:block" style={{ color: 'var(--color-text-secondary)' }}>
            {user?.name}
          </span>
        </div>
      </div>
    </header>
  );
}
