# REDIP — AI Agent Rules

This file is read by Claude Code, Codex, Cursor, and any other AI tool working on this repo.
All rules here apply to every session, every PR, every code change.

---

## How to ship

- One PR per logical concern. Don't mix a refactor + bug fix in the same PR.
- Branch → push → open PR → wait for CI to pass → squash-merge → delete branch → next.
- Never commit directly to master. Never amend a published commit.
- PR titles use Conventional Commits: `feat(scope):`, `fix(scope):`, `refactor(scope):`, `chore(scope):`

## Every PR must include a plain-English explanation

**This is mandatory.** After every PR, write a short section in the PR description (and in SESSION_LOG.md) that explains in plain, non-technical language:
- What changed — what does the site do now that it didn't before, or what was broken that's now fixed
- What you can see or do differently — be specific ("you can now click X and see Y")
- Why it matters for the product

No jargon. Write it as if explaining to someone who doesn't code.

## Plain-English recap after every shipped task

**Mandatory.** After every commit pushed, deploy, or migration applied, write a short recap in chat for the user. Rules:

- No code terms, no file paths, no jargon.
- 2–4 short bullets max. One sentence each.
- Lead with what the user can now see, do, or trust that they couldn't before.
- Close with one line on why it matters for the product, if non-obvious.

Different from the PR description rule above (which lives in the PR body). This recap rule is for the in-chat reply right after the work lands.

## Session logging

At the end of every session, append a summary to `SESSION_LOG.md` in the repo root. Include:
- Date
- What was worked on in plain English
- What PRs were opened/merged
- What's left to do

This ensures work history is never lost even if the chat session disappears.

---

## What this product is

REDIP is an India-first, Bengaluru-priority deal intelligence platform. It is the operating system for live real estate deal work — sourcing, due diligence, underwriting, IC prep, investor reporting.

It is NOT a generic CRM or document vault.

The goal: compress the time between spotting a deal and making a confident IC decision, while surfacing the blind spots common in Indian real estate — title disputes, hidden encumbrances, approval gaps, RERA deviations, promoter execution risk.

---

## Frontend motion and polish — mandatory

For ALL frontend work, read **`docs/FRONTEND_GUIDELINES.md`** before writing code. Hard requirements:

- Every interactive element has hover / focus-visible / active states (Tailwind pattern in section 3).
- Skeletons (not spinners) for any operation > 100ms. Match final layout.
- Live data: numbers count up/down (600ms ease-out). Status pills cross-fade (180ms). Lists slide-in from top.
- Use the exact timing/easing table in section 2 — don't invent durations.
- 3D / parallax only when it represents a real state change. Default is flat.
- Charts: draw-in on first render (700ms staggered), smooth transitions on update, tabular-nums always.
- Page-level transitions: 180ms cross-fade on tab/route switch, 220ms slide+fade for modals (decelerate). Shell never animates on route change.
- `prefers-reduced-motion: reduce` must collapse non-essential motion to instant.
- 60fps minimum. Animate `transform`/`opacity` only — never `width`/`height`/`top`/`left`.

Banned: gradients on hero tiles, glow/neon, decorative emojis, auto-play, spinner-for-skeleton, saturated whole-tile pastel tints, decorative parallax, bouncy spring physics on professional surfaces.

The seven feel-check questions in section 12 of the guidelines doc are mandatory before any visual PR merges.

## Code quality rules

### Token mapping — always use these instead of raw CSS vars or colors
| Use this Tailwind class | Instead of |
|---|---|
| `text-content-primary` | `var(--color-text-primary)` |
| `text-content-secondary` | `var(--color-text-secondary)` |
| `text-content-muted` | `var(--color-text-muted)` |
| `text-data-positive` | `var(--color-data-positive)` |
| `text-data-negative` | `var(--color-data-negative)` |
| `text-accent` / `bg-accent` | `var(--color-brand-accent)` |
| `bg-accent-soft` | `var(--color-brand-accent-soft)` |
| `bg-bg-elevated` | `var(--color-bg-elevated)` |
| `bg-bg-secondary` | `var(--color-bg-secondary)` |
| `bg-surface` | `var(--color-surface)` |
| `border-hairline` | `var(--color-border-primary)` |
| `border-hairline-soft` | `var(--color-border-secondary)` |

