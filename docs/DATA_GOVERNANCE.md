# REDIP Data Governance — The Five-Layer Data Model

**Status date:** 2026-05-20
**Audience:** REDIP engineering; security / privacy reviewers
**Owner:** REDIP engineering
**Maintained in:** version control — see the git history of this file

## 1. Why this document exists

REDIP holds three very different kinds of data in one PostgreSQL database: a
tenant's raw confidential deal material, REDIP's own analysis of it, and
operational telemetry. Treating them all as "the database" is how cross-tenant
leaks happen — and it is also why a "market benchmark built from everyone's
deals" feature is dangerous if built without a model.

This document defines a **five-layer data model**. Every table belongs to exactly
one layer (or to one of two cross-cutting categories). The layer fixes one thing
above all: **whether the data may ever cross a tenant boundary, and under what
gate.** It is the architectural spine of the planned anonymized-benchmark feature
and the companion to the Record of Processing Activities (`docs/legal/ropa.md`),
which maps the same tables to *processing purposes*.

It is an internal architecture document. The customer-facing summary of data
handling is `docs/SECURITY.md`.

## 2. The five layers at a glance

Data is **created at Layer 1 and flows downward**. Each layer is derived from the
one above it. Layers 1–3 are strictly tenant-private. Layer 4 is the **only**
layer whose data is built across tenants — and only behind a consent gate. Layer
5 is operational exhaust.

| Layer | Name | Contains | Crosses tenant boundary? |
|---|---|---|---|
| 1 | Raw Tenant Vault | Documents and raw fields exactly as the tenant supplied them | **Never** |
| 2 | Structured Extraction | Machine-readable data extracted from Layer 1 | **Never** |
| 3 | Derived Private Intelligence | REDIP's analysis, models, and audit trail for one tenant | **Never** |
| 4 | Anonymized Benchmark | De-identified, aggregated facts contributed by many tenants | **Only this layer**, and only with consent |
| 5 | Telemetry & Operations | Cost, performance, security, and routing exhaust | Pseudonymous; no deal content |

Two **cross-cutting categories** sit outside the deal-data layers: the *Identity &
Governance control plane*, and externally-sourced *Reference data*. They are
defined in §5.

## 3. The layers in detail

### Layer 1 — Raw Tenant Vault

**Definition.** The unprocessed material a tenant uploads or types in: the deal
documents themselves (sale deeds, agreements, encumbrance certificates, RERA
filings, financials) and the raw fields entered during sourcing.

**Sensitivity:** highest. May contain third-party PII, government identity numbers
(PAN, Aadhaar), ownership details, and unredacted commercial terms.

**Who can see it:** only members of the owning organization. Enforced by
PostgreSQL Row-Level Security on `organization_id`, not by application code alone.

**Tables / stores:** uploaded files in private storage buckets (Supabase
Storage / Vercel Blob, signed-URL access only); `documents` (file metadata);
`deals`, `properties`, `parcels` (raw deal and site fields).

**Boundary rule:** never leaves the tenant boundary, with one controlled
exception — document *content* is sent to an AI provider for extraction (Layer 2)
on the tenant's instruction, **after** deterministic redaction of recognisable
identity/secret patterns. See `docs/SECURITY.md` §11.

### Layer 2 — Structured Extraction

**Definition.** Machine-readable data pulled out of Layer 1: fields extracted
from documents, classifications, translations, and vector embeddings used for
semantic search.

**Sensitivity:** high. It is a structured projection of Layer 1 and inherits its
confidentiality.

**Who can see it:** owning organization only (RLS on `organization_id`).

**Tables:** `document_extractions`, `document_embeddings`, `evidence_links`
(extracted facts linked back to their source page).

**Boundary rule:** never crosses tenants. Embeddings in particular are treated as
sensitive — a vector is a lossy but real projection of the source text.

### Layer 3 — Derived Private Intelligence

**Definition.** REDIP's own computed and synthesised output **for a single
tenant**: financial models, the due-diligence and approvals workflow, risk
assessment, generated narratives, and the immutable audit trail. This is the
platform's value-add layer — REDIP's analysis of the tenant's own data.

**Sensitivity:** high. Knowing REDIP's risk scoring or underwriting of a deal is
as commercially sensitive as the deal itself.

