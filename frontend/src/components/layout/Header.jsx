import { useState } from 'react';
import { Search, Moon, Sun, Menu, HelpCircle } from 'lucide-react';
import useAuthStore from '../../store/authStore';
import useThemeStore from '../../store/themeStore';
import useGuideStore from '../../store/guideStore';

// Detect the platform once at module load so the kbd hint reads "⌘K" on
// macOS and "Ctrl K" everywhere else.
const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform || '');
const cmdLabel = isMac ? '⌘' : 'Ctrl';

const openCommandPalette = () => {
  // Custom event the CommandPalette listens for — keeps the palette's
  // open state encapsulated while still being mouse-openable.
  window.dispatchEvent(new CustomEvent('redip:cmdk-open'));
};

// One smooth, tactile treatment for the header's icon buttons — a soft
// background + ink shift on hover, a subtle press on active, a consistent
// focus ring. Instant (transition-less) hovers read as cheap; this is the
// considered version.
const ICON_BTN =
  'p-2 rounded-md text-content-secondary transition-colors duration-150 ease-out ' +
  'hover:bg-surface hover:text-content-primary active:scale-95 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40';

export default function Header({ onMobileMenuOpen }) {
  const { user } = useAuthStore();
  const mode = useThemeStore((s) => s.mode);
  const toggleTheme = useThemeStore((s) => s.toggle);
  const openGuide = useGuideStore((s) => s.openGuide);

  // The "search bar" is now a *button styled like* an input. Clicking
  // opens the Cmd-K palette where live search, deal jumps and recent-
  // deal navigation all live — strictly more useful than the old
  // submit-on-Enter behaviour that just navigated to /deals?search=.
  const [searchHover, setSearchHover] = useState(false);

  return (
    <header className="px-4 sm:px-6 py-3 flex items-center justify-between gap-2 bg-bg-elevated border-b border-hairline">
      <div className="flex items-center gap-2 sm:gap-4 flex-1 min-w-0">
        {onMobileMenuOpen && (
          <button
            type="button"
            onClick={onMobileMenuOpen}
            className={`${ICON_BTN} -ml-2 md:hidden flex-shrink-0`}
            aria-label="Open menu"
          >
            <Menu size={18} />
          </button>
        )}
        <button
          type="button"
          onClick={openCommandPalette}
          onMouseEnter={() => setSearchHover(true)}
          onMouseLeave={() => setSearchHover(false)}
          aria-label="Open quick search (Ctrl K)"
          className="relative max-w-md flex-1 min-w-0 flex items-center text-left rounded-md text-sm bg-bg-secondary text-content-secondary border border-hairline py-2 pl-9 pr-3 hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 transition-colors"
        >
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" size={16} />
          <span className={searchHover ? 'text-content-secondary' : 'text-content-muted'}>
            Search deals, jump to a page…
          </span>
          <span className="ml-auto flex items-center gap-1 text-[10px] uppercase tracking-wider text-content-tertiary">
            <kbd className="px-1.5 py-0.5 rounded border border-hairline bg-bg-elevated font-medium">
              {cmdLabel}
            </kbd>
            <kbd className="px-1.5 py-0.5 rounded border border-hairline bg-bg-elevated font-medium">K</kbd>
          </span>
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => openGuide()}
          aria-label="Open the guide"
          title="Guide — what everything does"
          className={ICON_BTN}
        >
          <HelpCircle size={17} />
        </button>
        <button
          onClick={toggleTheme}
          aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          title={mode === 'dark' ? 'Switch to light (report) mode' : 'Switch to dark (work) mode'}
          className={ICON_BTN}
        >
          {mode === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
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
