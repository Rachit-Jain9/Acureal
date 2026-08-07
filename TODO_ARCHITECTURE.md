# TODO_ARCHITECTURE — Deferred, Multi-Sprint

Architectural initiatives that cross modules and cannot land in a single PR. These are intentionally deferred; each phase lists its own entry criteria so we don't start mid-flight.

## Status legend
- DEFERRED: Scoped but not started; waiting on entry criteria
- PLANNED: Sprint slotted; entry criteria met
- IN PROGRESS: Active work on an open branch
- LANDED: Merged to master

---

## 1. "One Brain" — Unified Deal Context

**Status: PHASE A LANDED + PHASE B substantially LANDED — verified 2026-06-09. Phases C–E DEFERRED.**

> **2026-06-09 reality check:** Phase A (read consolidation) is **built and live** —
> `useDealWorkspace(id)` returns one server-composed payload for the whole deal page,
> with a fast `useDealWorkspaceLite` twin for instant first paint, `usePrefetchDealWorkspace`
> on hover, a 5-min `WORKSPACE_STALE_TIME` matching the backend cache, and a server-side
> `deal_workspace_cache` table (migration `20260629`). Phase B (shared cache invalidation)
> is **substantially done** — every workspace-mutating hook invalidates `['deal-workspace', id]`,
> and `dealPostureQueries.js` drives the posture refresh. What REMAINS (Phases C–E): the
> `useDealContext()` provider refactor (components still call `useDealWorkspace` directly,
> not a context), reactive drag-a-slider what-if, and the Activity-tab event-log UI. The
> historical write-up below predates this and is kept for context only.

Today the four deal-scoped surfaces — Zoning, Financials, DD, Comps — operate as independent modules. Each mounts its own React-Query hooks, each recalculates on its own cadence, and none reacts to a change elsewhere. A user who bumps FSI on the Zoning panel sees stale IRR on the Financials tab until they manually re-run the model. A new comp does not push a new benchmark band into the Financials "Market" card. A DD title-defect flag does not surface on the IC summary as "underwriting paused."

**Intent:** one shared, reactive `DealContext` at the deal-page root. A write in any module is visible to the other three on the next paint.

### Why now isn't now

- Path B kernel consolidation is done, the legacy JS engine is retired
  (2026-04-22 — see `docs/CLEANUP_INVENTORY.md`), and the Python debt
  engine was retired pre-session. The only remaining gate is the
  editorial migration.
- Consolidation-polish branch is mid-flight; merging an architecture change now fights the editorial-design migration for review attention.

### Entry criteria (unblock the DEFERRED flag)

1. ~~Legacy `backend/src/engines/financial.engine.js` retired~~ ✅ **Done
   2026-04-22.** `kernel.service.js` is the sole path; `FIN_KERNEL_V2`
   flag removed.
2. ~~Python parity engine decision finalized~~ ✅ **Retired pre-session.**
   No `.py` files, no runtime references to `DEBT_ENGINE_PY_URL`; TS
   kernel is sole runtime.
3. `consolidation-polish` branch merged to master (editorial token migration complete).
4. Backend tests green on master for 5 consecutive days.

### Target architecture

```
DealPage (/dashboard/deals/:id)
  └─▶ <DealContextProvider dealId={id}>
        ├─▶ canonical deal snapshot
        ├─▶ derived buildability (zoning × land × class)
        ├─▶ live financial model (kernel overlay)
        ├─▶ comps benchmark (nearby × class × launch year)
        ├─▶ DD summary (counts by status × category)
        └─▶ mutation dispatcher (writes invalidate dependent slices)
          └─▶ children: Overview, Parcel, Financials, DD, Risk, Comps, Activity
```

One React-Query key per deal: `['deal-workspace', dealId]`. Backend returns a single grounded payload instead of 7 parallel module-scoped queries.

### Phase plan

- **Phase A — Read consolidation** (1 sprint)
  - New endpoint: `GET /api/deals/:id/workspace` returns all four domains in one grounded payload.
  - Read-only. No write-path changes. Frontend migrates tabs from N queries to 1 shared query with `select`.
  - Exit: all 4 tabs load from a single network round-trip; no UI behavior changes.

