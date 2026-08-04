# Cross-deal home — "Since you last looked" (PROPOSED · awaiting operator sign-off)

_Status: design only, 2026-08-04. Nothing here is built. Product backlog §1._

## The shape, in one sentence

One new strip **inside the existing "What needs your attention" panel** — not a
new widget, not a new page — listing the deals that changed since *you* last
opened them, with exact per-slice counts, newest-signal first.

## What it displays

Up to five rows, each: **deal name + stage** · **chips** (the same eight-slice
vocabulary the per-deal "since you last looked" banner already uses — documents
added, extractions completed, risks added/updated, DD updates, approvals,
model updated, activities — same labels, same tones, so the home and the deal
page can never disagree) · **when you last opened it**. A header line totals it
("Since you last looked — 3 deals moved") with a right-aligned count of deals
never opened. Clicking a row opens the deal, which stamps the visit — opening
a deal IS what clears its row; the loop closes itself.

Empty state: one quiet line — "Nothing has moved since your last pass · N
deals quiet." No box, no chart.

## Where it lives, what it replaces

Inside `AttentionPanel` (dashboard position 3), as its first section, above
the four existing signal blocks. It replaces nothing and adds no dashboard
box — deliberately, because two portfolio widgets have already been built and
removed as clutter, and a reverted hero band established that a new top-level
surface is the wrong move. The panel today answers "what crossed an absolute
threshold?"; the strip answers the missing question, "what changed since *I*
last looked?" — per user, per deal.

## Why this shape over the alternatives

1. **A new dashboard widget** — repeats the removed-as-clutter mistake; another
   box competing with the KPI strip for position 1.
2. **A separate "changes" page** — a second place to check is worse for the
   habit loop than one strengthened panel; nothing links to it on a quiet day.
3. **A chronological cross-deal activity feed** — needs event-shaped data with
   even coverage across slices, scrolls unboundedly, and buries the answer;
   per-deal counts compress the same information into one glance and reuse
   predicates that already exist.

## What it reuses (all already shipped)

- `deal_user_visits` — the per-user watermark, rotated with the 30-minute
  session gap; its index `deal_user_visits_user_org_idx` was created for
  exactly this read and has no consumer yet.
- `getChangesSince`'s eight per-slice predicates — refactored to a shared
  definition so the per-deal banner and the portfolio rollup cannot drift.
- The `SinceLastVisit` chip vocabulary and tones.
- The existing `GET /dashboard/attention` fetch — the strip rides the same
  response as a new `since_you_looked` slice; no new endpoint, no new hook, no
  layout registration.

## Mechanics (deterministic, one round trip)

A single SQL statement joins the caller's watermarks (via the purpose-built
index) to per-slice counts with `> last_visited_at` predicates, grouped by
deal — portfolio-sized (tens of deals), no N+1. Ordering is deterministic:
risks-added first, then total change count, then oldest-visit first. Deals
never visited are excluded from rows (you never looked, so "since you looked"
is undefined) and surfaced only as the header count.

## Two design decisions folded in (flagging explicitly)

1. **Move the visit stamp from the Overview tab to the deal workspace shell**,
   so opening a deal on ANY tab (e.g. straight to Risk from this strip) counts
   as looking. Today only the Overview tab stamps. Same guardrail stays: never
   on hover/prefetch.
2. **Measure against `last_visited_at`** (not `previous_visited_at`) — at the
   portfolio level nothing stamps a new visit, so the last recorded look IS the
   baseline.

## Cost of a yes

One service function + one SQL statement, one strip component inside the
existing panel, the stamp relocation, tests. No migration (the table and index
exist). No new endpoint. Estimated as one focused PR.
