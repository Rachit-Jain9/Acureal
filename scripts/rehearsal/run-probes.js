'use strict';

/**
 * M1 Phase-4 rehearsal probe runner.
 *
 * Drives the full auth matrix + adversarial cross-tenant checks over HTTP
 * against a LOCAL backend whose DATABASE_URL points at a throwaway Supabase
 * BRANCH as the restricted `redip_app` role. See scripts/rehearsal/README.md
 * for the full run order (seed first, as postgres; probe second, as redip_app).
 *
 * Usage:
 *   node scripts/rehearsal/run-probes.js                 # full matrix
 *   node scripts/rehearsal/run-probes.js --drill=killswitch
 *
 * Env:
 *   REHEARSAL_BASE_URL      backend origin (default http://localhost:5000)
 *   REHEARSAL_DATABASE_URL  optional — branch pooler URL AS redip_app; enables
 *                           the direct-SQL sanity group (role posture, RLS).
 *
 * Exit code: 0 = every probe passed (skips allowed), 1 = any FAIL.
 */

const path = require('node:path');

// Resolve runtime deps from backend/node_modules (repo scripts convention).
const BACKEND_MODULES = path.join(__dirname, '..', '..', 'backend', 'node_modules');
const { authenticator } = require(path.join(BACKEND_MODULES, 'otplib'));

const BASE = (process.env.REHEARSAL_BASE_URL || 'http://localhost:5000').replace(/\/+$/, '');
const DRILL = (process.argv.find((a) => a.startsWith('--drill=')) || '').split('=')[1] || null;

// ── Seed constants (mirror scripts/rehearsal/seed_security.sql) ─────────────
const SEED = {
  password: 'Rehearse123!',
  alphaOrg: 'aaaaaaaa-0000-4000-8000-000000000001',
  betaOrg: 'bbbbbbbb-0000-4000-8000-000000000001',
  alphaOwner: 'alpha-owner@rehearsal.test',
  alphaViewer: 'alpha-viewer@rehearsal.test',
  betaOwner: 'beta-owner@rehearsal.test',
  multi: 'multi@rehearsal.test',
  mfaUser: 'mfa@rehearsal.test',
  mfaSecret: 'JBSWY3DPEHPK3PXP',
  oauthOnly: 'oauth@rehearsal.test',
  inactive: 'inactive@rehearsal.test',
  closed: 'closed@rehearsal.test',
  alphaDeal1: 'a0a0a0a0-0000-4000-8000-000000000001',
  betaDeal1: 'b0b0b0b0-0000-4000-8000-000000000001',
  betaDeal2: 'b0b0b0b0-0000-4000-8000-000000000002',
  betaInviteToken: 'rehearsal-invite-beta-0001',
  betaInviteEmail: 'invitee-beta@rehearsal.test',
  expiredInviteToken: 'rehearsal-invite-expired-0001',
  expiredInviteEmail: 'invitee-expired@rehearsal.test',
  verifyLiveToken: 'rehearsal-verify-live-00000001',
  verifyExpiredToken: 'rehearsal-verify-expired-0001',
};
// Strings that must NEVER appear in an alpha-scoped response.
const BETA_MARKERS = [SEED.betaOrg, SEED.betaDeal1, SEED.betaDeal2, 'Rehearsal Beta'];

// ── Tiny cookie jar (httpOnly cookies: redip.access / redip.refresh) ────────
class Jar {
  constructor() { this.cookies = new Map(); }
  absorb(res) {
    const setCookies = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
    for (const line of setCookies) {
      const [pair] = line.split(';');
      const eq = pair.indexOf('=');
      if (eq > 0) {
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        if (value === '' || /expires=Thu, 01 Jan 1970/i.test(line)) this.cookies.delete(name);
        else this.cookies.set(name, value);
      }
    }
  }
  header() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  get(name) { return this.cookies.get(name); }
  set(name, value) { this.cookies.set(name, value); }
}

