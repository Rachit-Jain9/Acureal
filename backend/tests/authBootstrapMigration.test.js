/**
 * Static scan of migration 20260801_auth_bootstrap_security_definer.sql —
 * pins the red-team hardening so a future edit cannot silently weaken it:
 *   • every function is SECURITY DEFINER with a pinned search_path,
 *   • every function is revoked from PUBLIC,
 *   • the user-lookup helpers never return MFA secrets,
 *   • auth_provision_signup takes NO caller-resolved org id / membership role
 *     and re-validates the invitation internally (FOR UPDATE),
 *   • the GRANT block is guarded on the redip_app role existing,
 *   • the probe signature in lib/authDefiners matches the migration exactly.
 */

const fs = require('fs');
const path = require('path');
const { PROBE_SIGNATURE } = require('../src/lib/authDefiners');

const MIGRATION = fs.readFileSync(
  path.join(__dirname, '..', '..', 'database', 'migrations', '20260801_auth_bootstrap_security_definer.sql'),
  'utf8'
);

const FUNCTIONS = [
  'auth_find_user_for_login',
  'auth_find_user_by_oauth',
  'auth_find_mfa_challenge',
  'auth_lookup_verified_domain',
  'auth_find_invitation',
  'auth_provision_signup',
];

// The body of one CREATE FUNCTION — from its CREATE to the next REVOKE line.
const functionBody = (name) => {
  const start = MIGRATION.indexOf(`CREATE FUNCTION public.${name}`);
  expect(start).toBeGreaterThan(-1);
  const end = MIGRATION.indexOf(`REVOKE ALL ON FUNCTION public.${name}`, start);
  expect(end).toBeGreaterThan(start);
  return MIGRATION.slice(start, end);
};

describe('20260801 auth bootstrap migration — hardening pins', () => {
  test('declares exactly the six expected definer functions', () => {
    for (const fn of FUNCTIONS) {
      expect(MIGRATION).toContain(`CREATE FUNCTION public.${fn}`);
    }
    const creates = MIGRATION.match(/CREATE FUNCTION public\./g) || [];
    expect(creates).toHaveLength(FUNCTIONS.length);
  });

  test('every function is SECURITY DEFINER with a pinned search_path', () => {
    for (const fn of FUNCTIONS) {
      const body = functionBody(fn);
      expect(body).toMatch(/SECURITY DEFINER/);
      expect(body).toMatch(/SET search_path = pg_catalog, public/);
    }
  });

  test('every function is revoked from PUBLIC', () => {
    for (const fn of FUNCTIONS) {
      expect(MIGRATION).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC;`));
    }
  });

  test('read helpers are STABLE sql; the provisioning function is VOLATILE plpgsql', () => {
    for (const fn of FUNCTIONS.slice(0, 5)) {
      expect(functionBody(fn)).toMatch(/LANGUAGE sql STABLE/);
    }
    expect(functionBody('auth_provision_signup')).toMatch(/LANGUAGE plpgsql VOLATILE/);
  });

  test('RED-TEAM PIN: user-lookup helpers never return MFA secrets', () => {
    expect(functionBody('auth_find_user_for_login')).not.toMatch(/mfa_secret|mfa_recovery_codes/);
    expect(functionBody('auth_find_user_by_oauth')).not.toMatch(/mfa_secret|mfa_recovery_codes/);
  });

  test('RED-TEAM PIN: auth_provision_signup takes token + domain candidates, never a resolved org/role', () => {
    const body = functionBody('auth_provision_signup');
    expect(body).toContain('p_invitation_token text');
    expect(body).toContain('p_domain_candidates text[]');
    // No caller-supplied organization id or membership role anywhere in the
    // signature — membership is derived INSIDE the function.
    const signature = body.slice(0, body.indexOf('RETURNS'));
    expect(signature).not.toMatch(/p_organization_id|p_org_id|p_membership_role|p_invitation_org|p_domain_org|p_invitation_role|p_domain_role/);
  });

  test('RED-TEAM PIN: the invitation is re-validated internally with FOR UPDATE', () => {
    const body = functionBody('auth_provision_signup');
    expect(body).toMatch(/FOR UPDATE/);
    expect(body).toMatch(/AUTH_PROVISION_INVITATION_NOT_FOUND/);
    expect(body).toMatch(/AUTH_PROVISION_INVITATION_ALREADY_ACCEPTED/);
    expect(body).toMatch(/AUTH_PROVISION_INVITATION_EXPIRED/);
    expect(body).toMatch(/AUTH_PROVISION_INVITATION_EMAIL_MISMATCH/);
  });

  test('the GRANT block is guarded on the redip_app role existing', () => {
    expect(MIGRATION).toMatch(/IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'redip_app'\)/);
    for (const fn of FUNCTIONS) {
      expect(MIGRATION).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO redip_app;`));
    }
  });

  test('the probe signature in lib/authDefiners matches the migration verbatim', () => {
    expect(MIGRATION).toContain(PROBE_SIGNATURE);
  });
});
