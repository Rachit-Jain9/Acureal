# REDIP Regulatory & Zoning Intelligence — Architecture

> **Status:** Architecture proposal (design-only). No migrations applied, no code shipped by this document.
> **Scope:** The regulatory / zoning / FAR / overlay intelligence subsystem that feeds the deal Zoning tab, the Financial Engine, and IC memos.
> **Stance:** Extend the existing `regulatory_data` schema and `parcel*` services. This is a **progressive refactor, not a rewrite**. Every primitive below either reuses or wraps something already in production.
> **Liability frame:** REDIP produces **regulatory intelligence for underwriting screening**. It never produces "instant zoning certainty," and it never narrates a statutory conclusion on the legal-four lanes (title chain, encumbrance, RERA status, statutory approval status).

---

## ⚠️ What we got wrong and corrected (read first)

This document is itself a correction of a wrong-premise that was seeded into REDIP's data. Two earlier drafts of this very document also introduced **fabricated statutory dates** — exactly the failure the hard rules forbid. Both classes of error are corrected here. The standard going forward: **no statutory date, status, or instrument is stated in this document or in any seeded row unless it traces to a source verdict or a primary citation.** Where the precise date is not in a verdict, we say "(verify gazette/notification date)" rather than invent one.

**The RMP 2015 / RMP 2031 correction.**