### CSS vars that do NOT exist — never use these
- `--color-text-tertiary` → use `text-content-muted`
- `--color-border` → use `border-hairline`
- `--color-bg-tertiary` → use `bg-surface`

### Design system — always use these primitives
- Status badges → `<Badge tone="...">`
- Warning banners → `<ErrorState tone="warn">`
- Section titles → `<SectionHeader>`
- Secondary metric tiles → `<StatTile>`
- Hero KPI tiles → `<MetricTile>`

### Visual style — Bloomberg/Stripe/Linear, not generic AI-SaaS
- Dense, classy, sophisticated. Not saturated chip-soup.
- Metric cards: neutral chrome (`bg-bg-secondary` / `border-hairline`) + colored delta line only
- Eyebrows: `text-eyebrow uppercase tracking-[0.08em]`

### When inline styles must stay (do not convert these)
- Recharts props (`tick={{ fontSize, fill }}`, `axisLine`, tooltip style)
- SVG fill/stroke attributes
- Per-data-point colors computed from data at runtime
- Dynamic geometry (`left: ${pct}%`, runtime-computed widths)

### Comments
- Default: no comments.
- Only add a comment when the WHY is non-obvious: a hidden constraint, a workaround for a specific bug.
- Never comment what the code does — the variable names do that.
- Never add migration notes in code ("// migrated from X", "// uses Badge now").

---

## Hard rules — never break these

- Never fabricate zoning, legal, title, RERA, ownership, market, comp, GIS, or financial facts.
- Never use AI/LLMs for financial math, KPI math, or rule-engine decisions. Use deterministic code.
- Never ship UI that looks real if the data behind it is fake or stubbed.
- Never hardcode secrets, tokens, or credentials.
- Never create duplicate top-level entities for the same real-world object.
- Never auto-generate or imply legal conclusions on title, zoning, RERA, or approvals. Frame as "extraction/synthesis aid" with disclaimers and human verification prompts.
- Never expose unverified comps or market data as authoritative. Always show source, freshness, and confidence — or "No verified feed available."
- Every AI-synthesized narrative (risk summary, DD brief, IC memo) must carry an "AI-assisted — requires human review" label in UI and exports.
- Preserve an immutable audit trail for every material change to a deal. Non-negotiable.

## AI routing
- **Gemini**: document classification, OCR extraction (Kannada/English/Hindi), translation, field extraction from agreements, sale deeds, RERA docs
- **Claude**: cross-document reasoning, DD synthesis, risk narrative, IC-style memo drafting, inconsistency detection across documents
- **Deterministic code only**: all financial math, KPI calculations, area/price normalization, approval logic, scoring, GIS math
- Route AI only when confidence thresholds are met. Otherwise show raw extraction + "low confidence — manual verification required."
- All AI outputs that influence decisions must trace back to specific uploaded documents or verified feeds.

## Asset classes to audit when fixing financials
When fixing a bug in one asset class, check all 9:
`residential_apartments`, `plotted_development`, `commercial_office`, `retail`, `industrial_warehousing`, `hospitality`, `villas`, `redevelopment`, `mixed_use`

---

## Anti-patterns — never do these

- Never hand-roll status badges — use `<Badge tone>`
- Never hand-roll warning banners (amber divs) — use `<ErrorState tone="warn">`
- Never use saturated whole-tile tints on KPI cards
- Never mix `className` and `style={{}}` for the same property
- Never create planning/status files (PLAN.md, STATUS.md) unless explicitly asked
- Never add features or abstractions beyond what was asked
- Never write comments narrating what the next 3 lines do
