# REDIP Frontend Guidelines — Motion, Interactivity, Polish

**Read this before writing any frontend code.** These are standing rules. Failing any of them is a regression.

The bar: every panel, page, modal, chart, map, and export must feel **smooth, alive, decisive, and trustworthy** — Bloomberg / Stripe / Linear, never AI-SaaS-tacky.

---

## 1. Motion principles (when to animate, when not)

| Use motion for | Do NOT use motion for |
|---|---|
| State changes (open/close, expand/collapse, tab switch) | Static decorative effect |
| Drawing attention to a real, time-bounded event (data refresh, value change, save success) | Page-load splash animations |
| Showing relationship (parent-child, source-destination, hover-highlight) | "Hey look at me" parallax / floating shapes |
| Reducing perceived latency (skeleton → content fade) | Replacing instant feedback with delay |
| Confirming user action (button press feedback, toggle flip) | Auto-playing video, audio, or carousels |

**Rule:** if you can't explain in one sentence what state change the animation represents, delete it.

---

## 2. Timing and easing — exact values

| Interaction | Duration | Easing |
|---|---|---|
| Hover state on button/link | 120ms | `ease-out` |
| Focus ring appearance | 80ms | `ease-out` |
| Active/pressed state | 60ms | `ease-out` |
| Tooltip / popover appear | 150ms | `ease-out` |
| Modal / drawer open | 220ms | `cubic-bezier(0.16, 1, 0.3, 1)` (decelerate) |
| Modal / drawer close | 180ms | `cubic-bezier(0.7, 0, 0.84, 0)` (accelerate) |
| Tab content cross-fade | 180ms | `ease-out` |
| Layout shift (accordion expand, list reorder) | 240ms | `cubic-bezier(0.4, 0, 0.2, 1)` (standard) |
| Number count-up on KPI change | 600ms | `ease-out` |
| Chart bar/line draw-in (first paint only) | 700ms | `cubic-bezier(0.16, 1, 0.3, 1)` |
| Map zoom/pan | 400ms | leaflet default |
| Toast slide-in | 250ms | `cubic-bezier(0.16, 1, 0.3, 1)` |
| Toast slide-out | 200ms | `ease-in` |
| Refresh spinner rotation | 800ms | `linear`, infinite |
| Skeleton shimmer | 1200ms | `ease-in-out`, infinite |

**Never use:** durations under 60ms (invisible) or over 800ms for in-flow interactions (feels broken). Page-level transitions can go up to 1000ms but rarely should.

**Default to Tailwind utilities:** `transition-colors duration-150 ease-out`, `transition-transform duration-200 ease-out`, `transition-opacity duration-150`. Custom durations only when the table above prescribes them.

---

## 3. Required interaction states

Every interactive element MUST have all four states. Missing any is a bug.

```
default → hover → focus-visible → active
```

**Tailwind pattern (mandatory):**
```jsx
className="
  transition-colors duration-150 ease-out
  hover:border-primary-300 hover:bg-bg-secondary
  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40
  active:scale-[0.98] active:bg-bg-elevated
"
```

- **Hover:** subtle border / background shift. Never a color hue change.
- **Focus-visible:** 2px ring with 40% opacity primary color. Visible, not garish.
- **Active:** 1–2% scale-down (`scale-[0.98]` or `scale-[0.99]`) for tactile feedback. Never larger.
- **Disabled:** `opacity-50 cursor-not-allowed pointer-events-none`. No hover state when disabled.

---

## 4. Loading states — skeletons, not spinners

For any operation > 100ms, show a skeleton that matches the final layout. Spinners only for:
- Inline button loading (the button itself shows a spinner replacing the icon)
- Background polling / refresh of already-rendered content
- Map tile loads (leaflet handles)

**Skeleton rules:**
- Same shape, position, and size as the final content
- Animate with a `1200ms ease-in-out` shimmer (`bg-bg-secondary animate-pulse`)
- Stagger animation start by 50–80ms across siblings to feel alive, not synchronized

---

## 5. Live data — surface change, don't hide it

When data updates in place (refresh, polling, save):

- **Numbers count up/down** to the new value over 600ms (`ease-out`). Use `framer-motion` `<motion.span>` with key change or a count-up hook.
- **Status pills cross-fade** (180ms) between states.
- **Chart bars/lines reflow** with their stagger animation when underlying data changes.
- **Map markers** fade in/out (220ms), never pop.
- **A new item arriving in a list** slides + fades from the top (220ms decelerate).

The user should always see *that* something changed and *what* changed, never wonder if the page is stuck.

---

## 6. 3D / depth / parallax — used surgically

Default is flat. 3D depth is reserved for moments where it earns its complexity:

| Allowed | Banned |
|---|---|
| Subtle parallax tilt (≤ 4°) on hero KPI tiles when hovered | Decorative parallax background images |
| 3D rotation on a confidence-meter or scoring badge to signal multi-axis evaluation | Floating geometric shapes |
| Map tilt-to-3D on cadastral overlays when explicitly toggled | Page-load 3D logo reveals |
| Card flip (180° rotateY, 320ms) for "show details / show source" toggles | Cube transitions between tabs |

**Implementation:** use `framer-motion`'s `motion.div` with `transform-gpu` Tailwind class. Always respect `prefers-reduced-motion`.

