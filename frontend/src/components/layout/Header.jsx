import { useState } from 'react';
import { Bell, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '../../store/authStore';

export default function Header() {
  const { user } = useAuthStore();
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
    <header className="bg-white border-b border-stone-200 px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-4 flex-1">
        <form onSubmit={handleSearch} className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" size={16} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search deals, properties, comps…"
            className="w-full pl-9 pr-4 py-2 bg-stone-50 border border-stone-200 rounded-sm text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:border-[#c2410c]"
          />
        </form>
      </div>

      <div className="flex items-center gap-3">
        <button className="relative p-2 text-stone-500 hover:text-stone-800">
          <Bell size={18} />
        </button>

        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-[#c2410c] text-white rounded-full flex items-center justify-center text-sm font-medium select-none">
            {user?.name?.[0]?.toUpperCase() || 'U'}
          </div>
          <span className="text-sm text-stone-700 hidden sm:block">{user?.name}</span>
        </div>
      </div>
    </header>
  );
}
