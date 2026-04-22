/** @type {import('tailwindcss').Config} */
/**
 * REDIP — Precision Analysis design system.
 *
 * All color classes resolve to CSS variables, so the whole site repaints
 * on a single `data-theme="light" | "dark"` attribute flip. Named groups:
 *
 *   bg-primary / bg-secondary / bg-elevated / surface — surfaces
 *   text-primary / text-secondary / text-muted       — text ink
 *   border-primary / border-secondary / border-strong — hairlines
 *   data-positive / data-negative / data-neutral / data-highlight — signals
 *   accent (blue, trust)                              — primary CTA
 *   premium (amber, rare)                             — above-bench badge
 *
 * Tailwind native `gray-*`/`slate-*` classes still compile; existing call
 * sites keep working while we migrate file-by-file.
 */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: ['selector', 'html[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // Semantic — the ONLY classes new code should use.
        bg: {
          DEFAULT:  'var(--color-bg-primary)',
          primary:  'var(--color-bg-primary)',
          secondary:'var(--color-bg-secondary)',
          elevated: 'var(--color-bg-elevated)',
        },
        surface: {
          DEFAULT: 'var(--color-surface)',
          2:       'var(--color-surface-2)',
        },
        content: {
          primary:   'var(--color-text-primary)',
          secondary: 'var(--color-text-secondary)',
          muted:     'var(--color-text-muted)',
          inverse:   'var(--color-text-inverse)',
        },
        hairline: {
          DEFAULT:   'var(--color-border-primary)',
          soft:      'var(--color-border-secondary)',
          strong:    'var(--color-border-strong)',
        },
        data: {
          positive:  'var(--color-data-positive)',
          negative:  'var(--color-data-negative)',
          neutral:   'var(--color-data-neutral)',
          highlight: 'var(--color-data-highlight)',
        },
        accent: {
          DEFAULT: 'var(--color-brand-accent)',
          soft:    'var(--color-brand-accent-soft)',
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
        premium: {
          DEFAULT: 'var(--color-brand-premium)',
          soft:    'var(--color-brand-premium-soft)',
        },

        // Legacy aliases so existing components keep compiling.
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
          DEFAULT: 'var(--color-bg-elevated)',
          50:  'var(--color-bg-primary)',
          100: 'var(--color-bg-elevated)',
          200: 'var(--color-surface)',
          300: 'var(--color-surface-2)',
        },
        line: {
          DEFAULT: 'var(--color-border-primary)',
          soft:    'var(--color-border-secondary)',
          strong:  'var(--color-border-strong)',
        },
        pos: { DEFAULT: 'var(--color-data-positive)', soft: 'rgba(34,197,94,0.14)' },
        neg: { DEFAULT: 'var(--color-data-negative)', soft: 'rgba(239,68,68,0.14)' },
      },
      fontFamily: {
        serif: [
          'Source Serif 4',
          'Source Serif Pro',
          'Georgia',
          'Cambria',
          'Times New Roman',
          'serif',
        ],
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
        'micro':    ['0.6875rem', { lineHeight: '1rem',    letterSpacing: '0.06em' }],
        'caption':  ['0.75rem',   { lineHeight: '1.1rem',  letterSpacing: '0.02em' }],
        'eyebrow':  ['0.6875rem', { lineHeight: '0.9rem',  letterSpacing: '0.14em' }],
        'metric':   ['1.75rem',   { lineHeight: '2rem',    letterSpacing: '-0.015em' }],
        'metric-lg':['2.25rem',   { lineHeight: '2.5rem',  letterSpacing: '-0.02em' }],
      },
      letterSpacing: {
        'eyebrow': '0.14em',
      },
      spacing: {
        '4.5': '1.125rem',
      },
      borderRadius: {
        'editorial': '10px',
      },
      boxShadow: {
        'editorial':    'var(--shadow-card)',
        'editorial-lg': 'var(--shadow-elevated)',
      },
    },
  },
  plugins: [],
};