- The operator's working premise — that Bengaluru's outskirts (Whitefield, Bellandur, Jigani) follow **RMP 2031** while the core follows RMP 2015 — is **refuted**.
- **RMP 2031 was never notified.** It received only *provisional* approval (2017), which the Karnataka government **withdrew in July 2020** (the date the verdict supports). It governs nothing — it is shelved/dead. *(An earlier draft asserted "a final withdrawal of provisional approval on 20 June 2022." No verdict supports that date. It has been removed as a fabrication.)*
- **RMP 2015 is the only operative statutory master plan** for the entire BDA Local Planning Area (LPA) — core *and* outskirts. Whitefield and Bellandur/Varthur sit **inside the BDA LPA, governed by RMP 2015**, not a separate "outskirts" plan.
- RMP 2015 is being **actively amended** (Zonal Regulations amendment notified, expressly covering "Bengaluru and Greater Bengaluru"). You cannot amend a dead plan — this confirms RMP 2015 is live. *(Treat the amendment's exact gazette date as a field to verify on ingestion, not as an asserted constant in prose.)*
- A successor plan, **RMP 2041, is "in preparation"** under the Greater Bengaluru Authority. *(An earlier draft said "in procurement," implying a tender process the verdict does not support. Corrected to the verdict's wording: "in preparation.")* Until RMP 2041 is notified, RMP 2015 governs.

**The GBA (Greater Bengaluru Authority) correction.**

- The Greater Bengaluru Governance Act makes the **GBA the statutory "Planning Authority"** under the KTCP Act 1961, but it **did not abolish the BDA** — it repealed the BBMP Act. Plan-making is now *shared* across the GBA, the constitutional Bengaluru Metropolitan Planning Committee, a shrunken BDA, and BMICAPA.
- This transition is **ongoing and unsettled**. The engine must **verify the sanctioning authority per parcel at deal time**, never hardcode "BDA" or "GBA" as the answer.
- **Premium FAR / TDR** are real uplift levers under the KTCP Act, but *no verdict provides a gazette date.* *(An earlier draft asserted "gazetted 21 Feb 2025." Removed. Premium FAR is stored as "notified — verify gazette date" with the date as an ingested, citable field, never an asserted constant.)*

The rest of this document is built so that each of these facts is a **versioned, dated, citable row** — never a string baked into a function.

---

## 0. The single most important code-correction (Phase 0)

REDIP's seeded data and code carry the refuted RMP-2031 framing in load-bearing places. Phase 0 re-labels them. **This re-labelling is itself a "material change" under CLAUDE.md's audit mandate, so it must be captured in the regulatory-reference audit trail defined in §2.4 — not applied silently.**

| File / object | Current (wrong-premise) value | Required correction |
|---|---|---|
| `regulatory_data.far_rules.plan_version` | `DEFAULT 'RMP 2031 Draft'` (schema.sql:975) | New rows default `'RMP 2015'`; existing RMP-2031 rows re-tagged `withdrawn` or quarantined |
| `regulatory_data.far_rules.plan_status` | `DEFAULT 'draft_reference'` (schema.sql:976) | `'operative'` for RMP 2015; `'withdrawn'` for RMP 2031 |
| `regulatory_data.far_rules.review_status` | `DEFAULT 'approved'` (schema.sql:998) | **Re-sourced RMP-2015 rows must be inserted with `review_status='pending'` explicitly** — see the warning below |
| `backend/src/services/masterplanCorpus.js` | `RMP_2031_PLAN_VERSION = 'RMP 2031 Provisional'`, 12 entries all BDA/RMP-2031 | Add RMP 2015 corpus entries; mark RMP 2031 manifest entries `legal_status: 'withdrawn'` |
| `backend/src/utils/buildEnvelope.js` | setback/FAR `sources` block hardcodes "Volume 6 Table 1 (p.38)" / "Table 2 (p.39)" / "§§5-6" (lines 262-265); disclaimer string line 267 | Re-source from **RMP 2015 Zonal Regulations** (Tables 8/9 setbacks; Tables 10/12–17 FAR); update the parity test; **fix the disclaimer string (see §0.2)** |
| `backend/src/utils/parcelBuildability.js` `citeFarRule()` | `source_title: 'RMP 2031 Volume 6 Zoning Regulations'`, `status: 'draft_reference'` | Citation label driven by the rule's actual rulebook (via `rule_version_id`), not a hardcoded RMP-2031 string |

### 0.1 ⚠️ The auto-approve trap (must-fix)

`far_rules.review_status` **defaults to `'approved'`** (schema.sql:998) — unlike `master_plan_zones`, which defaults to `'pending'`. If Phase 0 (or any re-extraction) inserts re-sourced RMP-2015 FAR rows without an explicit `review_status`, they **auto-approve and bypass the human review gate** the entire architecture depends on. **The Phase 0 migration and every FAR-ingestion path must set `review_status='pending'` (quarantine) explicitly on re-sourced rows.** This is non-negotiable; the review gate is load-bearing for the no-fabrication rule.

### 0.2 ⚠️ The customer-facing AI string (must-fix)

`buildEnvelope.js:267` currently emits the literal string:

> `'AI-assisted preview — requires human review against the original Volume 6 tables before quoting in IC memos.'`

Two problems: (a) "Volume 6" is the RMP-2031 source — re-source to RMP 2015; (b) the phrase "AI-assisted" must **never reach a DOCX/PPTX/XLSX export surface**, per the 2026-05-19 AI-disclosure policy (no per-section AI banners; one quiet cover-page disclaimer only). Phase 0 must (1) re-source the string to RMP-2015 tables, and (2) confirm — by tracing every consumer of `calculateBuildEnvelope()`'s `disclaimer`/`sources` fields — that this string is operator-UI-only and is stripped before any export renderer. If it currently flows to an export, it is a policy breach and must be cut from that path in Phase 0.

### 0.3 What is settled vs fast-moving

The engine must encode *confidence in the law itself*, not just confidence in the extraction.

- **Settled (assert with high confidence + primary citation):** RMP 2015 is operative city-wide; RMP 2031 is withdrawn; Jigani/Anekal is governed by the **Anekal LPA Master Plan 2031** under the Anekal Planning Authority / BMRDA (a genuinely distinct 2031-horizon rulebook); the nine RMP-2015 land-use zone families exist; FAR rises in road-width bands but is **zone-specific** (§1.4).
- **Fast-moving (store with `instrument_ref` + `effective_from` + `measurement_ref` + `stay_note` + `last_verified_at`, never hardcode a number):**
  - **GBA transition** (see correction callout) — verify sanctioning authority per parcel.
  - **Lake / rajakaluve buffers.** The widely-cited "75 m / 50 / 25 / 15" set is refuted: the NGT-2016 75 m enlargement was **set aside by the Supreme Court (Mantri Techzone, 5 Mar 2019)** except two named sites. The current regime is (a) **size-based lake buffers** (KTCDA Amendment 2025) and (b) **reduced drain buffers** (UDD notification). These carry pending-challenge risk — store instrument + date + measurement reference (edge vs centre) + stay status.
  - **Premium FAR** (notified, road-width-gated; gazette date to be verified on ingestion) is a separate uplift lever; **metro TOD FAR is draft** and must NOT be treated as available.

---

## 1. Corrected domain model

The accurate mental model is a **resolution chain**, not a flat lookup. Every link is data, carries provenance, and can honestly say "unknown — manual input required."

```
 PARCEL (deal.property: address | lat/lng | survey_no | khata)
   │
   ▼  (1) which authority governs this point?
 PLANNING AUTHORITY            ── BDA / GBA(transition) / Anekal PA / BIAAPA / others on demand
   │  (+ KIADB override)        ── KIADB notified industrial area OVERRIDES the LPA
   │                              for building-plan sanction & OC (e.g. Bommasandra/Jigani)
   ▼  (2) which rulebook + version is operative for that authority, as-of the compute date?
 RULEBOOK @ VERSION           ── BDA → RMP 2015 (operative) [RMP 2031 = withdrawn]
   │                           ── Anekal PA → Anekal LPA Master Plan 2031 (operative)
   │                           ── BIAAPA → BIAAPA Master Plan 2021 (operative)
   ▼  (3) which use-zone is the parcel in?
 ZONE (R / C / I / P&SP / T&T / PU / P / UC / AG  + sub-codes)
   │     ↳ spatial (master_plan_zones.geom) when polygon exists,
   │       else MANUAL PICK (honest existing fallback)
   ▼  (4) which FAR/coverage/setback rule applies (zone × plot-size band × road-width band)?
 RULE  (far_rules row, keyed authority + rule_version + zone + driver bands)
   │
   ▼  (5) what overlays condition or cap the nominal entitlement?
 OVERLAYS  ── AAI height (NOCAS / defence) · lake buffer (size-based) ·
              rajakaluve buffer (class-based) · road-widening/CTP relinquishment ·
              fire 15 m/6 m · EC/KSPCB built-up thresholds · heritage · SDZ · NGT drainage
   │
   ▼
 NET BUILDABLE ENVELOPE  (nominal FAR → net-of-overlay buildable)  →  Financial Engine
```

### 1.1 Authorities (the layer REDIP is missing)

REDIP is currently **BBMP/BDA-centric with the authority test hardcoded**. In `parcelContext.service.js`, jurisdiction is decided by a `BBMP_BBOX` rectangle plus a hand-maintained `NON_BBMP_TALUKS` Set (`anekal`, `hosakote`, `nelamangala`, `magadi`, `kanakapura`, `devanahalli`, `doddaballapur`, `ramanagara`, `bidadi`). That Set is the **conceptual seed of the missing `planning_authorities` table** — it already enumerates the right authorities; it just lives in code as a deny-list instead of in data as a positive jurisdiction lookup. Its honest behaviour (it *skips* a BBMP lookup rather than guessing when a non-BBMP taluk is detected) is the template for the new pipeline.

### 1.2 The KIADB override (genuinely two-layer)

For the Jigani / Bommasandra / Attibele / Hosur-Road belt, a parcel can simultaneously be (a) inside the **Anekal LPA zoning map** *and* (b) inside a **notified KIADB industrial area**. When (b) is true, **KIADB/KSSIDC — not the LPA/panchayat/BBMP — is the building-plan & OC sanctioning authority** (Karnataka HC, Bommasandra line of cases; GoK notification 2024). The engine models this as an **override flag on top of** the LPA resolution, surfaced as a deterministic Flag card ("local-panchayat/BBMP approvals on KIADB land are legally void — route to KIADB").

### 1.3 Rulebook versioning (temporal law) — and how snapshots pin it

A `rulebook` (e.g. "BDA RMP 2015 Zonal Regulations") has ordered `rule_versions` (e.g. the 2026 Zonal Regulations amendment is a new version of the same rulebook). `far_rules`, `overlays`, and zones key to a `rule_version_id`, with `effective_from`/`effective_to`. This is what lets the platform answer **"what was the FAR on the date this deal was underwritten?"**

**The pinning rule (gap-fix).** Answering that question is only honest if the *resolved version is frozen into the snapshot at compute time*. Therefore every `parcel_intelligence_snapshots.output_json` citation must record the **immutable `rule_version_id` (and overlay version ids) that actually fired**, per FAR/overlay figure — not just the rulebook name. When a `rule_version.effective_to` is later closed off (because an amendment lands), historical snapshots are unaffected: they cite the version id that was current on their compute date. A snapshot is a frozen record of "the law as REDIP held it on date X," and the pinned `rule_version_id` is what makes that frozen record verifiable later. **A snapshot must never resolve its FAR by re-reading a possibly-mutated reference table; it reads its own pinned version ids.**

### 1.4 FAR is zone-specific, not a single ladder (verdict-corrected)

The claim "FAR rises in road-width bands" is **partially true**. The engine branches by zone first:

| RMP 2015 zone | FAR driver | Notes |
|---|---|---|
| Residential (Main), Table 10 | **plot-size × road-width matrix (2-D)** | 5 bands, *not* road width alone. Road < 9 m caps height (~Stilt+GF+2) regardless of FAR |
| Residential (Mixed), Table 12 | road-width ladder | rises across <12 / 12–18 / 18–24 / 24–30 / >30 m bands |
| Commercial (Business), Table 14 | road-width ladder | the textbook 6-band ladder incl. <9 m and 9–12 m |
| Commercial (Central), Table 13 | **flat FAR** | ignores road width (historic petta core) |
| Mutation Corridors, Table 15 | road-width (2 bands) | |
| Industrial (General), Table 16 | plot-size | |
| Industrial (Hi-Tech / IT-BT), Table 17 | plot-size × road-width matrix | |

*(Exact FAR figures intentionally omitted from this design doc — they are extracted from the primary RMP-2015 PDF into `far_rules` under the review gate, never typed into prose where they could become an unsourced constant.)*

The existing `far_rules` schema **already supports this** — it has both `plot_area_min/max_sqm` and `road_width_min/max_m` band columns, and `selectFarRule()` already filters on both. The schema is correct; only the *seeded data and provenance label* are wrong. **Premium FAR (notified) and TDR are separate overlays/levers**, never summed into the base FAR figure.

---

## 2. The core abstraction — the Regulatory Rulebook Engine

A deterministic, source-locked pipeline: **parcel → authority → rulebook@version → zone → rule → overlays → net envelope.** It extends `parcelContext.service.js` + `parcelIntelligence.service.js` + `far_rules` + `evidence_facts` — it does not replace them.

### 2.1 Data model (extend `regulatory_data`)

New tables (additive migration; PostGIS columns guarded by the same runtime extension check used at `schema.sql:1081-1118`).

```sql
-- 2.1.1  Authorities — promotes the hardcoded NON_BBMP_TALUKS set into data.
CREATE TABLE regulatory_data.planning_authorities (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID REFERENCES organizations(id) ON DELETE CASCADE,  -- NULL = global reference
  authority_code  TEXT NOT NULL,
  authority_name  TEXT NOT NULL,
  authority_kind  TEXT NOT NULL CHECK (authority_kind IN
                    ('lpa','umbrella','corridor','industrial_board','corporation')),
  parent_code     TEXT,
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','transitioning','superseded')),
  status_note     TEXT,
  -- geom geometry(MultiPolygon,4326)  (added under the PostGIS guard block)
  taluk_aliases   TEXT[],                     -- seeds from NON_BBMP_TALUKS for resolution
  confidence_score NUMERIC(4,3),
  review_status   TEXT NOT NULL DEFAULT 'pending'
                    CHECK (review_status IN ('pending','approved','rejected','needs_review')),
  effective_from  DATE, effective_to DATE,
  last_verified_at TIMESTAMPTZ,               -- CLAUDE.md: last-verified date for critical fields
  verified_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  next_review_due  DATE,                       -- drives the periodic re-verify prompt (§9)
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- 2.1.2  Rulebooks + ordered versions (temporal law).
CREATE TABLE regulatory_data.rulebooks (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID REFERENCES organizations(id) ON DELETE CASCADE,
  authority_id    UUID NOT NULL REFERENCES regulatory_data.planning_authorities(id) ON DELETE CASCADE,
  rulebook_code   TEXT NOT NULL,              -- 'RMP_2015','RMP_2031','ANEKAL_MP_2031','BIAAPA_MP_2021'
  rulebook_name   TEXT NOT NULL,
  horizon_year    INT,
  legal_status    TEXT NOT NULL CHECK (legal_status IN
                    ('operative','provisional','withdrawn','draft','superseded')),
  notified_go_ref TEXT,                        -- primary citation when available; else NULL
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (authority_id, rulebook_code)
);

CREATE TABLE regulatory_data.rule_versions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rulebook_id     UUID NOT NULL REFERENCES regulatory_data.rulebooks(id) ON DELETE CASCADE,
  version_label   TEXT NOT NULL,              -- 'base-2007','amendment-2026'
  amendment_ref   TEXT,                       -- gazette/notification ref; NULL until verified
  effective_from  DATE, effective_to DATE,    -- effective_to NULL = current; closing it does NOT
                                              -- mutate snapshots that already pinned this id
  evidence_source_id UUID REFERENCES regulatory_data.evidence_sources(id) ON DELETE SET NULL,
  last_verified_at TIMESTAMPTZ,
  verified_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  next_review_due  DATE,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- 2.1.3  Overlays — parameterized, version-dated, geometry-optional.
CREATE TABLE regulatory_data.overlays (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID REFERENCES organizations(id) ON DELETE CASCADE,
  overlay_kind    TEXT NOT NULL CHECK (overlay_kind IN
                    ('aai_height','lake_buffer','rajakaluve_buffer','road_widening',
                     'fire_setback','ec_kspcb_threshold','heritage','sdz','ngt_drainage',
                     'premium_far','tod_far')),
  overlay_name    TEXT NOT NULL,
  rule_params     JSONB NOT NULL,             -- e.g. size-based buffer slab table; AAI surface caps
  measurement_ref TEXT,                       -- 'edge' | 'centre' | 'amsl' — verdict-critical
  instrument_ref  TEXT,                       -- 'KTCDA Amendment 2025'; gazette ref or NULL
  legal_status    TEXT NOT NULL DEFAULT 'operative'
                    CHECK (legal_status IN ('operative','draft','stayed','superseded')),
  stay_note       TEXT,                        -- 'challenged; verify no court stay before reliance'
  evidence_source_id UUID REFERENCES regulatory_data.evidence_sources(id) ON DELETE SET NULL,
  -- geom geometry(Geometry,4326)  (added under PostGIS guard; uploaded GeoJSON overlays)
  effective_from  DATE, effective_to DATE,
  review_status   TEXT NOT NULL DEFAULT 'pending'
                    CHECK (review_status IN ('pending','approved','rejected','needs_review')),
  confidence_score NUMERIC(4,3),
  last_verified_at TIMESTAMPTZ,               -- fast-moving buffers MUST carry this
  verified_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  next_review_due  DATE,                       -- shorter cadence for buffers/GBA/premium-FAR
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

**Extend existing tables (add FK + staleness columns, never break existing reads):**

- `far_rules`: add `authority_id`, `rule_version_id`, and `last_verified_at` / `next_review_due`. Change new-row defaults `plan_version → 'RMP 2015'`, `plan_status → 'operative'`. **Re-sourced rows inserted with explicit `review_status='pending'` (§0.1).** Existing `selectFarRule()` lookups keep working because the filter keys (`land_use_family`, `plot_area_*`, `road_width_*`) are unchanged — we only *narrow* the candidate set by authority + version.
- `master_plan_zones`: add `authority_id`, `rule_version_id`, `zone_family` (one of 9 RMP-2015 families). Keep `geom` (already present, empty).
- `master_plan_documents` / `masterplanCorpus.js`: add RMP-2015 + Anekal + BIAAPA manifest entries; tag RMP-2031 entries `legal_status: 'withdrawn'`.

### 2.2 RLS posture (corrected) and platform-admin write gate

**The real posture, verified in schema.sql:** existing `regulatory_data` tables use `ENABLE ROW LEVEL SECURITY` (schema.sql:1120-1125), **not** `FORCE`. Only the core deal tables use `FORCE` (schema.sql:658-672). `master_plan_zones` has **no RLS or policy at all**. The earlier draft's "Enable FORCE RLS to match the regulatory_data posture" was self-contradictory and is corrected here.

Deliberate decision for the new reference tables:

- **Apply `FORCE ROW LEVEL SECURITY`** to `planning_authorities`, `rulebooks`, `rule_versions`, `overlays`. They carry org-override rows, and `FORCE` ensures even a table owner connection is RLS-checked — the safer posture for tables that mix global reference and per-tenant overrides.
- **Read policy** mirrors the existing `org_or_global` pattern: `USING (org_id IS NULL OR org_id = current_organization_id())`. Global reference rows (`org_id NULL`) are readable by every tenant; org overrides are private.

**⚠️ Platform-admin write gate (must-fix).** The existing `org_or_global` `WITH CHECK` (schema.sql:1129/1132/1135/1138) lets **any tenant insert/update `org_id NULL` rows** — i.e. any org editor could pollute the shared regulatory truth for all tenants. The new tables must NOT repeat this. Their `WITH CHECK` splits the two cases:

```sql
-- Org rows: any editor in that org. Global (org_id NULL) rows: platform-admin only.
WITH CHECK (
  (org_id = current_organization_id())            -- private override: normal org editor
  OR
  (org_id IS NULL AND is_platform_admin())        -- global reference: email-allowlist admin ONLY
)
```

`is_platform_admin()` resolves against the existing email-allowlist platform-admin mechanism. **Seeding or editing any global authority, rulebook, rule_version, or overlay is gated to platform-admin.** (The existing `far_rules` / `evidence_*` global-write hole is noted in `TODO_DATA.md` as a follow-up hardening item; this document does not silently inherit it for the new tables.)

### 2.3 The resolution pipeline (deterministic, server-side)

A new pure module `backend/src/services/regulatory/resolveRulebook.js`, called by `parcelContext.service.js` **before** the existing BBMP block, and by `parcelIntelligence.service.js` when composing the snapshot:

```
resolveJurisdiction(parcel, as_of_date) →
  step 1  resolveAuthority(coords | taluk):
            a. PostGIS ST_Within(point, planning_authorities.geom)  — when polygons exist
            b. fallback: taluk_aliases match (reuses today's NON_BBMP_TALUKS logic, now data-driven)
            c. fallback: BBMP_BBOX → BDA  (existing heuristic, kept as last resort)
            d. checkKiadbOverride(coords)  → industrial_board override flag
          → { authority, override?, method, confidence, reason }   [honest 'unknown' allowed]
  step 2  resolveRulebookVersion(authority, as_of_date):
            rulebook WHERE legal_status='operative' ; rule_version WHERE as_of in [from,to)
          → { rulebook, rule_version_id, legal_status_note }   (BDA→RMP 2015; never RMP 2031)
  step 3  resolveZone(parcel, rule_version_id):
            a. PostGIS ST_Within(point, master_plan_zones.geom WHERE rule_version=…) — when polygon exists
            b. else  { auto_derived:false, reason:'manual selection required' }  ← EXISTING honest fallback
  step 4  selectFarRule(rules scoped by authority_id+rule_version_id, {area,road,use})  ← EXISTING fn
  step 5  evaluateOverlays(point, rule_version_id):  deterministic Turf/PostGIS checks per uploaded geom;
            where no geom, return 'overlay applies city-wide — manual parcel check required'
  step 6  computeNetEnvelope:  nominal (computeBuildabilityFromRule) → subtract road-widening
            relinquishment BEFORE setbacks → apply overlay caps (AAI height, fire, buffer no-build)
```

**Every step degrades honestly.** If step 1 can't resolve an authority, the snapshot says "authority unresolved — confirm governing Planning Authority" rather than defaulting to BDA silently. **The resolved `rule_version_id` (and any overlay version ids) from steps 2/5 are written into the snapshot citation (§1.3) so the result is reproducible from the frozen record.**

### 2.4 Immutable audit trail for regulatory reference changes (gap-fix)

CLAUDE.md mandates an immutable audit trail for **every material change** — not only the kill-switch override. Re-tagging an RMP-2031 row as `withdrawn`, flipping `plan_status`, or editing a buffer slab after a court stay are all material. Therefore:

- An **append-only audit table** `regulatory_data.reference_audit_log` (`id, table_name, row_id, action, old_value JSONB, new_value JSONB, changed_by, org_id, changed_at`) records every INSERT/UPDATE/DELETE on `planning_authorities`, `rulebooks`, `rule_versions`, `overlays`, and the re-tagged `far_rules` rows.
- It is populated by an **AFTER trigger** on those tables (so it cannot be bypassed by a direct write), and is itself write-once (no UPDATE/DELETE policy).
- **Phase 0's RMP-2031 → withdrawn re-tagging is the first set of rows this table must capture.** The Phase 0 migration runs after the trigger exists, so the correction is auditable.

This is distinct from `deal_audit_log` (which covers per-deal changes and the kill-switch override, §6 idea 9). Reference-row history is platform-level and lives here.

### 2.5 What is reused vs new

| Concern | Reused (unchanged or wrapped) | New |
|---|---|---|
| FAR/setback math | `parcelBuildability.js` (`selectFarRule`, `computeBuildabilityFromRule`, `estimateSetbackImpact`), `effective_fsi()` PL/pgSQL, `buildEnvelope.js` | re-sourced to RMP-2015 tables; parity test + disclaimer string updated |
| Orchestration | `parcelIntelligence.service.js` `composeSnapshot()`, `parcelContext.service.js` | `resolveRulebook.js` inserted ahead of BBMP block |
| Provenance | `evidence_sources`, `evidence_facts`, `citeFarRule()`, snapshot `source_versions` | `rule_versions` adds temporal provenance; pinned `rule_version_id` per figure |
| Snapshots | `parcel_intelligence_snapshots` (hash-deduped, HMAC-signed) | `output_json` gains `authority`, `rulebook`, pinned `rule_version_id`/overlay ids, `net_envelope`, `fitness` blocks |
| Red flags | `parcelRedFlags.engine.js` (`runParcelRedFlags`) | new flag rules: KIADB override, overlay cap, withdrawn-rulebook guard |
| Review | 3-tier `pending/approved/rejected` gate; `ReviewQueuePanel.jsx` | authorities/rulebooks/overlays ride the same gate; FAR rows forced to `pending` (§0.1) |
| Audit | `deal_audit_log` (deal + kill-switch) | `reference_audit_log` (regulatory-row changes, §2.4) |

---

## 3. Evidence & confidence — the Regulatory Fitness Score

A **deterministic, weighted-evidence score** (not an AI score). It quantifies *"how much of this parcel's regulatory picture rests on verified evidence vs assumption vs gap"* — the same philosophy as the existing `ModelConfidencePanel` and the four-pillar `ConfidenceMeter`. It becomes a **fifth pillar on `ConfidenceMeter`**, not a new widget.

**Anti-proliferation note.** The Zoning tab must not show four overlapping "how sure are we" surfaces. The Fitness Score *folds into* `ConfidenceMeter` as one pillar; the Known/Assumed/Missing panel (§6 idea 5) is the *drill-down* behind it; `ModelConfidencePanel` stays scoped to financial inputs. No new standalone confidence widget ships.

### 3.1 Inputs and weights

Each dimension contributes a sub-score in `[0,1]`, derived deterministically from the scoring ladder already used by `karnatakaReraReadiness.service.js` (verified 1.0 / uploaded 0.75 / available 0.5 / pending 0.25 / missing 0.0):

| Dimension | Weight | 1.0 means | 0.0 means |
|---|---|---|---|
| Authority resolved | 0.15 | polygon `ST_Within` match, approved | unresolved / bbox-guess only |
| Rulebook + version current | 0.15 | operative rulebook, current version, as-of valid | withdrawn/expired/unknown rulebook |
| Zone assigned | 0.20 | spatial polygon match OR analyst-verified manual pick | no zone (manual fallback unactioned) |
| FAR rule matched | 0.15 | approved `far_rules` reference match | `no_matching_far_rule` |
| Road width basis | 0.10 | site-survey / authority road plan | OSM-inferred default (<0.4) |
| Overlays cleared | 0.15 | each applicable overlay has a **parcel-level geometric check** | overlay applies but unchecked |
| Guidance/area inputs | 0.10 | official IGR + user dimensions | fuzzy locality + square-plot estimate |

`fitness = Σ(weight_i × subscore_i)`, rounded, deterministic, recomputed in the snapshot. Weights live in a declarative constant (mirroring `reraRequirementCatalog.js`) so they are auditable and tunable without code changes.

**⚠️ Overlays-cleared cap (gap-fix).** Most overlays apply city-wide and have **no geometry** (§4–§5), so "cleared" would almost always rest on a manual analyst sign-off — which could silently inflate the score to Green even where buffer/AAI exposure is unverified. Therefore the **overlays-cleared sub-score is capped at 0.5 when clearance is sign-off-without-geometry**; the full 1.0 requires an actual parcel-level geometric check (or an explicit georeferenced no-overlap result). A parcel cannot reach Green on unverified buffer/AAI exposure.

### 3.2 Bands (Red / Amber / Green)

- **Green ≥ 0.75** — "Reference-grounded. Suitable for screening; verify legal-four separately before IC."
- **Amber 0.45–0.74** — "Mixed basis. Material inputs are inferred or unverified — see Known/Assumed/Missing panel."
- **Red < 0.45** — "Assumption-led. Do not rely for underwriting until gaps are closed."

These thresholds mirror the existing `ModelConfidencePanel` banding language (Well-grounded / Mixed basis / Assumption-led). **The fitness score is a data-quality meter, never a "this deal is approvable" verdict** — enforced in copy and in the AI boundary (§7).

### 3.3 Source drawer behind every number

Reuse `SourceExplorerDrawer.jsx` + `CitationChip`. Every fitness sub-score is click-expandable to show which evidence drove it (`ConfidenceMeter` already does click-to-expand per pillar). Every regulatory number keeps the existing `[p. X]` chip → drawer (authority, page, section, confidence, status, **last-verified date**). Missing fields render em-dash, never a guess.

---

## 4. Data sourcing plan

Verb per data type — **UPLOAD** (operator brings the file), **EXTRACT** (Gemini → review queue → commit), **FETCH** (live adapter), **MANUAL** (human step, blocker recorded).

| Data type | Verb | How (concrete) | Honesty tag |
|---|---|---|---|
| BDA RMP 2015 **Zonal Regulations** (FAR/setback/coverage tables) | UPLOAD → EXTRACT | Operator uploads the India Code RMP-2015 PDF; Gemini extracts Tables 8/9/10/12–17 per zone; analyst approves into `far_rules` (**inserted `pending`**, §0.1) keyed to the RMP-2015 `rule_version` | "operative, primary PDF" |
| BDA RMP 2015 **zone polygons** | MANUAL (georeference) | PDF-only scans (PD 101–322). No GIS layer exists. Georeference per planning district in QGIS → digitize priority PDs into `master_plan_zones.geom`. Until then: **existing manual zone-pick fallback** | "no polygon yet → manual pick" |
| Anekal LPA Master Plan 2031 Zonal Regulations | UPLOAD → EXTRACT | `anekal.tpa.gov.in` PDF (host intermittently down — operator pulls manually). Extract per zone → `far_rules` under ANEKAL authority | "operative, host-unreliable" |
| BIAAPA Master Plan **2021** | UPLOAD → EXTRACT | Note: **2021 horizon, not 2031** — correct any assumption | "operative 2021" |
| K-GIS parcel geometry + admin hierarchy | FETCH | Existing `kgis.adapter.js` (Geometric Polygon WKT, Survey Number, Admin Hierarchy). Ingest WKT → PostGIS | "representational, NOT legally valid — verify Bhoomi/SSLR" |
| Road width | FETCH (estimate) | Existing `osmRoadWidth.adapter.js`. Width frequently null in OSM | "OSM-inferred — verify on site; never auto-sets FAR" |
| IGR guidance value | UPLOAD → EXTRACT | Existing `igrPdf.adapter.js` (currently stubbed) — parse notification PDFs into versioned table. **Kaveri is CAPTCHA web-form, no API** — do not scrape | "guidance ≠ BBMP UAV; freshness-dated" |
| Overlay datasets (lake, drain, AAI, heritage, road-widening, CTP) | UPLOAD (GeoJSON) → geometric check | No public API. Operator uploads GeoJSON; PostGIS/Turf intersection. AAI also needs site **AMSL** input | "manual overlay; verify live — buffers fast-moving; carries last-verified date" |
| Bhoomi RTC / e-Khata (e-Aasthi) / EC | MANUAL (upload + extract) | Portal/PDF only, no API. Upload → Gemini extract → **legal-four Flag card only** | "extraction aid, human-verify" |
| K-RERA registration status | MANUAL (upload cert) | No official API; CAPTCHA portal. Manual lookup + certificate upload | "legal-four — never AI-narrated 'RERA-compliant'" |

**No live statutory monitoring exists.** There is no gazette / BDA / GBA / RERA API. A new amendment becomes known to REDIP **only when an operator uploads it.** This limitation is recorded in `TODO_DATA.md` and shapes the What-Changed feature copy (§6 idea 7).

### 4.1 Minimum viable corpus (seed first — narrow, not broad)

To make the engine *correct before broad*, seed **only the authorities with live deal flow** and add others on demand. Seeding eleven authorities with no geometry (most of which would never see a deal) creates stale reference rows REDIP cannot yet resolve to a parcel — so the MVP is deliberately smaller than the full authority list in §1:

1. **`planning_authorities`** rows for **BDA, GBA (transitioning), and Anekal PA** only — seeded from the relevant `NON_BBMP_TALUKS` aliases. No geometry yet; taluk-alias resolution is the MVP path. **Other authorities (BIAAPA, Hoskote, Nelamangala, Magadi, Kanakapura, Doddaballapura, Ramanagara, Bidadi) are added when a real deal lands in their jurisdiction**, not pre-seeded.
2. **`rulebooks` + `rule_versions`:** BDA→RMP 2015 (operative, base + amendment); BDA→RMP 2031 (**withdrawn**, for honest re-labelling of legacy rows); Anekal PA→Anekal MP 2031. (BIAAPA MP 2021 added with its authority on demand.)
3. **RMP 2015 `far_rules`** for the high-traffic zones (Residential Main, Residential Mixed, Commercial Business) — extracted, inserted `pending`, analyst-approved.
4. **Overlays** as parameterized rows (no geometry): size-based lake buffer slab, drain buffers, Premium FAR ladder, AAI surface caps — each with instrument + effective date + measurement-ref + stay note + last-verified date.
5. **Georeferenced zone polygons** for the 5–8 deal-hottest planning districts — Phase 3.

### 4.2 Ingestion pipeline (already exists)

Upload → `masterplanCorpus.applyCorpusDefaults()` classification → `masterplan.service.queueExtractionJob()` → Gemini extraction → `evidenceIngestion.ingestRegulatoryFields()` → `evidence_sources` + `evidence_facts` + `far_rules` (**forced `pending`**, §0.1) → **`ReviewQueuePanel.jsx`** human approval (high/med/low buckets) → committed reference. The new tables plug into the **same** review gate. No new ingestion infrastructure.

---

## 5. Map layer

**Recommendation: PostGIS now; MapLibre GL JS only if/when it earns it (deferred, justified separately).**

- **PostGIS** is already half-wired: `properties.geom` (Point, auto-synced by `trg_properties_sync_geom`), `master_plan_zones.geom` (MultiPolygon, **empty**), GIST indexes, all under the runtime extension guard (`schema.sql:1081-1118`). Spatial logic stays in the DB (`ST_Within`, `ST_Intersects`, `ST_Area`, `ST_Distance`) — deterministic, Vercel-serverless-safe. New `planning_authorities.geom` and `overlays.geom` follow the identical guarded-`ALTER` pattern. SRID 4326 throughout.
- **The map *surface* upgrade is deliberately deferred and de-scoped.** The frontend currently runs Leaflet (`ReadOnlyPropertyMap.jsx`). The honest regulatory value — opacity-adjustable georeferenced raster + the manual-pick floor — is deliverable **on the existing Leaflet surface**. A full MapLibre GL JS migration is a net-new dependency and a rewrite of the map surface for relatively little *regulatory-correctness* payoff; it is the single heaviest lift in the plan. **It is NOT bundled here as a small extension of Leaflet.** If vector-tile overlays at scale later justify it, MapLibre is proposed in its own scoped change with its own justification — not as part of this regulatory architecture.

### 5.1 The scanned-PDF reality (honest progressive coverage)

Official zone polygons **do not exist as GIS** — they are scanned per-PD PDFs. Two phases, no shortcut:

- **Phase A (visual, fast):** serve georeferenced RMP-2015 scans as an **opacity-adjustable raster overlay** on the existing map. A human reads the zone off the map and confirms the manual pick. Coverage = "raster overlay available for PD X."
- **Phase B (queryable):** hand-digitize priority PDs into `master_plan_zones.geom` for automated `ST_Within` zone-at-point. Coverage grows one PD at a time.

**The existing fallback is the floor, not a failure:** when no polygon covers a point, `parcelContext.service.js` returns `masterPlanZone { auto_derived: false, reason: 'Master-plan zone polygons not yet imported. Use the Zone Lookup picker…' }` and the frontend renders the manual picker. The map layer **never fabricates a zone boundary**; K-GIS cadastral geometry stays tagged "representational, not deed-quality."

---

## 6. Interaction design — ChatGPT ideas mapped

Each idea classified **EXTEND** (build on an existing primitive) or **NET-NEW**, with hard-rule flags.

| Idea | Verdict | How |
|---|---|---|
| **1. Regulatory Fitness Score** | EXTEND | Fifth pillar on `ConfidenceMeter` (§3). Deterministic weighted-evidence; R/A/G bands; overlays-cleared capped at 0.5 without geometry. **Reframe:** data-quality meter, NOT an approvability verdict |
| **2. Map-first UI** | EXTEND | Sidebar (zone/FAR/guidance/overlays) updates on parcel pin on the **existing Leaflet surface** + raster overlay. Keep manual-pick fallback. (MapLibre is a separate, deferred proposal — §5) |
| **3. Zoning Detective / reasoning trail** | NET-NEW (safe, with guard) | Render the deterministic resolution chain (§2.3) as a visible step list. **It is a trace of deterministic steps, not AI narration.** ⚠️ **Each node MUST be labelled cited-source-with-confidence, never a bare assertion** — e.g. "Zone: Residential Main *(as cited, RMP-2015 PD-315 map, confidence 0.8 — verify)*", never "Zone: Residential Main." A bare authority/rulebook/zone conclusion would assert a statutory fact as truth, which §7.2 forbids |
| **4. Assumption sliders (FAR / road-width / use)** | EXTEND | Generalize `BuildabilityLab` / `DecisionStrip`. Sliders feed the deterministic kernel; results labelled "screening assumption, not assigned." **Never persist a slider value as a verified fact** |
| **5. Known / Assumed / Missing / Risky panel** | EXTEND | Re-skin existing `Evidence Buckets` into a 4-state classifier; it is the drill-down behind the Fitness pillar (§3 anti-proliferation). Drives the fitness "missing" inputs |
| **6. Approval Path Builder** | EXTEND | Compose from `SignoffsSection` + `karnatakaReraReadiness` + overlay NOC list (AAI/fire/EC/KIADB). **Reframe:** "documents/NOCs typically required" checklist, NOT "approval will be granted" |
| **7. What-Changed alerts** | EXTEND **with honesty guard** | `rule_versions` + snapshot diffing. ⚠️ **Framed strictly as "fires when REDIP ingests a newer version," NOT live statutory monitoring.** Banner copy: *"REDIP ingested a newer Zonal-Regs version (uploaded {date}) — setback basis changed; re-run. (REDIP does not monitor the gazette live; this reflects what we have loaded.)"* Limitation recorded in `TODO_DATA.md` |
| **8. Source drawer** | EXTEND | `SourceExplorerDrawer` already exists; wire to every new authority/rulebook/overlay number, including last-verified date |
| **9. Regulatory Kill Switches** | EXTEND **with hard-rule guard** | Analyst "exclude this input / I trust it less" override. **Allowed on financial/market/FAR-quality inputs.** **FORBIDDEN as a verdict — AI or manual — on the legal-four:** title/encumbrance/RERA/approval-status cards can only change state via a deterministic Flag transition, never a "clear/approve" toggle (no analyst manual "clear" either). ⚠️ **Every override — AI-suggested or manual — writes to `deal_audit_log`, absolutely, including manual ones** |
| **10. Role views** | EXTEND | Existing `EDITOR_ROLES` / `canEdit` gate. Analyst → fitness deep-dive; underwriter → IC-readiness; reviewer → approval queue |
| **11. Compare scenarios** | EXTEND | `BuildabilityLab` 3-scenario compare already exists; add "as-of version" and overlay-applied toggles |
| **12. Regulatory → Feasibility coupling** | EXTEND | Already wired: snapshot `buildable_area_sqft`/FAR → `financial.service.calculateAndSave()` → kernel. Send the **net-of-overlay** envelope to the model; keep base FAR, Premium FAR, TDR as **separate labelled inputs**, never summed |

---

## 7. AI boundary

The deterministic kernel owns all numbers, rule selection, scoring, and resolution. AI is confined to **interpretive prose grounded in kernel signals + cited evidence.**

### 7.1 Allowed

- **Source-locked retrieval-grounded Q&A** ("What does the rulebook say about FAR on a 15 m road for Residential Mixed?") — answers **only** from approved `evidence_facts` / extracted rulebook text, with mandatory citations. If the fact isn't in the corpus → "Not found in the loaded sources" (no world-knowledge fill-in).
- **Narrative synthesis** of financial / market / structural / FAR-feasibility / capital-stack / exit implications, using the **closed verb dictionary** (`Recommend / Consider / Re-examine / Flag / Stress-test`; `Diverges / Lacks support / Inconsistent / Below benchmark / Above benchmark / Missing`). Routed through `icMemo.service.js` / `recommendation/dealDoctor.js`, which already enforce verbs and the legal carve-out.

### 7.2 Forbidden

- **Any conclusion on the legal-four** (title chain, encumbrance, RERA registration status, statutory approval status). These stay deterministic Flag cards backed by extracted facts + human-verify prompts. `dealDoctor.js` already filters these to `legal_carve_out`.
- **Asserting a statutory fact as truth** ("zoning is X," "RERA-compliant," "approval will be granted," "buffer is 30 m"). The engine reports *what the cited rulebook/overlay says* with provenance and "verify live," never a flat assertion. **This binds the Zoning Detective trail (§6 idea 3): every node is cited-source-with-confidence, not a bare assertion.**
- **Any math, FAR computation, rule selection, fitness scoring, geometric check.** Deterministic code only.

### 7.3 The source-locked assistant contract

```
input  : { question, deal_id, snapshot_id }
context: ONLY approved evidence_facts + extracted rulebook chunks for this parcel's
         resolved authority + rulebook + pinned rule_version (no external knowledge)
output : { answer, citations[≥1], confidence, abstained:boolean }
guards : - every sentence traces to a citation or the assistant abstains
         - legal-four topics → return deterministic Flag card, never prose conclusion
         - absolute verbs (approve/clear/buy/reject) rejected at schema level
         - on empty/low-confidence retrieval → abstain ("not in loaded sources")
```

---

## 8. Phased roadmap

**Phase 0 — Truth correction (data hygiene, no new features).**
Ship: create `reference_audit_log` + trigger (§2.4) **first**; then re-label legacy RMP-2031 `far_rules` as withdrawn-or-quarantined (captured by the audit trail); flip new-row defaults to RMP 2015 / operative; correct `masterplanCorpus.js`, `citeFarRule()`, and `buildEnvelope.js` provenance to RMP 2015; **fix the `buildEnvelope.js:267` "AI-assisted / Volume 6" string (§0.2) and confirm it never reaches an export**; add an `RmpStatusBanner` stating "RMP 2015 operative; RMP 2031 withdrawn." Unlocks: every downstream number stops lying about its legal basis. Stays manual: re-extraction of actual RMP-2015 tables.

**Phase 1 — Authority + rulebook spine (MVP, narrow).**
Ship: `planning_authorities`, `rulebooks`, `rule_versions` tables with **FORCE RLS + platform-admin global-write gate (§2.2)** and last-verified columns; seed **BDA + GBA + Anekal only** (§4.1); `resolveRulebook.js` with **taluk-alias + bbox** resolution (no polygons yet); snapshot `output_json` gains `authority`/`rulebook`/**pinned `rule_version_id`** blocks; KIADB override Flag card. Unlocks: a Jigani parcel correctly resolves to Anekal PA / Anekal MP 2031, not BDA. Stays manual: zone polygons, FAR table extraction.

**Phase 2 — Fitness score + RMP 2015 FAR corpus.**
Ship: deterministic Regulatory Fitness Score as 5th `ConfidenceMeter` pillar (overlays-cleared capped without geometry, §3.1); RMP-2015 `far_rules` for top zones extracted + approved (inserted `pending`) via existing review queue; Known/Assumed/Missing/Risky panel. Unlocks: honest R/A/G readout; correct FAR for common zones. Stays manual: overlays, polygons.

**Phase 3 — Overlays + raster map.**
Ship: `overlays` table + GeoJSON upload + PostGIS/Turf parcel checks (lake/drain size-based, AAI height w/ AMSL input, road-widening relinquishment-before-setback, fire/EC thresholds); **opacity-adjustable georeferenced zone rasters on the existing Leaflet surface**; net-of-overlay envelope into the Financial Engine; per-overlay last-verified + next-review prompts. Unlocks: "nominal vs net buildable"; deal-killer overlay flags. Stays manual: georeferenced scans per PD, live buffer re-verification. *(MapLibre migration explicitly out of scope — separate proposal if justified.)*

**Phase 4 — Source-locked assistant + What-Changed + digitized polygons.**
Ship: retrieval-grounded Q&A (§7.3); snapshot-diff What-Changed alerts (ingest-framed copy, §6 idea 7); `ST_Within` zone auto-derive for digitized priority PDs; Zoning Detective reasoning trail (cited-node guard, §6 idea 3); Approval Path Builder. Unlocks: ask-the-rulebook, automated zone assignment in covered districts. Stays manual: K-RERA/Bhoomi/Kaveri (no API), undigitized PDs.

---

## 9. Risks & anti-goals

**Do NOT build:**
- A "zoning certainty" / "instant approvability" product. REDIP is **regulatory intelligence for underwriting screening**; the legal-four stay human-verified.
- Live connectivity to Bhoomi / Kaveri / K-RERA / BDA / GBA / AAI where no lawful stable API exists. Build adapters + manual upload lanes; record blockers in `TODO_DATA.md` / `TODO_LEGAL.md`. Do not scrape CAPTCHA/login portals. **What-Changed alerts must never imply live statutory monitoring** (§6 idea 7).
- AI-narrated legal conclusions, or AI in any math/scoring path.
- A single hardcoded buffer/FAR/authority number, or **any statutory date asserted without a verdict/primary source** (the failure this document's correction callout exists to prevent). Every fast-moving fact carries instrument + effective date + measurement-ref + stay status + **last-verified date** + "verify live."
- Summing base FAR + Premium FAR + TDR into one undifferentiated figure.
- A second top-level "Zoning" navigation entity — this lives inside the deal Zoning tab (deal is the master object).
- A MapLibre migration bundled into this work (§5) — defer and justify separately.
- A fourth overlapping confidence widget on the Zoning tab (§3 anti-proliferation).

**Liability framing (surface in-product + in exports):**
- Zone, FAR, and overlay outputs are **reference/screening aids from cited sources**, "approximate until parcel geometry is verified."
- K-GIS geometry is "representational, not legally valid."
- RMP-2015 status banner site-wide; RMP-2031 explicitly "withdrawn — not operative."
- GBA/BDA sanctioning authority is "in transition — verify per parcel at deal time."
- DOCX/PPTX/XLSX exports keep the single quiet cover-page disclaimer (per the 2026-05-19 AI-disclosure policy); **no per-section AI banners** (and the `buildEnvelope` "AI-assisted" string must not leak into them, §0.2).

**Staleness / re-verify (now backed by columns).** `planning_authorities`, `rule_versions`, `overlays`, and `far_rules` all carry `last_verified_at` + `next_review_due`. A periodic prompt surfaces rows past `next_review_due` (shorter cadence for buffers / GBA-transition / Premium-FAR). Without these columns the staleness story would be aspirational; with them it is enforceable.

**Audit (now backed by a table).** `reference_audit_log` (§2.4) + AFTER triggers make every regulatory reference-row change immutable and attributable — including the Phase 0 RMP-2031 re-tagging. `deal_audit_log` separately covers per-deal changes and the kill-switch override (manual or AI), absolutely.

**Key technical risks:** (a) georeferencing accuracy of scanned PDFs — mitigate with conservative confidence + raster-first; (b) authority polygon gaps — mitigate with taluk-alias fallback + honest "unresolved" state; (c) OneDrive `.git` hazard — commit/push fast, stage explicitly; (d) overlay legal currency drift — mitigate with `last_verified_at` / `next_review_due` + `stay_note` and the periodic re-verify prompt.

---

### Appendix — anchor files (all paths absolute to repo root)

- Schema: `database/schema.sql` (`regulatory_data` ~813–1144; `far_rules` 969–1003 incl. `plan_version` DEFAULT 'RMP 2031 Draft' :975, `plan_status` :976, `review_status` DEFAULT 'approved' :998; `effective_fsi()` ~887–910; PostGIS guard 1081–1118; regulatory RLS **ENABLE** 1120–1125; core-table **FORCE** 658–672; `org_or_global` policies 1127–1144)
- Resolution seam: `backend/src/services/parcelContext.service.js` (`NON_BBMP_TALUKS`; `detectBbmpJurisdiction`)
- Orchestrator: `backend/src/services/parcelIntelligence.service.js`
- Deterministic FAR/setback kernel: `backend/src/utils/parcelBuildability.js` (`citeFarRule`), `backend/src/utils/buildEnvelope.js` (`sources` block 262–265; "AI-assisted / Volume 6" disclaimer :267), `backend/src/engines/parcelRedFlags.engine.js`
- Corpus manifest: `backend/src/services/masterplanCorpus.js`
- Review/ingestion: `backend/src/services/masterplan.service.js`, `backend/src/services/evidenceIngestion.service.js`, `frontend/src/components/masterplan/ReviewQueuePanel.jsx`
- Frontend Zoning tab: `frontend/src/components/deal/ZoningTab.jsx` → `ParcelIntelligencePanel.jsx` (`ConfidenceMeter`, `VerdictBanner`, evidence buckets), `MasterPlanZonePanel.jsx`, `maps/ReadOnlyPropertyMap.jsx`, `deal/SourceExplorerDrawer.jsx`
- Legal-carve-out / verbs: `backend/src/services/recommendation/dealDoctor.js`, `backend/src/services/icMemo.service.js`, `backend/src/utils/icStanceVerbs.js`
- RERA precedent (catalog pattern to mirror for fitness weights): `backend/src/constants/reraRequirementCatalog.js`, `backend/src/services/karnatakaReraReadiness.service.js`
- Audit precedent: `deal_audit_log` (existing per-deal trail)
- Blockers to update: `TODO_DATA.md` (no live gazette/BDA/RERA API; What-Changed = ingest-only; global-write hardening for legacy `far_rules`/`evidence_*`), `TODO_LEGAL.md`, `TODO_MANUAL.md`