---

## 7. Charts and data viz must be alive

- **First render:** bars/lines/pie segments draw in over 700ms with `cubic-bezier(0.16, 1, 0.3, 1)`. Stagger by 40ms across series.
- **Updates:** transition values smoothly over 400ms. Never snap.
- **Hover:** crosshair / tooltip appears within 80ms. Tooltip itself fades in 150ms.
- **Empty state:** never an empty white box. Always a placeholder with an explicit "no data yet" message + a path to provide data.
- **Tabular numbers always:** every number that lines up in a column or grid MUST use `tabular-nums`.

---

## 8. Page-level transitions

| Transition | Implementation |
|---|---|
| Route change (SPA navigation) | 180ms cross-fade on the main panel only — not the whole layout |
| Tab switch within a page | 180ms cross-fade with a 4px upward translate-in |
| Modal open | overlay fades in 150ms, panel slides up 16px + fades in over 220ms (decelerate) |
| Drawer open | slides in from the right 280ms (decelerate) |
| Toast | slides in from top-right 250ms, auto-dismiss after 4s, 200ms slide-out |

The shell (sidebar, header, tabs strip) NEVER animates on route change. Stable chrome around fluid content — never the other way around.

---

## 9. Accessibility — non-negotiable

- **`prefers-reduced-motion: reduce`** must collapse all non-essential motion to instant. Use `motion-safe:` Tailwind variant or a `@media` check. Required for every animation in this doc.
- **Keyboard navigation** must reach every interactive element. Focus order must match visual order.
- **WCAG AA contrast** on all text/background pairs (4.5:1 body, 3:1 for ≥18px text).
- **`aria-live="polite"`** on toasts and status updates so screen readers announce them.
- **`role="status"`** on loading indicators. `aria-busy="true"` on the parent during fetch.

---

## 10. Performance budget

- 60fps minimum for any in-flow animation. If a transition drops frames, reduce its complexity or remove it.
- Use `transform` and `opacity` for animations (GPU-composited). Never animate `width`, `height`, `top`, `left`, or `margin` directly.
- `will-change` only on elements actively animating, removed when done.
- Bundle impact of a new animation library must be < 15KB gzipped or it's not allowed. Prefer CSS / Tailwind / `framer-motion` (already installed).
- Lighthouse Performance score on the deal-detail page must stay ≥ 85.

---

## 11. Content presence — never empty, never anxious

| State | Treatment |
|---|---|
| No data yet | Friendly placeholder + 1-click action to get started ("No comps yet — Add comp") |
| Loading | Skeleton matching final layout |
| Error | `<ErrorState>` primitive with the actual error + retry action |
| Success | Brief toast (4s) + persisted visual change |
| Missing field | Em-dash (—) + small `<Badge tone="warn">Needs review</Badge>` chip |

**Never** show the literal phrase "Needs verification" repeated across multiple tiles. One signal per tile, max.

---

## 12. The "feel" rules — gut-check every PR

Ask these before merging anything visual:

1. Does it feel **calm**? (No jittery loops, no aggressive colors, no auto-playing anything.)
2. Does it feel **decisive**? (One clear primary action per panel. Not five competing buttons.)
3. Does it feel **trustworthy**? (Numbers line up. Source citations visible. No fake data.)
4. Does it feel **fast**? (Skeletons within 100ms. Hover within 120ms. Save feedback within 250ms.)
5. Does it feel **alive**? (Data updates animate. Counts roll. Statuses cross-fade.)
6. Does it feel **structured**? (Consistent grid, consistent spacing, consistent card style.)
7. Would a **GP at a Bengaluru fund showing this to LPs feel proud**? If not, it's not done.

If any answer is "no" or "not sure," do not merge.

---

## 13. Default tooling

- **Tailwind** for all static styling.
- **`framer-motion`** for any motion beyond simple CSS transitions (already in `package.json`).
- **`recharts`** for charts (already used). Inline styles required for chart props — that's fine, just hoist constants.
- **`react-leaflet`** for maps. Use `flyTo` with 400ms duration for programmatic moves.
- **`lucide-react`** for icons. Never decorative emojis in UI.
- **`tabular-nums`** Tailwind utility on every column-aligned number.

---

## Anti-patterns — do not ship these

- ❌ Linear gradients on hero tiles or backgrounds (looks like 2018 SaaS)
- ❌ Glow / neon effects (looks like crypto)
- ❌ Decorative emojis in the UI (use lucide icons)
- ❌ Auto-playing video, audio, or carousels
- ❌ Loading spinners for operations > 100ms (use skeletons)
- ❌ Saturated whole-tile pastel tints (chip-soup) — use neutral chrome + accent stripe
- ❌ Animations that don't represent a state change ("fancy for fancy's sake")
- ❌ Modal stacks deeper than 2
- ❌ Shell layout animating on route change
- ❌ Numbers that wrap mid-digit
- ❌ Long names that overflow without truncation + tooltip
- ❌ Page-load hero animations on internal tools (this is not a marketing site)
- ❌ Bouncy spring physics on professional surfaces (Stripe doesn't, neither do we)

---

*Last reviewed: 2026-04-28. Update this file when conventions shift, not when individual PRs add one-off behaviors.*
