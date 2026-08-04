# `database/` — Acureal schema, migrations & seeds

One place that explains every file here and how a database gets built. Production
is **fully applied and current**; this folder is the source of truth + the
fresh-environment recipe.

## The files

| File / dir | What it is |
|---|---|
| **`migrations/`** | The **source of truth** — 123 ordered, idempotent `.sql` migrations (`YYYYMMDD_name.sql`). Every change to the schema or reference data lands here. Each is guarded (`IF NOT EXISTS` / `DROP ... IF EXISTS` / guarded `DO` blocks), so re-running one is a safe no-op. |
| **`current_schema.sql`** | The **authoritative manifest** — a single ordered index of every migration, grouped by month, with the fresh-env recipe. Regenerated from the real files (not hand-kept). Read this first. |
| **`schema.sql`** | The **base schema** (extensions, functions, enums, core tables). `npm run migrate` in `backend/` applies it. A convenience starting point that the migrations extend. |
| **`seed.sql`** | Intentional **no-op** — Acureal ships without demo/mock data (`npm run seed`). Add real data through the app. |
| **`seeds/`** | Standalone reference-data seed(s). |

## How migrations are applied

**With the applier** (`backend/scripts/migration-apply.js`, since 2026-08-04) —
operator-invoked from a terminal, never auto-on-deploy:

```bash
node backend/scripts/migration-apply.js                 # dry run: shows the plan, changes nothing
node backend/scripts/migration-apply.js --apply         # applies pending DDL migrations, in order
node backend/scripts/migration-apply.js --apply --only <file>.sql   # seed/DML files, one at a time by name
```

One transaction per migration; the run stops at the first failure (rolled back,
not recorded); each applied file is recorded in the ledger `migration-status.js`
reads, so re-runs skip everything already applied. Files with `CONCURRENTLY` or
multiple transactions are refused toward `run-sql.js` (deliberate, single-file).
The browser SQL editor remains a fallback — it was the ONLY path until the
applier was proven end-to-end by rebuilding the preview branch database from
this folder's recipe.

Production project: **`niamgjbxxgmmffggumvj`** (Supabase, `ap-south-1`). Every
migration in `current_schema.sql` is live there.

## Build a fresh database (dev / preview / staging)

1. Create extensions: `uuid-ossp`, `pgcrypto`, `pg_trgm`, `postgis`, `vector`
   (`pg_trgm`/`postgis`/`vector` live in schema `public` on production).
2. Insert the platform organization row first — several comps/benchmark seeds
   reference it: `INSERT INTO organizations (id, name, slug) VALUES
   ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Default Workspace',
   'default-workspace')`.
3. Apply `schema.sql` (the base) via `run-sql.js`.
4. Run the applier (`--apply`, resolving any PARTIAL stops via `run-sql.js` as
   its stop message instructs), then the seed files it lists via `--only`.
5. Known limits of a data-less environment (verified on the 2026-08-04 preview
   branch build): 9 seed migrations legitimately refuse — four depend on
   operator-uploaded document rows (`20260529/30/31`, `20260601`), two reference
   functions from retired supabase-dir migrations (`20260430_function_search_
   path_lockdown`, `20260627_advisor_cleanup…`), `20260508` is non-idempotent,
   `20260403` predates multi-tenancy, `20260714` needs registry rows. The BBMP
   street index and gazette corpora are **script-seeded** (`scripts/seed-bbmp-
   uav-register.js`), not migration-seeded.
6. `seed.sql` is a no-op — register a real user and add data through the app.

## Add a new migration

1. Create `migrations/<YYYYMMDD>_<short_name>.sql`. Make it **idempotent** (guard
   every DDL/DML) and give it a clear header comment (see any recent file, e.g.
   `20260724_hoskote_lpa_mp2031_zonal_regulations_seed.sql`).
2. `node scripts/lint-migrations.js` — the guard the CI runs (RLS/org-scoping).
3. Apply it to prod with the applier (above) and verify.
4. Regenerate `current_schema.sql` so the manifest stays in step.

## Why we don't "squash" the migrations into one file

They're applied **manually** and many carry large one-shot **reference-data seeds**
(guidance values, BBMP street index, FAR rulebooks). A hand-merged single baseline
would risk ordering/dependency bugs the individual idempotent files don't have, and
it wouldn't touch the already-correct production schema. The manifest above gives
the "one clean starting point" without that risk. The migration files stay as the
immutable, auditable history.
