# Acureal Theming — Semantic Tokens (single source of truth)

**Read before writing any color in the app UI.** The app is themeable (default **dark**, light supported) via a single `html[data-theme]` flip. Every color MUST route through a semantic token so it adapts to the theme. **Raw Tailwind palette utilities (`bg-red-50`, `text-green-700`, `border-amber-200`, `bg-primary-600`, …) are banned in `src/components` and `src/pages`** — they compile to fixed hex and render broken in the theme they weren't tuned for (the classic failure: `bg-red-50` is near-white, so it becomes a glaring white box on the near-black dark workspace).

A CI guard (`frontend/scripts/check-theme-tokens.cjs`) enforces this. The only allowed exceptions are listed in that guard (the art-directed marketing surface `src/pages/landing/**`, true brand colors like the Google sign-in button, and intentional chart-series hexes).

## The tokens

| Need | Token classes |
|---|---|
| Page / app surfaces | `bg-bg-primary` · `bg-bg-secondary` · `bg-bg-elevated` · `bg-surface` · `bg-surface-2` |
| Text ink | `text-content-primary` · `text-content-secondary` · `text-content-muted` · `text-content-inverse` |
| Hairlines / borders | `border-hairline` · `border-hairline-soft` · `border-hairline-strong` |
| Accent (trust blue — links, primary, focus) | `bg-accent` · `text-accent` · `bg-accent-soft` · `ring-accent` |
| Premium (rare amber signal) | `text-premium` · `bg-premium-soft` |
| Positive / money / success | `text-data-positive` · `bg-pos-soft` · solid `bg-data-positive` |
| Negative / risk / error | `text-data-negative` · `bg-neg-soft` · solid `bg-data-negative` |
| Neutral / informational data | `text-data-neutral` · `text-data-highlight` |

For status chips/pills, **prefer the `<Badge tone="success|danger|warn|info|neutral|premium">` primitive** (`components/common/Badge`) over hand-rolled chips.

## Migration mapping (raw utility → token)

Apply per call site, **pair-migrating** the background + text + border of the same element together.

### Soft status backgrounds — `*-50` and `*-100`
| From (any of) | To |
|---|---|
| `bg-{red,rose}-50/100` | `bg-neg-soft` |
| `bg-{green,emerald,lime,teal}-50/100` | `bg-pos-soft` |
| `bg-{amber,yellow,orange}-50/100` | `bg-premium-soft` |
| `bg-{blue,sky,indigo,violet,purple,cyan}-50/100` | `bg-accent-soft` |
| `bg-{slate,gray,zinc,neutral,stone}-50/100` | `bg-bg-secondary` (or `bg-surface` if it must read slightly stronger) |
| `bg-primary-50/100` | `bg-accent-soft` |

### Status text — `*-600/700/800/900`
| From | To |
|---|---|
| `text-{red,rose}-600/700/800/900` | `text-data-negative` |
| `text-{green,emerald,lime,teal}-600/700/800/900` | `text-data-positive` |
| `text-{amber,yellow,orange}-600/700/800/900` | `text-premium` |
| `text-{blue,sky,indigo,violet,purple,cyan}-600/700/800` | `text-accent` |
| `text-primary-600/700/800` | `text-accent` |
| `text-{slate,gray,zinc}-900/800` | `text-content-primary` |
| `text-{slate,gray,zinc}-700/600` | `text-content-secondary` |
| `text-{slate,gray,zinc}-500/400` | `text-content-muted` |

### Solid fills — `*-400/500/600/700` used as a filled indicator (dot, bar, progress, badge bg)
| From | To |
|---|---|
| `bg-{red,rose}-400..700` | `bg-data-negative` |
| `bg-{green,emerald}-400..700` | `bg-data-positive` |
| `bg-{amber,yellow,orange}-300..700` | `bg-premium` |
| `bg-{blue,sky}-400..700`, `bg-primary-500/600` | `bg-accent` |

### Borders — `*-100/200/300`
All colored + neutral border shades → `border-hairline` (the soft bg + colored text/icon already carry the status meaning). Use `border-hairline-strong` only where a stronger divider is intended.

### Fixed dark panel headers (`bg-slate-900 text-white`)
→ `bg-surface-2 text-content-primary` (theme-aware; the old literal dark band breaks the light/report theme).

### Focus rings / hover using the static `primary-*` palette
`primary` in `tailwind.config.js` is **static hex**, not a CSS var — replace with the theme-aware `accent`:
`ring-primary-500/40` → `ring-accent/40`, `hover:bg-primary-50` → `hover:bg-accent-soft`, `text-primary-600` → `text-accent`, etc.

## DO NOT migrate (leave as-is)
- **Opacity-modified utilities** like `bg-rose-500/10`, `bg-red-500/20`, `text-amber-500/80` — these apply alpha to the fixed-500 hex and **read correctly in both themes** (this is the blessed pattern, e.g. `design-system/index.jsx` `ErrorState`).
- **True brand colors** — the Google sign-in button (`GoogleSignInButton.jsx`) uses Google's literal logo palette intentionally.
- **Intentional chart-series hexes / the `--chart-1..6` palette** in recharts configs (categorical encoding, already theme-aware via CSS vars).
- **The marketing landing** (`src/pages/landing/**`) — its own art-directed warm palette.
- `index.css` and `tailwind.config.js` themselves (they define the tokens).

## Variant prefixes
Preserve any prefix and swap only the color: `hover:bg-red-50` → `hover:bg-neg-soft`, `focus-visible:ring-primary-500/40` → `focus-visible:ring-accent/40`, `group-hover:text-green-700` → `group-hover:text-data-positive`.

---
*Established 2026-06-25 during the dark-mode theming migration. Supersedes the partial `index.css` `html[data-theme='dark']` override block, which is being removed family-by-family as call sites migrate.*
