# `database/` — REDIP schema, migrations & seeds

One place that explains every file here and how a database gets built. Production
is **fully applied and current**; this folder is the source of truth + the
fresh-environment recipe.

## The files

| File / dir | What it is |
|---|---|
| **`migrations/`** | The **source of truth** — 123 ordered, idempotent `.sql` migrations (`YYYYMMDD_name.sql`). Every change to the schema or reference data lands here. Each is guarded (`IF NOT EXISTS` / `DROP ... IF EXISTS` / guarded `DO` blocks), so re-running one is a safe no-op. |
| **`current_schema.sql`** | The **authoritative manifest** — a single ordered index of every migration, grouped by month, with the fresh-env recipe. Regenerated from the real files (not hand-kept). Read this first. |
| **`schema.sql`** | The **base schema** (extensions, functions, enums, core tables). `npm run migrate` in `backend/` applies it. A convenience starting point that the migrations extend. |
| **`seed.sql`** | Intentional **no-op** — REDIP ships without demo/mock data (`npm run seed`). Add real data through the app. |
| **`seeds/`** | Standalone reference-data seed(s). |

## How migrations are applied

**Manually, via the Supabase SQL editor** — there is no auto-runner. For each new
migration: open the [SQL editor](https://supabase.com/dashboard/project/niamgjbxxgmmffggumvj/sql/new),
paste the file, click **Run**, expect `Success. No rows returned`. The idempotent
guards mean re-applying an already-applied migration does nothing.

Production project: **`niamgjbxxgmmffggumvj`** (Supabase, `ap-south-1`). Every
migration in `current_schema.sql` is live there.

## Build a fresh database (dev / preview / staging)

1. Create extensions: `uuid-ossp`, `pgcrypto`, `pg_trgm`, `postgis`.
2. Apply `schema.sql` (the base).
3. Apply every migration listed in `current_schema.sql`, **in order**.
4. `seed.sql` is a no-op — register a real user and add data through the app.

## Add a new migration

1. Create `migrations/<YYYYMMDD>_<short_name>.sql`. Make it **idempotent** (guard
   every DDL/DML) and give it a clear header comment (see any recent file, e.g.
   `20260724_hoskote_lpa_mp2031_zonal_regulations_seed.sql`).
2. `node scripts/lint-migrations.js` — the guard the CI runs (RLS/org-scoping).
3. Apply it to prod via the Supabase SQL editor (above) and verify.
4. Regenerate `current_schema.sql` so the manifest stays in step.

## Why we don't "squash" the migrations into one file

They're applied **manually** and many carry large one-shot **reference-data seeds**
(guidance values, BBMP street index, FAR rulebooks). A hand-merged single baseline
would risk ordering/dependency bugs the individual idempotent files don't have, and
it wouldn't touch the already-correct production schema. The manifest above gives
the "one clean starting point" without that risk. The migration files stay as the
immutable, auditable history.
