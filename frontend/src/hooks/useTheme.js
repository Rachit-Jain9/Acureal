import { useEffect, useState } from 'react';

// Reactive read of the active dashboard theme.
//
// REDIP's themes flip via `document.documentElement.dataset.theme = 'dark'|'light'`.
// CSS custom properties handle 99% of restyling automatically — but a small
// number of components need to switch *non-CSS* assets (map tiles, chart
// canvases, third-party iframes) when the theme changes. Subscribe to the
// `data-theme` attribute via MutationObserver so those components update
// without a remount.
//
// Returns `'dark'` | `'light'`. Defaults to `'dark'` (REDIP's product default)
// when running in an SSR context or before the document is hydrated.
export default function useTheme() {
  const [theme, setTheme] = useState(() => {
    if (typeof document === 'undefined') return 'dark';
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  });

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const root = document.documentElement;
    const read = () => (root.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
    setTheme(read());
    const observer = new MutationObserver(() => setTheme(read()));
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  return theme;
}
