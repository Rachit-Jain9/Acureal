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

---

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

## AI routing
- **Gemini**: document classification, OCR extraction, Kannada/English understanding, field extraction
- **Claude**: cross-document reasoning, DD synthesis, risk narrative, IC-style analysis
- **Deterministic code only**: all financial math, KPI calculations, approval logic, scoring

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
