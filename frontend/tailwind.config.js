/** @type {import('tailwindcss').Config} */
/**
 * Editorial design tokens for REDIP.
 *
 * Intent: a Bloomberg/Stripe/Linear-caliber finance app — not a pastel
 * AI-demo dashboard. Neutral ink on paper, single cool accent, tight type
 * scale with tabular numerals for every financial figure.
 *
 * Tokens:
 *   - `ink`   — warm near-black text and heavy ink. Stable across themes.
 *   - `paper` — card / surface background. Warm off-white in light mode.
 *   - `line`  — hairline borders (lighter than any legacy `gray-200`).
 *   - `accent` — single editorial indigo. Use sparingly, for primary CTAs
 *                and active-state underlines only.
 *   - `pos` / `neg` — financial signals (emerald / rose). Used for deltas,
 *                     not decoration.
 *
 * Legacy `primary-*` palette is retained so existing components keep
 * compiling while we migrate page-by-page.
 */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          50:  '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
        ink: {
          50:  '#f7f7f6',
          100: '#ececea',
          200: '#d9d9d4',
          300: '#b9b9b2',
          400: '#8a8a83',
          500: '#5d5d58',
          600: '#3f3f3c',
          700: '#2b2b29',
          800: '#1d1d1b',
          900: '#141413',
          950: '#0a0a09',
        },
        paper: {
          DEFAULT: '#fbfbf8',
          50:  '#ffffff',
          100: '#fbfbf8',
          200: '#f6f5f0',
          300: '#eeede6',
        },
        line: {
          DEFAULT: '#e8e6df',
          soft:    '#efece6',
          strong:  '#d6d3c9',
        },
        accent: {
          50:  '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          500: '#4f46e5',
          600: '#4338ca',
          700: '#3730a3',
        },
        pos: { DEFAULT: '#047857', soft: '#ecfdf5' },
        neg: { DEFAULT: '#b91c1c', soft: '#fef2f2' },
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        display: [
          'Inter Display',
          'Inter',
          'ui-sans-serif',
          'system-ui',
          'sans-serif',
        ],
        mono: [
          'JetBrains Mono',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          'monospace',
        ],
      },
      fontSize: {
        'micro':   ['0.6875rem', { lineHeight: '1rem',    letterSpacing: '0.06em' }],
        'caption': ['0.75rem',   { lineHeight: '1.1rem',  letterSpacing: '0.02em' }],
        'eyebrow': ['0.6875rem', { lineHeight: '0.9rem',  letterSpacing: '0.12em' }],
        'metric':  ['1.75rem',   { lineHeight: '2rem',    letterSpacing: '-0.015em' }],
        'metric-lg': ['2.25rem', { lineHeight: '2.5rem',  letterSpacing: '-0.02em' }],
      },
      letterSpacing: {
        'eyebrow': '0.12em',
      },
      boxShadow: {
        'editorial':    '0 1px 2px 0 rgb(17 17 17 / 0.04), 0 1px 1px 0 rgb(17 17 17 / 0.03)',
        'editorial-lg': '0 4px 14px -4px rgb(17 17 17 / 0.08), 0 2px 6px -2px rgb(17 17 17 / 0.04)',
      },
    },
  },
  plugins: [],
};
