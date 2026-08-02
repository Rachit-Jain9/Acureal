#!/usr/bin/env node
'use strict';

// CI regression fence for the PostgREST Data API surface.
//
// WHY THIS EXISTS. Acureal has two doors into the same database: the Express
// API, and Supabase's PostgREST Data API. Only the first was ever reviewed. On
// 2026-08-02 the second was found wide open — Supabase's default privileges had
// granted `anon` and `authenticated` full CRUD on all 83 tables in `public` and
// EXECUTE on every function in it, including the six auth SECURITY DEFINER
// helpers introduced by the M1 RLS rollout. With only the project's publishable
// key that reached password hashes, TOTP seeds, the cross-org signup roster,
// account provisioning, and a refresh_token_grants INSERT that forges a session
// for any user. Migration 20260805_revoke_postgrest_exposure.sql closed it.
//
// WHAT THIS CHECKS. CI has no database credentials, so this cannot inspect live
// grants — that is the job of the hourly `api_exposure` canary in
// backend/src/services/healthCheck.service.js. This is the cheap fence that
// stops a NEW migration reopening the door between canary runs:
//
//   1. No migration may GRANT anything to anon / authenticated / PUBLIC.
//   2. Every SECURITY DEFINER function a migration creates must pin its
//      search_path with pg_temp LAST (otherwise pg_temp is searched FIRST and a
//      caller can shadow an unqualified table to run their own SQL as the
//      function's owner), must REVOKE EXECUTE from PUBLIC in the same file, and
//      must be on the reviewed allowlist below.
//
// SCOPE. Only migrations dated AFTER the containment migration are linted. The
// historical corpus legitimately contains pre-containment grants (20260508,
// 20260525, 20260526, 20260727) which 20260805 neutralises wholesale; rewriting
// applied history to satisfy a linter would be worse than useless.
//
// Exit code 0 = clean, 1 = failures (details printed).

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'database', 'migrations');

// Migrations at or before this date predate containment and are not linted.
const CONTAINMENT_MIGRATION_DATE = '20260805';

// The API roles PostgREST authenticates as. `public` is included because a
// GRANT to PUBLIC reaches anon transitively — the subtlety that made the
// original hole survive several partial cleanups.
const FORBIDDEN_GRANTEES = ['anon', 'authenticated', 'public'];

// Every application-owned SECURITY DEFINER function that has been reviewed.
// MIRRORED in backend/src/services/healthCheck.service.js as APPROVED_DEFINERS
// — the backend cannot require this file because the Vercel bundle only ships
// `backend/**` (see vercel.json includeFiles). Parity is pinned by
// backend/tests/postgrestExposureGuard.test.js. Change one, change both.
const APPROVED_DEFINERS = new Set([
  'public.auth_find_user_for_login',
  'public.auth_find_user_by_oauth',
  'public.auth_find_mfa_challenge',
  'public.auth_lookup_verified_domain',
  'public.auth_find_invitation',
  'public.auth_provision_signup',
  'public.admin_list_signups',
  'public.admin_signup_summary',
]);

// ── SQL helpers ─────────────────────────────────────────────────────────────

// Strip comments so prose never reads as a statement. The containment migration
// documents its own break-glass rollback as commented GRANT statements; without
// this, the guard would flag the very file that closes the hole.
function stripSqlComments(sql) {
  return String(sql)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, '');
}

// GRANT <privileges> ON <target> TO <grantees> — capture the grantee list only,
// which is everything after the final ` TO ` up to the statement terminator.
const GRANT_RE = /\bGRANT\b[\s\S]*?\bTO\b([^;]*);/gi;

function forbiddenGrants(sql) {
  const code = stripSqlComments(sql);
  const out = [];
  let m;
  GRANT_RE.lastIndex = 0;
  while ((m = GRANT_RE.exec(code)) !== null) {
    const grantees = m[1]
      .split(',')
      .map((g) => g.trim().replace(/^"|"$/g, '').toLowerCase())
      .filter(Boolean);
    const hits = grantees.filter((g) => FORBIDDEN_GRANTEES.includes(g));
    if (hits.length) out.push({ grantees: hits, statement: m[0].trim().replace(/\s+/g, ' ').slice(0, 120) });
  }
  return out;
}

// CREATE [OR REPLACE] FUNCTION <name>(...) ... up to the body delimiter. We
// capture the name and the header text between the signature and the opening
// $$, which is where SECURITY DEFINER / SET search_path live.
const CREATE_FUNCTION_RE =
  /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([A-Za-z_][\w.]*)\s*\(([\s\S]*?)\)\s*([\s\S]*?)(?:\$\$|\bBEGIN\b|;)/gi;

function securityDefinerFunctions(sql) {
  const code = stripSqlComments(sql);
  const out = [];
  let m;
  CREATE_FUNCTION_RE.lastIndex = 0;
  while ((m = CREATE_FUNCTION_RE.exec(code)) !== null) {
    const [, rawName, , header] = m;
    if (!/\bSECURITY\s+DEFINER\b/i.test(header)) continue;
    const name = rawName.toLowerCase();
    out.push({
      name: name.includes('.') ? name : `public.${name}`,
      searchPathSafe: searchPathIsSafe(header),
    });
  }
  return out;
}

