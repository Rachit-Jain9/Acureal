/**
 * Static scan of migration 20260802_rls_flip_hardening.sql — the file whose
 * function bodies are now the LIVE definitions (it CREATE OR REPLACEs the six
 * auth definers from 20260801 to append pg_temp to the pinned search_path).
 *
 * Pins:
 *   • every definer is re-created with `search_path = pg_catalog, public, pg_temp`
 *     (pg_temp LAST, per PostgreSQL secure-function guidance),
 *   • the bodies are byte-identical to 20260801 modulo exactly those two
 *     intended changes (CREATE OR REPLACE + pg_temp) — no silent drift,
 *   • every red-team hardening pin from 20260801 holds on the new bodies,
 *   • the four regulatory_data policy fixes exist, and zone_versions stays
 *     append-only (INSERT policy but no UPDATE/DELETE policy).
 */

const fs = require('fs');
const path = require('path');
const { PROBE_SIGNATURE } = require('../src/lib/authDefiners');

const read = (name) =>
  fs.readFileSync(path.join(__dirname, '..', '..', 'database', 'migrations', name), 'utf8');

const HARDENING = read('20260802_rls_flip_hardening.sql');
const ORIGINAL = read('20260801_auth_bootstrap_security_definer.sql');

const FUNCTIONS = [
  'auth_find_user_for_login',
  'auth_find_user_by_oauth',
  'auth_find_mfa_challenge',
  'auth_lookup_verified_domain',
  'auth_find_invitation',
  'auth_provision_signup',
];

// One CREATE..REVOKE span from a given migration text.
const functionBody = (text, createKeyword, name) => {
  const start = text.indexOf(`${createKeyword} public.${name}`);
  expect(start).toBeGreaterThan(-1);
  const end = text.indexOf(`REVOKE ALL ON FUNCTION public.${name}`, start);
  expect(end).toBeGreaterThan(start);
  return text.slice(start, end);
};

const hardenedBody = (name) => functionBody(HARDENING, 'CREATE OR REPLACE FUNCTION', name);
const originalBody = (name) => functionBody(ORIGINAL, 'CREATE FUNCTION', name);

describe('20260802 rls flip hardening — search-path + policy pins', () => {
  test('re-declares exactly the six definer functions, all CREATE OR REPLACE', () => {
    for (const fn of FUNCTIONS) {
      expect(HARDENING).toContain(`CREATE OR REPLACE FUNCTION public.${fn}`);
    }
    const creates = HARDENING.match(/CREATE OR REPLACE FUNCTION public\.auth_/g) || [];
    expect(creates).toHaveLength(FUNCTIONS.length);
  });

  test('every function pins search_path with pg_temp LAST', () => {
    for (const fn of FUNCTIONS) {
      const body = hardenedBody(fn);
      expect(body).toMatch(/SECURITY DEFINER/);
      expect(body).toMatch(/SET search_path = pg_catalog, public, pg_temp/);
    }
  });

  test('bodies are byte-identical to 20260801 modulo the two intended changes', () => {
    // Line endings normalized — git checkout EOL differences are not drift.
    const eol = (s) => s.replace(/\r\n/g, '\n');
    for (const fn of FUNCTIONS) {
      const normalized = eol(hardenedBody(fn))
        .replace('CREATE OR REPLACE FUNCTION', 'CREATE FUNCTION')
        .replace('SET search_path = pg_catalog, public, pg_temp', 'SET search_path = pg_catalog, public');
      expect(normalized).toBe(eol(originalBody(fn)));
    }
  });

  test('every function is re-revoked from PUBLIC', () => {
    for (const fn of FUNCTIONS) {
      expect(HARDENING).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC;`));
    }
  });

  test('RED-TEAM PIN: user-lookup helpers never return MFA secrets', () => {
    expect(hardenedBody('auth_find_user_for_login')).not.toMatch(/mfa_secret|mfa_recovery_codes/);
    expect(hardenedBody('auth_find_user_by_oauth')).not.toMatch(/mfa_secret|mfa_recovery_codes/);
  });

  test('RED-TEAM PIN: auth_provision_signup takes token + domain candidates, never a resolved org/role', () => {
    const body = hardenedBody('auth_provision_signup');
    expect(body).toContain('p_invitation_token text');
    expect(body).toContain('p_domain_candidates text[]');
    const signature = body.slice(0, body.indexOf('RETURNS'));
    expect(signature).not.toMatch(/p_organization_id|p_org_id|p_membership_role|p_invitation_org|p_domain_org|p_invitation_role|p_domain_role/);
  });

  test('RED-TEAM PIN: the invitation is re-validated internally with FOR UPDATE', () => {
    const body = hardenedBody('auth_provision_signup');
    expect(body).toMatch(/FOR UPDATE/);
    expect(body).toMatch(/AUTH_PROVISION_INVITATION_NOT_FOUND/);
    expect(body).toMatch(/AUTH_PROVISION_INVITATION_ALREADY_ACCEPTED/);
    expect(body).toMatch(/AUTH_PROVISION_INVITATION_EXPIRED/);
    expect(body).toMatch(/AUTH_PROVISION_INVITATION_EMAIL_MISMATCH/);
  });

  test('the GRANT block is guarded on the redip_app role existing', () => {
    expect(HARDENING).toMatch(/IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'redip_app'\)/);
    for (const fn of FUNCTIONS) {
      expect(HARDENING).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO redip_app;`));
    }
  });

  test('the probe signature in lib/authDefiners matches the migration verbatim', () => {
    expect(HARDENING).toContain(PROBE_SIGNATURE);
  });

  test('closes the bbmp_street_index read gap with a role-agnostic SELECT policy', () => {
    expect(HARDENING).toMatch(
      /CREATE POLICY bbmp_street_index_read_app\s+ON regulatory_data\.bbmp_street_index\s+FOR SELECT\s+USING \(true\);/
    );
  });

  test('adds the runtime write policies for the global registry tables', () => {
    expect(HARDENING).toMatch(/CREATE POLICY master_plan_zones_insert_app\s+ON regulatory_data\.master_plan_zones\s+FOR INSERT/);
    expect(HARDENING).toMatch(/CREATE POLICY master_plan_zones_update_app\s+ON regulatory_data\.master_plan_zones\s+FOR UPDATE/);
    expect(HARDENING).toMatch(/CREATE POLICY planning_districts_insert_app\s+ON regulatory_data\.planning_districts\s+FOR INSERT/);
    expect(HARDENING).toMatch(/CREATE POLICY planning_districts_update_app\s+ON regulatory_data\.planning_districts\s+FOR UPDATE/);
  });

  test('zone_versions stays append-only: INSERT policy present, no UPDATE/DELETE policy', () => {
    expect(HARDENING).toMatch(/CREATE POLICY zone_versions_insert_app\s+ON regulatory_data\.zone_versions\s+FOR INSERT/);
    const zoneVersionPolicies = HARDENING.match(/CREATE POLICY \S+\s+ON regulatory_data\.zone_versions\s+FOR (\w+)/g) || [];
    expect(zoneVersionPolicies).toHaveLength(1);
    expect(zoneVersionPolicies[0]).toMatch(/FOR INSERT$/);
  });
});
