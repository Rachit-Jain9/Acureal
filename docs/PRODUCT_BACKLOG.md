# Product backlog

The short list of things that would change what Acureal *is*, as opposed to how
well it runs. Engineering hygiene lives in `TODO_MANUAL.md`; operator actions
live in `TODO_OPERATOR.md`; this file is for product.

Kept deliberately short. A backlog nobody finishes is a backlog nobody reads —
if something has sat here unmoved for two quarters, close it rather than let it
rot into background noise.

_Last reviewed: 2026-08-04._

---

## 1. A reason to open Acureal on a Tuesday — the cross-deal home

**Status:** open · **Impact:** highest on this list

Everything in the product today is per-deal and episodic: open a deal, work it,
close the tab. There is no surface that answers *"what changed across my
pipeline since I last looked?"* — so there is no reason to open the app on a day
when you are not actively working one specific deal.

That matters commercially, not just aesthetically. A tool opened weekly gets
renewed; a tool opened per-deal gets forgotten between deals, and the renewal
conversation starts from zero.

What already exists and should be reused rather than rebuilt:

- **The per-deal version shipped 2026-08-01** — `deal_user_visits` records a
  per-user watermark, and `getChangesSince` computes eight deterministic
  per-slice deltas. Its index (`deal_user_visits_user_org_idx`) was built for
  portfolio surfaces that do not exist yet.
- **`AttentionPanel` + `attention.service`** already rank deals by five
  deterministic urgency signals, and the Deals list already carries a mirrored
  per-deal urgency chip.

So the missing piece is genuinely a **portfolio-level "since you last looked"**,
not a new engine. The honest scope is one query and one surface.

**Constraint:** there is a standing rule to check with the operator before
building any new dashboard surface — two widgets were built and then removed as
clutter. This one needs a shape agreed up front, not a speculative build.

---

## 2. Address-first parcel evidence — surfacing the moat

**Status:** ✅ shipped 2026-08-04 (#1086) · **Impact:** highest reach

Shipped as the public `/parcel` page: any BBMP street resolves — no login — to
its ward, gazette register, UAV zone, guidance band, and exact gazette-page
citation, with the landing hero's search handing off to it. It stops at
statutory zoning exactly as specified below, and the gap is the
zoning-certificate-upload conversion. Decision recorded in the PR: public,
rate-limited, row-capped — the moat is the assembly and the workflow, not one
street's row. The original scope, kept for the record:

The Bengaluru parcel evidence (18,743 cited streets, guidance values across four
SROs, UAV zones, statutory FAR rulebooks for four planning authorities) is
genuinely rare and assembled nowhere else. Today it is reachable only behind a
login, inside a deal.

An address- or coordinate-first page can honestly resolve: locality, ward,
planning district, UAV zone, BBMP rate card, and guidance value with its gazette
page citation — all from indexes that already exist.

**It must stop at statutory zoning.** Determining the zone from a point requires
point-in-polygon against a georeferenced RMP 2015, which exists only as a raster
image. Inferring it — including by showing the map to a vision model — would
fabricate a statutory fact and use an LLM for deterministic geometry. Both are
hard-rule violations, and boundary parcels are exactly where it would be wrong.

**Turn the gap into the conversion point:** prompt for the zoning certificate or
sanctioned plan. The `zoning_certificate` doctype and its extraction prompt
already exist and are explicitly instructed to extract stated facts only, so an
uploaded document resolves the zone through the normal review path — and that
upload is also how the deal enters the platform.

---

## 3. Remove the founder from the critical path

**Status:** open · **Impact:** highest for durability

Ranked by dependence removed per unit of effort:

1. ✅ **Migrations apply themselves** — shipped 2026-08-04 (#1085) as
   `backend/scripts/migration-apply.js`, exactly to the constraints below:
   operator-invoked, dry-run by default, one transaction per file, stop at
   first failure, ledger-recorded, idempotent re-runs. Proven end-to-end by
   rebuilding the preview branch database from the repo's own recipe before
   ever touching production. (Original scope: `migration-status.js` reconciles
   read-only and `run-sql.js` executes a single file — the applier between
   them was the missing piece; **not** auto-on-deploy, because automatic DDL
   on every deploy converts a bad migration into an automatic outage.)
2. **A second pair of hands.** The permission model exists but has never carried
   a real teammate.
3. **A restore drill someone else performs.** Recovery is documented, never
   rehearsed by anyone but the founder. A document is not a capability.
4. **Scheduled gazette ingestion with a review queue** — moves data curation
   from "the founder does it" to "the founder approves it".

---

## Declined

- **Comp freshness / verification timestamps** — declined 2026-08-02. Comps
  currently derive a freshness label from the row's edit time rather than an
  observation time. Recorded here so it is not re-proposed; see
  `decisions_permanently_skipped` in the memory index.