**Who can see it:** owning organization only; deal-level sharing is explicit and
per-user (`deal_shares`).

**Tables:** `financial_scenarios`, `waterfall_distributions`, `dd_items`,
`approval_items`, `risk_flags`, `activities`, `intelligence_briefs`,
`investor_package_snapshots`, `deal_qa_history`, `market_notes`,
`deal_shares`; and the audit trails `deal_events` (HMAC-signed financial
computations) and `deal_audit_log` (lifecycle mutations).

**Boundary rule:** never crosses tenants. The audit trails are additionally
append-only — no UPDATE or DELETE RLS policy.

### Layer 4 — Anonymized Benchmark

**Definition.** The **only** cross-tenant layer: de-identified, aggregated deal
facts contributed by many tenants so that REDIP can show "how does this deal
compare to the market" using REDIP's *own* deal flow rather than only external
feeds.

**Status: the consent gate is built; the statistics are deferred.** Both halves
of the gate now exist — the per-user `anonymized_benchmarking` consent
(`user_consents`, 20260607) and the org-level opt-out (`organization_consents`,
20260612), combined deterministically by `benchmarkEligibility.service.js`. No
Layer-4 *aggregate* tables exist yet: the k-anonymity statistics wait for a real
consumer and enough contributing organisations (plan C4).

**The gate — both conditions must hold for a deal to contribute a Layer-4 row:**

1. The contributing user holds a current granted `anonymized_benchmarking`
   consent in the `user_consents` ledger (DPDP §6 specific consent).
2. The owning organization has **not** set the org-level "do not benchmark"
   switch (Phase 3.2), enforced server-side.

**Anonymization is not optional decoration — it is the layer's definition.** When
the statistics engine is built (deliberately deferred — Phase 3.3) it must apply
k-anonymity style protection: a minimum contributing-organization count per
bucket, no single organization dominating a bucket, and value-bucketing rather
than raw figures. Until a real benchmark query exists, only the data model and
the consent gate are built — the math is not gold-plated ahead of a consumer.

**Boundary rule:** this layer crosses tenants *by design* — which is exactly why
the gate and the anonymization are mandatory, not best-effort.

### Layer 5 — Telemetry & Operations

**Definition.** Operational exhaust: how the system performed, what it cost, what
it routed, and what security events occurred. Not deal content.

**Sensitivity:** low-to-moderate. Rows may carry a user or organization
identifier, but no deal documents or financial figures.

**Who can see it:** operators (admin tooling). RLS read-scoping where the row is
org-attributable; platform-wide rows (e.g. a dependency CVE) are operator-only.

**Tables:** `ai_call_logs`, `ai_response_cache`, `ai_artifacts`,
`ai_routing_config`, `monitoring_logs`, `export_events`, `ab_eval_runs`,
`ab_eval_results`, `feature_flag_cohorts`.

**Boundary rule:** stays operator-side. Aggregate operational metrics may inform
product decisions, but individual rows are never exposed cross-tenant.

## 4. The governance invariants

These four rules are what the layer model exists to enforce. They are the
statements a reviewer should be able to test.

1. **Data flows down, never up.** Layer *n* is derived from Layer *n−1*. A bug
   that writes Layer-1 raw content into a Layer-4 row is a P0 incident.
2. **Layers 1–3 never cross the tenant boundary.** Every table in these layers
   carries `organization_id` and is protected by Row-Level Security. The only
   egress is the redacted AI-extraction call described at Layer 1.
3. **Layer 4 is the sole cross-tenant layer, and it is gated.** No row enters
   Layer 4 without *both* the per-user `anonymized_benchmarking` consent and the
   absence of the org-level opt-out. The gate is enforced server-side.
4. **Withdrawal is retroactive.** When a user withdraws `anonymized_benchmarking`
   consent, or an organization sets the opt-out, that organization's future
   contributions stop and its existing Layer-4 eligibility is revoked. Because
   Layer 4 stores only de-identified aggregates, this is an eligibility change,
   not an erasure problem.

## 5. Cross-cutting categories

Two groups of tables are not deal-derived data and so sit outside the five
layers. They are still mapped here so that *every* table has a home.

### 5a. Identity & Governance control plane

