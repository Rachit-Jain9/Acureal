import { useEffect } from 'react';

// Force light theme for public pages (signup form, Terms / Privacy / Cookie /
// Grievance). The dashboard theme store flips `html[data-theme]` and
// `html.dark`; on these pages we override to `light` regardless and restore
// the prior value on unmount so the user's dashboard theme preference
// survives the visit.
//
// Why we need this: index.css contains a comprehensive auto-flip rule
// scoped to `html[data-theme="dark"]` that maps raw Tailwind light tokens
// (bg-white, bg-gray-*, text-gray-*) to dark equivalents with !important.
// Public pages must escape that rule.

export default function usePublicLightTheme() {
  useEffect(() => {
    const html = document.documentElement;
    const prevTheme = html.getAttribute('data-theme');
    const prevDarkClass = html.classList.contains('dark');
    const prevColorScheme = html.style.colorScheme;

    html.setAttribute('data-theme', 'light');
    html.classList.remove('dark');
    html.style.colorScheme = 'light';

    return () => {
      if (prevTheme) html.setAttribute('data-theme', prevTheme);
      else html.removeAttribute('data-theme');
      html.classList.toggle('dark', prevDarkClass);
      html.style.colorScheme = prevColorScheme;
    };
  }, []);
}