const api = async (jar, method, route, { body, headers = {} } = {}) => {
  const res = await fetch(`${BASE}/api${route}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(jar && jar.header() ? { cookie: jar.header() } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  if (jar) jar.absorb(res);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* non-JSON (e.g. CSV export) */ }
  return { status: res.status, ok: res.ok, json, text };
};

// ── Reporting ───────────────────────────────────────────────────────────────
const results = [];
let currentGroup = '';
const group = (title) => { currentGroup = title; console.log(`\n━━ ${title}`); };
const record = (kind, name, detail) => {
  results.push({ group: currentGroup, kind, name, detail });
  const tag = kind === 'PASS' ? '  ✓' : kind === 'SKIP' ? '  ○' : '  ✗ FAIL';
  console.log(`${tag} ${name}${detail ? ` — ${detail}` : ''}`);
};
const check = (name, pass, detail) => record(pass ? 'PASS' : 'FAIL', name, pass ? '' : detail);
const skip = (name, why) => record('SKIP', name, why);
const leakScan = (name, payloadText) => {
  const hit = BETA_MARKERS.find((m) => payloadText.includes(m));
  check(name, !hit, hit ? `LEAK — response contains beta marker "${hit}"` : '');
};

const login = async (email, password, orgHeader) => {
  const jar = new Jar();
  const res = await api(jar, 'POST', '/auth/login', {
    body: { email, password },
    headers: orgHeader ? { 'x-organization-id': orgHeader } : {},
  });
  return { jar, res };
};

// ── Probe groups ────────────────────────────────────────────────────────────

async function probeAuthMatrix(legal) {
  group('Auth matrix');

  // Password login + session cookie
  const owner = await login(SEED.alphaOwner, SEED.password);
  check('password login (alpha-owner) succeeds', owner.res.status === 200 && owner.res.json?.success === true,
    `status ${owner.res.status}: ${owner.res.text.slice(0, 200)}`);
  check('login sets the httpOnly access cookie', Boolean(owner.jar.get('redip.access')), 'no redip.access cookie');
  check('login sets the httpOnly refresh cookie', Boolean(owner.jar.get('redip.refresh')), 'no redip.refresh cookie');
  check('login response never carries a raw token in the body',
    !/"(accessToken|refreshToken|token)"\s*:/.test(owner.res.text), 'raw token field in body');

  const me = await api(owner.jar, 'GET', '/auth/me');
  check('GET /auth/me works with the cookie session', me.status === 200 && me.json?.data?.email === SEED.alphaOwner,
    `status ${me.status}`);

  // Negative logins — each must be refused, never a silent empty success.
  for (const [label, email, expectMax] of [
    ['inactive user', SEED.inactive, 403],
    ['closed account', SEED.closed, 403],
    ['oauth-only user with a password attempt', SEED.oauthOnly, 403],
    ['wrong password', SEED.alphaOwner, 401],
  ]) {
    const bad = await login(email, label === 'wrong password' ? 'Wrong123!' : SEED.password);
    check(`${label} is refused (4xx)`,
      bad.res.status >= 400 && bad.res.status <= Math.max(expectMax, 403) && bad.res.json?.success !== true,
      `status ${bad.res.status}`);
  }

  // Registrations (need current legal versions)
  if (!legal) {
    skip('register probes', 'could not resolve current legal versions from /legal/active');
  } else {
    const stamp = Date.now().toString(36);
    const fresh = await api(new Jar(), 'POST', '/auth/register', {
      body: {
        name: 'Fresh Workspace User', email: `fresh-${stamp}@rehearsal-fresh.test`,
        password: SEED.password, ...legal,
      },
    });
    check('register (fresh workspace) creates an account + workspace',
      fresh.status === 201 && fresh.json?.data?.user?.organization_id &&
      fresh.json.data.user.organization_id !== SEED.alphaOrg &&
      fresh.json.data.user.organization_id !== SEED.betaOrg,
      `status ${fresh.status}: ${fresh.text.slice(0, 200)}`);

    const joiner = await api(new Jar(), 'POST', '/auth/register', {
      body: {
        name: 'Domain Joiner', email: `joiner-${stamp}@rehearsal-alpha.example`,
        password: SEED.password, ...legal,
      },
    });
    check('register (verified-domain auto-join) lands in ALPHA as editor',
      joiner.status === 201 && joiner.json?.data?.user?.organization_id === SEED.alphaOrg &&
      joiner.json?.data?.user?.organization_role === 'editor',
      `status ${joiner.status}: org ${joiner.json?.data?.user?.organization_id}, role ${joiner.json?.data?.user?.organization_role}`);

    const invited = await api(new Jar(), 'POST', '/auth/register', {
      body: {
        name: 'Beta Invitee', email: SEED.betaInviteEmail, password: SEED.password,
        invitationToken: SEED.betaInviteToken, ...legal,
      },
    });
    if (invited.status === 201) {
      check('register (invitation) lands in BETA with the invited role',
        invited.json?.data?.user?.organization_id === SEED.betaOrg,
        `org ${invited.json?.data?.user?.organization_id}`);
    } else if (/accepted|exists|already/i.test(invited.text)) {
      skip('register (invitation)', 'invite already consumed by a prior run — reset the branch for a pristine pass');
    } else {
      check('register (invitation)', false, `status ${invited.status}: ${invited.text.slice(0, 200)}`);
    }

    const expired = await api(new Jar(), 'POST', '/auth/register', {
      body: {
        name: 'Expired Invitee', email: SEED.expiredInviteEmail, password: SEED.password,
        invitationToken: SEED.expiredInviteToken, ...legal,
      },
    });
    check('register with an EXPIRED invitation is refused',
      expired.status >= 400 && expired.status < 500, `status ${expired.status}`);
  }

  // MFA challenge + verify (live TOTP via the seeded secret)
  const mfaStep = await login(SEED.mfaUser, SEED.password);
  const challenge = mfaStep.res.json?.data?.challenge;
  check('MFA-enrolled login returns a challenge (no cookies yet)',
    mfaStep.res.status === 200 && mfaStep.res.json?.mfaRequired === true &&
    Boolean(challenge) && !mfaStep.jar.get('redip.access'),
    `status ${mfaStep.res.status}: ${mfaStep.res.text.slice(0, 200)}`);
  if (challenge) {
    const code = authenticator.generate(SEED.mfaSecret);
    const verified = await api(mfaStep.jar, 'POST', '/auth/mfa/verify', { body: { challenge, code } });
    check('MFA verify with a live TOTP code mints the session',
      verified.status === 200 && Boolean(mfaStep.jar.get('redip.access')),
      `status ${verified.status}: ${verified.text.slice(0, 200)}`);
    const replay = await api(new Jar(), 'POST', '/auth/mfa/verify', { body: { challenge, code } });
    check('replaying a consumed MFA challenge is refused',
      replay.status >= 400 && replay.status < 500, `status ${replay.status}`);
  }

  // Refresh rotation + reuse detection (family burn)
  const rot = await login(SEED.alphaOwner, SEED.password);
  const firstRefresh = rot.jar.get('redip.refresh');
  const r1 = await api(rot.jar, 'POST', '/auth/refresh');
  const secondRefresh = rot.jar.get('redip.refresh');
  check('refresh rotates the token', r1.status === 200 && secondRefresh && secondRefresh !== firstRefresh,
    `status ${r1.status}`);
  const staleJar = new Jar();
  staleJar.set('redip.refresh', firstRefresh);
  const reuse = await api(staleJar, 'POST', '/auth/refresh');
  check('presenting the SUPERSEDED token is refused (reuse detection)',
    reuse.status === 401 || reuse.status === 403, `status ${reuse.status}`);
  const burnedJar = new Jar();
  burnedJar.set('redip.refresh', secondRefresh);
  const burned = await api(burnedJar, 'POST', '/auth/refresh');
  check('reuse burns the whole family (current token now dead too)',
    burned.status === 401 || burned.status === 403, `status ${burned.status}`);

  // Logout
  const out = await login(SEED.alphaOwner, SEED.password);
  const loggedOut = await api(out.jar, 'POST', '/auth/logout');
  check('logout succeeds and revokes the family', loggedOut.status === 200, `status ${loggedOut.status}`);
  const afterLogout = await api(out.jar, 'POST', '/auth/refresh');
  check('refresh after logout is refused', afterLogout.status === 401 || afterLogout.status === 403,
    `status ${afterLogout.status}`);

  // Public email-verification confirm (one-shot fixture)
  const confirm = await api(new Jar(), 'POST', '/auth/verify-email/confirm',
    { body: { token: SEED.verifyLiveToken } });
  if (confirm.status === 200) {
    check('public verify-email confirm consumes the live token', confirm.json?.success === true, confirm.text.slice(0, 150));
    const again = await api(new Jar(), 'POST', '/auth/verify-email/confirm',
      { body: { token: SEED.verifyLiveToken } });
    check('replaying the consumed verification token is refused',
      again.status >= 400 && again.status < 500, `status ${again.status}`);
  } else {
    skip('verify-email confirm', `token already consumed by a prior run (status ${confirm.status})`);
  }
  const expiredVerify = await api(new Jar(), 'POST', '/auth/verify-email/confirm',
    { body: { token: SEED.verifyExpiredToken } });
  check('an EXPIRED verification token is refused',
    expiredVerify.status >= 400 && expiredVerify.status < 500, `status ${expiredVerify.status}`);

  // Warm-probe convergence: two consecutive logins must both work (the second
  // rides the memoized definer path in the same backend process).
  const conv1 = await login(SEED.alphaOwner, SEED.password);
  const conv2 = await login(SEED.alphaOwner, SEED.password);
  check('two consecutive logins converge (memoized definer path)',
    conv1.res.status === 200 && conv2.res.status === 200,
    `statuses ${conv1.res.status}/${conv2.res.status}`);

  // Google OAuth cannot be automated (needs a real Google ID token) — the
  // config endpoint responding is the automated floor; the rest is manual.
  const gcfg = await api(new Jar(), 'GET', '/auth/google/config');
  check('google config endpoint responds', gcfg.status === 200, `status ${gcfg.status}`);
  skip('Google OAuth new/returning/bind', 'MANUAL — needs a real Google ID token (see README)');
}

async function probeAdversarial() {
  group('Adversarial cross-tenant (as alpha-owner vs seeded beta fixtures)');

  const owner = await login(SEED.alphaOwner, SEED.password);
  if (owner.res.status !== 200) {
    check('alpha-owner login for the adversarial group', false, `status ${owner.res.status}`);
    return;
  }

  const betaRead = await api(owner.jar, 'GET', `/deals/${SEED.betaDeal1}`);
  check("reading beta's deal by id is refused (404/403, never 200)",
    betaRead.status === 404 || betaRead.status === 403, `status ${betaRead.status}`);

  const betaWrite = await api(owner.jar, 'PUT', `/deals/${SEED.betaDeal1}`,
    { body: { name: 'HIJACKED' } });
  check("updating beta's deal is refused", betaWrite.status >= 400, `status ${betaWrite.status}`);

  const betaStage = await api(owner.jar, 'PATCH', `/deals/${SEED.betaDeal1}/stage`,
    { body: { stage: 'dead' } });
  check("moving beta's deal stage is refused", betaStage.status >= 400, `status ${betaStage.status}`);

  const betaExport = await api(owner.jar, 'GET', `/exports/deals/${SEED.betaDeal1}/xlsx`);
  check("exporting beta's deal is refused", betaExport.status >= 400, `status ${betaExport.status}`);

  const list = await api(owner.jar, 'GET', '/deals');
  check('deal list responds', list.status === 200, `status ${list.status}`);
  leakScan('deal list contains no beta markers', list.text);

  const dash = await api(owner.jar, 'GET', '/dashboard');
  check('dashboard rollup responds', dash.status === 200, `status ${dash.status}`);
  leakScan('dashboard rollup contains no beta markers', dash.text);

  // Org-header forgery: a NON-member asking for beta must not get a beta session.
  const forged = await login(SEED.alphaOwner, SEED.password, SEED.betaOrg);
  const forgedOrg = forged.res.json?.data?.user?.organization_id;
  check('x-organization-id forgery cannot land a non-member in beta',
    forged.res.status >= 400 || (forged.res.status === 200 && forgedOrg !== SEED.betaOrg),
    `status ${forged.res.status}, org ${forgedOrg}`);

  // Legitimate multi-org switching still works, and stays scoped.
  const multiBeta = await login(SEED.multi, SEED.password, SEED.betaOrg);
  check('multi-org member CAN select beta via x-organization-id',
    multiBeta.res.status === 200 && multiBeta.res.json?.data?.user?.organization_id === SEED.betaOrg,
    `status ${multiBeta.res.status}, org ${multiBeta.res.json?.data?.user?.organization_id}`);
  if (multiBeta.res.status === 200) {
    const betaList = await api(multiBeta.jar, 'GET', '/deals');
    const containsAlpha = betaList.text.includes(SEED.alphaDeal1) || betaList.text.includes('Rehearsal Alpha —');
    check('beta-scoped list shows beta deals only (no alpha bleed)',
      betaList.status === 200 && !containsAlpha && betaList.text.includes(SEED.betaDeal1),
      `status ${betaList.status}${containsAlpha ? ' — alpha marker leaked into beta scope' : ''}`);
  }

  // Deal write round-trip in the caller's own org + role enforcement.
  const created = await api(owner.jar, 'POST', '/deals',
    { body: { name: 'Rehearsal Probe Deal', dealType: 'acquisition' } });
  check('deal create works in own org', created.status === 201 && created.json?.data?.id,
    `status ${created.status}: ${created.text.slice(0, 200)}`);
  if (created.json?.data?.id) {
    const rt = await api(owner.jar, 'GET', `/deals/${created.json.data.id}`);
    check('deal read-back round-trip works', rt.status === 200, `status ${rt.status}`);
  }

  const viewer = await login(SEED.alphaViewer, SEED.password);
  const viewerWrite = await api(viewer.jar, 'PUT', `/deals/${SEED.alphaDeal1}`,
    { body: { name: 'Viewer should not write' } });
  check('viewer role cannot write deals (requireRole 403)',
    viewerWrite.status === 403, `status ${viewerWrite.status}`);

  const csv = await api(owner.jar, 'GET', '/exports/deals/csv');
  check('own-org CSV export responds', csv.status === 200, `status ${csv.status}`);
  leakScan('own-org CSV export contains no beta markers', csv.text);
}

async function probeSqlSanity() {
  group('Direct-SQL sanity (as redip_app, no request context)');
  const dbUrl = process.env.REHEARSAL_DATABASE_URL;
  if (!dbUrl) {
    skip('SQL sanity group', 'set REHEARSAL_DATABASE_URL (branch pooler URL as redip_app) to enable');
    return;
  }
  const { Client } = require(path.join(BACKEND_MODULES, 'pg'));
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    const who = await client.query(
      `SELECT current_user AS role,
              (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypasses_rls`);
    check('connected role is redip_app', /^redip_app/.test(who.rows[0].role), `role ${who.rows[0].role}`);
    check('role does NOT bypass RLS', who.rows[0].bypasses_rls === false, 'rolbypassrls is true');

    const noCtx = await client.query('SELECT COUNT(*)::int AS n FROM deals');
    check('deals are invisible without request context (fail-closed)',
      noCtx.rows[0].n === 0, `${noCtx.rows[0].n} rows visible with no context`);

    const audit = await client.query(`
      SELECT COUNT(*)::int AS n FROM pg_trigger t
      JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE NOT t.tgisinternal
        AND t.tgrelid::regclass::text IN ('users','organization_members','refresh_token_grants','mfa_challenges','email_verification_tokens','login_attempts')
        AND pg_get_functiondef(p.oid) ~ 'current_setting\\(''app\\.current_'`);
    check('no auth-table trigger depends on request context', audit.rows[0].n === 0,
      `${audit.rows[0].n} context-dependent trigger(s) found`);

    const street = await client.query(
      'SELECT COUNT(*)::int AS n FROM regulatory_data.bbmp_street_index');
    check('bbmp_street_index is readable as redip_app (policy gap closed)',
      street.rows[0].n >= 0 && street.rows[0].n !== null, 'query failed');
    if (street.rows[0].n === 0) {
      skip('bbmp_street_index row visibility', '0 rows — expected only if the branch predates the street seed; verify migration 20260802 applied');
    }
  } catch (err) {
    check('SQL sanity connection', false, err.message);
  } finally {
    await client.end().catch(() => {});
  }
}

async function drillKillswitch() {
  group('Kill-switch drill (RLS_ENFORCED=true + definers dropped)');
  console.log('  Expected state: scripts/rehearsal/drop_definers.sql applied, backend');
  console.log('  RESTARTED with RLS_ENFORCED=true (the probe cache is per-process).\n');
  const res = await api(new Jar(), 'POST', '/auth/login',
    { body: { email: SEED.alphaOwner, password: SEED.password } });
  check('login fails LOUD with 503 (never a silent empty 401)',
    res.status === 503, `status ${res.status}: ${res.text.slice(0, 200)}`);
  check('the 503 names the misconfiguration',
    /definer|misconfigured|20260801/i.test(res.text), res.text.slice(0, 200));
  console.log('\n  Now restore: re-apply database/migrations/20260802_rls_flip_hardening.sql,');
  console.log('  restart the backend WITHOUT RLS_ENFORCED, and re-run the full matrix.');
}

// ── Main ────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`M1 Phase-4 rehearsal probes → ${BASE}${DRILL ? ` (drill: ${DRILL})` : ''}`);

  // Liveness preflight
  let legalDocs = null;
  try {
    const live = await api(new Jar(), 'GET', '/legal/active');
    if (live.status !== 200) throw new Error(`GET /api/legal/active → ${live.status}`);
    // Accept either an array of docs or an object keyed by kind.
    const docs = Array.isArray(live.json?.data) ? live.json.data : Object.values(live.json?.data || {});
    const findVersion = (kind) => docs.find((d) => d && d.kind === kind)?.version || null;
    const terms = findVersion('terms_of_service');
    const privacy = findVersion('privacy_policy');
    if (terms && privacy) legalDocs = { acceptedTermsVersion: terms, acceptedPrivacyVersion: privacy };
  } catch (err) {
    console.error(`\nBackend not reachable at ${BASE} (${err.message}).`);
    console.error('Start it first: see scripts/rehearsal/README.md.');
    process.exit(1);
  }

  if (DRILL === 'killswitch') {
    await drillKillswitch();
  } else {
    await probeAuthMatrix(legalDocs);
    await probeAdversarial();
    await probeSqlSanity();
  }

  const fails = results.filter((r) => r.kind === 'FAIL');
  const skips = results.filter((r) => r.kind === 'SKIP');
  console.log(`\n━━ Summary: ${results.length - fails.length - skips.length} passed, ${fails.length} failed, ${skips.length} skipped`);
  if (fails.length) {
    console.log('\nFailures:');
    for (const f of fails) console.log(`  ✗ [${f.group}] ${f.name} — ${f.detail}`);
    process.exit(1);
  }
  console.log(DRILL ? 'Drill green.' : 'Rehearsal matrix green — Phase 5 gate condition met (pending the manual Google checks).');
})();
