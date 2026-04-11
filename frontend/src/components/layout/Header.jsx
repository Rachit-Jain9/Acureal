import { useState } from 'react';
import { Bell, Search, Sun, Moon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '../../store/authStore';
import useThemeStore from '../../store/themeStore';

export default function Header() {
  const { user } = useAuthStore();
  const { isDark, toggle } = useThemeStore();
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
    <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-4 flex-1">
        <form onSubmit={handleSearch} className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search deals, properties, comps…"
            className="w-full pl-9 pr-4 py-2 bg-gray-50 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </form>
      </div>

      <div className="flex items-center gap-3">
        {/* Theme toggle */}
        <button
          onClick={toggle}
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          {isDark ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        <button className="relative p-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
          <Bell size={18} />
        </button>

        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-primary-600 text-white rounded-full flex items-center justify-center text-sm font-medium select-none">
            {user?.name?.[0]?.toUpperCase() || 'U'}
          </div>
          <span className="text-sm text-gray-700 dark:text-gray-300 hidden sm:block">{user?.name}</span>
        </div>
      </div>
    </header>
  );
}