The tables that decide *who may do what* and *what was agreed*. They are not deal
data; they are the control plane around it.

**Tables:** `users`, `organizations`, `organization_members`,
`organization_invitations`, `email_verification_tokens`, `refresh_token_grants`,
`login_attempts`, `mfa_challenges`; and the governance ledgers `legal_documents`,
`user_legal_acceptances`, `user_consents`, `security_events`.

**Boundary rule:** account/identity rows are visible only to the relevant user or
their organization's admins. The governance ledgers are append-only and
self-read-scoped.

### 5b. Reference data (externally sourced)

Verified market and regulatory data that REDIP ingests from **external** sources.
It is critical not to confuse this with Layer 4: Reference data comes from
outside and is the same for every tenant; Layer 4 is built *from* tenant data.
They look similar ("benchmarks") but have opposite provenance.

**Tables:** `market_transactions`, `micro_market_benchmarks`,
`office_market_benchmarks`, `retail_market_benchmarks`,
`industrial_market_benchmarks`, `hospitality_market_benchmarks`,
`residential_segmented_benchmarks`, `niche_asset_class_benchmarks`,
`market_macro_kpis`, `regulatory_data`, `exchange_rates`,
`exchange_rate_fetch_log`, `geocode_cache`, `comps_review_queue`.

**Boundary rule:** non-tenant data; readable by all authenticated tenants. Per the
project rule, it must always carry source, freshness, and confidence — or show a
truthful "no verified feed" state.

## 6. Complete table-to-layer map

| Table / store | Layer |
|---|---|
| Uploaded files (storage buckets), `documents`, `deals`, `properties`, `parcels` | 1 — Raw Tenant Vault |
| `document_extractions`, `document_embeddings`, `evidence_links` | 2 — Structured Extraction |
| `financial_scenarios`, `waterfall_distributions`, `dd_items`, `approval_items`, `risk_flags`, `activities`, `intelligence_briefs`, `investor_package_snapshots`, `deal_qa_history`, `market_notes`, `deal_shares`, `deal_events`, `deal_audit_log` | 3 — Derived Private Intelligence |
| *(none yet — to be built)* | 4 — Anonymized Benchmark |
| `ai_call_logs`, `ai_response_cache`, `ai_artifacts`, `ai_routing_config`, `monitoring_logs`, `export_events`, `ab_eval_runs`, `ab_eval_results`, `feature_flag_cohorts` | 5 — Telemetry & Operations |
| `users`, `organizations`, `organization_members`, `organization_invitations`, `email_verification_tokens`, `refresh_token_grants`, `login_attempts`, `mfa_challenges`, `legal_documents`, `user_legal_acceptances`, `user_consents`, `security_events` | Control plane (§5a) |
| `market_transactions`, `*_market_benchmarks`, `residential_segmented_benchmarks`, `niche_asset_class_benchmarks`, `market_macro_kpis`, `regulatory_data`, `exchange_rates`, `exchange_rate_fetch_log`, `geocode_cache`, `comps_review_queue` | Reference data (§5b) |

## 7. Classification rule for new tables

When a migration adds a table, classify it before merge:

1. Does it hold content a tenant uploaded or typed, verbatim? → **Layer 1.**
2. Is it a machine-readable extraction of Layer-1 content? → **Layer 2.**
3. Is it REDIP's analysis/model/audit for one tenant? → **Layer 3.**
4. Is it a de-identified aggregate built across tenants? → **Layer 4** — and it
   must be gated per §4.3.
5. Is it cost / performance / security / routing exhaust? → **Layer 5.**
6. Does it govern identity, access, or what was legally agreed? → **Control
   plane (§5a).**
7. Is it verified data ingested from an external source? → **Reference data
   (§5b).**

A tenant-data table (Layers 1–3) **must** carry `organization_id` and a
Row-Level Security policy. A table that cannot be classified is a design smell —
resolve it before the migration merges.

## 8. Related documents

- `docs/legal/ropa.md` — the same tables mapped to processing purposes.
- `docs/SECURITY.md` — customer-facing data-handling summary.
- `docs/legal/data_retention_policy.md` — per-table retention windows.

---

*Internal architecture document. Reviewed when a new layer or table category is
introduced. Revision history is the git history of this file.*
