import { create } from 'zustand';

// REDIP dual-mode theme.
//
// Dark is the default analytical work mode (Bloomberg DNA).
// Light is the report / share mode for IC memos and PDFs.
// The whole site re-themes off one attribute: `html[data-theme="..."]`.

const STORAGE_KEY = 'redip.theme';

function readInitial() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {}
  // Default: dark (institutional work mode). Only honour OS light preference
  // if the user has explicitly set it.
  try {
    if (window.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light';
  } catch {}
  return 'dark';
}

function applyTheme(mode) {
  const html = document.documentElement;
  html.setAttribute('data-theme', mode);
  // Keep `.dark` class too for any Tailwind rules still written with the
  // legacy `dark:` variant until the full migration completes.
  html.classList.toggle('dark', mode === 'dark');
  html.style.colorScheme = mode;
  try {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', mode === 'dark' ? '#050507' : '#ffffff');
  } catch {}
}

const initial = readInitial();
applyTheme(initial);

const useThemeStore = create((set, get) => ({
  mode: initial,
  isDark: initial === 'dark',

  setMode: (mode) => {
    const next = mode === 'light' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch {}
    set({ mode: next, isDark: next === 'dark' });
  },

  toggle: () => {
    const next = get().mode === 'dark' ? 'light' : 'dark';
    get().setMode(next);
  },

  // Legacy shim — some components still call setDark(true/false)
  setDark: (isDark) => get().setMode(isDark ? 'dark' : 'light'),
}));

export default useThemeStore;