- **Phase B — Shared cache invalidation** (1 sprint)
  - Zoning writes (permissible FSI, premium FAR election) invalidate the financial model cache.
  - Comps writes (new verified transaction within 5 km) invalidate the benchmark card.
  - DD status transitions surface in the Financials confidence badge.
  - Exit: round-trip from a zoning edit to a refreshed IRR ≤ 1.5s (p95).

- **Phase C — DealContext Provider** (1 sprint)
  - Extract a `useDealContext()` hook. Components migrate from independent queries to context consumption.
  - No new functionality; refactor only. Code diff should be ≤ +300 lines, 80%+ hook re-use, zero dropped features.
  - Exit: lighthouse perf for deal page unchanged or better.

- **Phase D — Reactive what-if** (1 sprint)
  - Drag a zoning slider → financials quick-compute fires; deltas render without leaving the Zoning tab.
  - Drag a financial slider → IC narrative banner updates its decision copy.
  - Exit: slider-to-KPI round-trip ≤ 500ms (p95); no visual jitter on slow networks (QR throttled to Fast 3G).

- **Phase E — Event log** (1 sprint)
  - Every state change writes to `deal_events` (deal_id, actor, module, before, after, timestamp).
  - Visible under Activity tab as a grouped, filterable log.
  - Exit: every deal has a `deal_events` trail; replay tool can reconstruct workspace at any prior timestamp.

### Non-goals

- Not migrating to Redux / Zustand. React-Query + Context is the target — no new store library.
- Not replacing the backend kernel. This is a client-state + orchestration change.
- Not building live collaboration (web-socket cursor streams, CRDT). Phase F+, separate doc.
- Not introducing a BFF layer. The Express service already owns orchestration.

### Dependencies & risks

- RLS policies may need per-domain revisiting when the single `/workspace` endpoint assembles the payload.
- Frontend bundle risk: a single Provider importing 4 module trees — code-split by route, not by Provider.

### Out-of-band consideration

If "one brain" slips more than 2 sprints past its entry criteria, re-scope Phase A (read consolidation) as a standalone win — the latency improvement justifies it even without B–E.

Last reviewed: 2026-04-28.

---

## 2. Kernel sensitivity: a real re-run, or an honest refusal

**Status: DEFERRED — needs a product decision, not just code.**

`packages/financial-kernel/src/orchestration/orchestrator.ts:247` computes its
tornado by scaling the base KPI linearly against a hardcoded `const elasticity
= 0.5`. That number is invented. It is not derived from the model, and a chart
built on it is presented to the reader as kernel output — which is the
"never use a fabricated figure" rule in CLAUDE.md, sitting inside the one module
that exists to be deterministic.

**Why it was not simply deleted during the 2026-08-07 trust sweep.** It was put
to me as unreachable dead code. It is not: `tests/intelligence/pipeline-insights.test.ts:83`
sets `sensitivityVariables` and asserts the tornado sorts by swing, and the
output is consumed by `InvestorPackage` and `excelReport.tornadoSheet`. What is
true is narrower — **no production caller sets `sensitivityVariables`**, so no
user has ever seen this number. Deleting a tested kernel capability on a premise
that turned out to be false is not a change worth making silently.

**The decision to make.** One of:

- **Real re-run.** The honest version: re-run the model per sweep point instead
  of scaling a single KPI. Correct, and the only version whose output deserves
  the kernel's name. Costs N× compute per tornado, so it belongs behind the
  dedicated endpoint the current comment already gestures at ("Full re-run is
  available in a dedicated endpoint").
- **Refuse.** Return `sensitivity: null` when a real re-run is unavailable, and
  let the UI say so. Cheap, honest, and consistent with how the rest of the
  product handles "we cannot compute this yet".

What is NOT acceptable is the third option — keeping the approximation and
labelling it — because the tornado's whole purpose is to rank drivers, and a
uniform elasticity ranks them purely by the size of the input swing.

**Entry criteria:** a production surface actually wants a tornado. Until then
this is latent, and the note exists so the next person does not re-derive the
same investigation.

Last reviewed: 2026-08-07.

---

## How to use this file

- Add an entry here only for architecture that spans modules and cannot land in one PR.
- Short-horizon refactors belong in a PR description, not here.
- Each item must carry: entry criteria, phase plan with exits, non-goals, and a "last reviewed" date.
- When entry criteria are met, flip DEFERRED → PLANNED and assign the sprint.
- On merge, flip IN PROGRESS → LANDED and move the entry to `docs/architecture/history/<year>.md`.