// `SET search_path = pg_catalog, public, pg_temp` — pg_temp must be LAST.
//
// The value is comma-separated AND unquoted, so it has no self-delimiting end:
// `SET search_path = pg_catalog, public, pg_temp AS $$ … $$` is valid one-line
// SQL, and a naive capture-to-end-of-line swallows `AS $$ …` into the final
// schema name. Truncate at the next function-attribute keyword instead.
const FUNCTION_ATTRIBUTE_KEYWORDS =
  /\b(?:AS|LANGUAGE|SECURITY|STABLE|IMMUTABLE|VOLATILE|STRICT|PARALLEL|COST|ROWS|WINDOW|LEAKPROOF|RETURNS|SET)\b/i;

function searchPathIsSafe(header) {
  const m = /\bSET\s+search_path\s*(?:=|TO)\s*([^\n;]*)/i.exec(String(header));
  if (!m) return false;
  const schemas = m[1]
    .split(FUNCTION_ATTRIBUTE_KEYWORDS)[0]
    .split(',')
    .map((s) => s.trim().replace(/^"|"$/g, '').toLowerCase())
    .filter(Boolean);
  return schemas.length > 0 && schemas[schemas.length - 1] === 'pg_temp';
}

function revokesExecuteFromPublic(sql, functionName) {
  const code = stripSqlComments(sql);
  const bare = functionName.split('.').pop();
  const re = new RegExp(
    `\\bREVOKE\\b[\\s\\S]{0,80}?\\bON\\s+FUNCTION\\s+(?:[A-Za-z_]\\w*\\.)?${bare}\\b[\\s\\S]*?\\bFROM\\b[^;]*\\bPUBLIC\\b`,
    'i',
  );
  return re.test(code);
}

// ── Per-file lint ───────────────────────────────────────────────────────────

function lintFile(name, contents) {
  const issues = [];

  for (const g of forbiddenGrants(contents)) {
    issues.push(
      `GRANTs to ${g.grantees.join('/')} — these are the PostgREST API roles; anything granted to them `
      + `is reachable from the internet with the project's publishable key. Grant to redip_app instead. `
      + `[${g.statement}]`,
    );
  }

  for (const fn of securityDefinerFunctions(contents)) {
    if (!fn.searchPathSafe) {
      issues.push(
        `SECURITY DEFINER function ${fn.name} does not pin its search_path with pg_temp LAST — `
        + 'a caller can shadow an unqualified table with a temp table and run SQL as the function owner. '
        + 'Add: SET search_path = pg_catalog, public, pg_temp',
      );
    }
    if (!revokesExecuteFromPublic(contents, fn.name)) {
      issues.push(
        `SECURITY DEFINER function ${fn.name} is created without REVOKE ALL ON FUNCTION ${fn.name}(...) FROM PUBLIC `
        + 'in the same migration — it inherits Supabase\'s default EXECUTE grant to anon/authenticated.',
      );
    }
    if (!APPROVED_DEFINERS.has(fn.name)) {
      issues.push(
        `SECURITY DEFINER function ${fn.name} is not on the reviewed allowlist. A definer bypasses RLS by `
        + 'design, so each one needs a deliberate review. Once reviewed, add it to APPROVED_DEFINERS in BOTH '
        + 'scripts/check-postgrest-exposure.js and backend/src/services/healthCheck.service.js.',
      );
    }
  }

  return issues;
}

const isLinted = (name) => /^\d{8}_/.test(name) && name.slice(0, 8) > CONTAINMENT_MIGRATION_DATE;

// ── Corpus lint ─────────────────────────────────────────────────────────────

/**
 * Lint every post-containment migration. Pure — prints a report and returns a
 * result object; never calls process.exit, so it is safe to call from tests.
 *
 * @returns {{ failures:number, lintedCount:number, skippedCount:number }}
 */
function runCheck() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.log('[check-postgrest-exposure] no database/migrations/ directory — nothing to check.');
    return { failures: 0, lintedCount: 0, skippedCount: 0 };
  }

  const all = fs.readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith('.sql')).sort();
  const linted = all.filter(isLinted);

  let failures = 0;
  for (const name of linted) {
    const issues = lintFile(name, fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8'));
    if (issues.length > 0) {
      failures += issues.length;
      console.error(`✗ ${name}`);
      for (const issue of issues) console.error(`    - ${issue}`);
    }
  }

  const skipped = all.length - linted.length;
  if (failures === 0) {
    console.log(
      `[check-postgrest-exposure] ${linted.length} post-containment migration${linted.length === 1 ? '' : 's'} clean · `
      + `${skipped} pre-containment file${skipped === 1 ? '' : 's'} skipped (neutralised by ${CONTAINMENT_MIGRATION_DATE}) · `
      + `${APPROVED_DEFINERS.size} reviewed SECURITY DEFINER function${APPROVED_DEFINERS.size === 1 ? '' : 's'}.`,
    );
    return { failures: 0, lintedCount: linted.length, skippedCount: skipped };
  }

  console.error(
    `\n[check-postgrest-exposure] ${failures} issue${failures === 1 ? '' : 's'} across ${linted.length} post-containment migrations.`,
  );
  return { failures, lintedCount: linted.length, skippedCount: skipped };
}

module.exports = {
  lintFile,
  forbiddenGrants,
  securityDefinerFunctions,
  searchPathIsSafe,
  revokesExecuteFromPublic,
  stripSqlComments,
  isLinted,
  runCheck,
  APPROVED_DEFINERS,
  CONTAINMENT_MIGRATION_DATE,
  FORBIDDEN_GRANTEES,
};

// Run as a script — exit non-zero on any failure so CI fails.
if (require.main === module) {
  process.exit(runCheck().failures === 0 ? 0 : 1);
}
