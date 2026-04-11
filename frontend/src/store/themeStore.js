import { create } from 'zustand';

const applyTheme = (dark) => {
  if (dark) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
};

const savedTheme = localStorage.getItem('theme');
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
const initialDark = savedTheme ? savedTheme === 'dark' : prefersDark;
applyTheme(initialDark);

const useThemeStore = create((set) => ({
  isDark: initialDark,
  toggle: () =>
    set((state) => {
      const next = !state.isDark;
      applyTheme(next);
      localStorage.setItem('theme', next ? 'dark' : 'light');
      return { isDark: next };
    }),
  setDark: (dark) =>
    set(() => {
      applyTheme(dark);
      localStorage.setItem('theme', dark ? 'dark' : 'light');
      return { isDark: dark };
    }),
}));

export default useThemeStore;
