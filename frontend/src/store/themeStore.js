import { create } from 'zustand';

// Editorial design is light-only by intent (stone palette, paper bg, serif
// headlines). Dark mode was half-styled — landing + charts had black-on-dark
// contrast bugs. Forcing light site-wide; toggle is a no-op kept so existing
// call sites don't throw.
document.documentElement.classList.remove('dark');
try { localStorage.removeItem('theme'); } catch {}

const useThemeStore = create(() => ({
  isDark: false,
  toggle: () => {},
  setDark: () => {},
}));

export default useThemeStore;
