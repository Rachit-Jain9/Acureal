import { create } from 'zustand';

// Acureal dual-mode theme.
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

// Underlying flip — runs the actual data-theme + colorScheme + meta update.
// Kept synchronous so it can be called inside both the View Transitions
// callback (modern Chrome/Edge) and the className-gated fallback path.
function flipTheme(mode) {
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

// Track the timeout that strips `theme-transitioning` so rapid double-clicks
// on the toggle don't end up with the class permanently stuck on.
let transitionEndTimer = null;

// Theme switch with smooth cross-fade.
//
// Two strategies, picked at runtime:
//   1. View Transitions API (Chromium 111+, Safari 18+) — atomic snapshot +
//      cross-fade between old and new computed styles. Zero per-element
//      animation work; the browser handles the morph in a compositor pass.
//      This is the smoothest possible theme switch.
//   2. Fallback: add `html.theme-transitioning` for the duration of the CSS
//      transition (~220ms — slightly longer than the 180ms transition so
//      the class isn't stripped before the animations complete), then
//      remove. The CSS rule in index.css gates the universal color
//      transition on this class, so transitions only run during the brief
//      switch window — not on every hover or scroll.
function applyTheme(mode) {
  const html = document.documentElement;

  // Initial mount — no animation, just apply.
  if (!html.hasAttribute('data-theme')) {
    flipTheme(mode);
    return;
  }

  // Path 1: View Transitions API.
  if (typeof document.startViewTransition === 'function') {
    document.startViewTransition(() => flipTheme(mode));
    return;
  }

  // Path 2: className-gated fallback.
  html.classList.add('theme-transitioning');
  flipTheme(mode);
  if (transitionEndTimer) clearTimeout(transitionEndTimer);
  transitionEndTimer = setTimeout(() => {
    html.classList.remove('theme-transitioning');
    transitionEndTimer = null;
  }, 220);
}

const initial = readInitial();
flipTheme(initial); // First mount — instant, no animation.

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
