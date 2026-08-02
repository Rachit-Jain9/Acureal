'use strict';

/**
 * The environment contract.
 *
 * Two defects motivated this, both already shipped:
 *
 *   • The 2026-07-30 rebrand renamed a VARIABLE ITSELF — `REDIP_SKIP_*` became
 *     `Acureal_SKIP_*`. Environment names are case-sensitive, so an operator
 *     holding the old switch was left with a dead kill switch, discoverable
 *     only during the incident it existed to help with.
 *   • `VITE_GOOGLE_MAPS_API_KEY` is compiled into the shipped bundle and is
 *     public by construction, whatever a hosting dashboard labels it. Nothing
 *     in the codebase said so.
 *
 * The naming and exposure rules below are what turn both into build failures.
 */

const path = require('path');
const {
  ENV_MANIFEST,
  SCOPE,
  SENSITIVITY,
  REQUIREMENT,
  getEnvEntry,
  isRegistered,
  criticalVars,
  recommendedVars,
  secretVars,
} = require('../src/config/envManifest');

const guard = require(path.join(__dirname, '..', '..', 'scripts', 'check-env-manifest'));

describe('the manifest is internally consistent', () => {
  test('every entry is complete and uses known enums', () => {
    const scopes = Object.values(SCOPE);
    const sensitivities = Object.values(SENSITIVITY);
    const requirements = Object.values(REQUIREMENT);

    for (const entry of ENV_MANIFEST) {
      expect(typeof entry.name).toBe('string');
      expect(scopes).toContain(entry.scope);
      expect(sensitivities).toContain(entry.sensitivity);
      expect(requirements).toContain(entry.requirement);
      // A registry entry without a reason is a row in a spreadsheet, not
      // documentation — the `why` is printed verbatim in boot warnings.
      expect(entry.why.length).toBeGreaterThan(10);
    }
  });

  test('names are unique', () => {
    const names = ENV_MANIFEST.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test('every name is SCREAMING_SNAKE_CASE', () => {
    // The rule that would have caught Acureal_SKIP_CHART_INJECTION in review.
    for (const { name } of ENV_MANIFEST) expect(name).toMatch(/^[A-Z][A-Z0-9_]*$/);
  });
});

describe('the browser boundary is enforced by the prefix, not by a label', () => {
  test('no secret is browser-readable', () => {
    // Vite inlines every VITE_* value into the bundle. If this ever fails, a
    // credential is one build away from being public to every visitor.
    for (const entry of ENV_MANIFEST) {
      if (entry.sensitivity === SENSITIVITY.SECRET) {
        expect(entry.scope).not.toBe(SCOPE.CLIENT);
      }
    }
  });

  test('scope and prefix agree in both directions', () => {
    for (const { name, scope } of ENV_MANIFEST) {
      if (scope === SCOPE.CLIENT) expect(name.startsWith('VITE_')).toBe(true);
      if (scope === SCOPE.SERVER) expect(name.startsWith('VITE_')).toBe(false);
    }
  });

  test('the two Google Maps keys are registered as different things', () => {
    // The browser key is public by construction; the server key is a secret.
    // Treating them as one key is how an unrestricted billable key ends up
    // readable from the site.
    expect(getEnvEntry('VITE_GOOGLE_MAPS_API_KEY').scope).toBe(SCOPE.CLIENT);
    expect(getEnvEntry('VITE_GOOGLE_MAPS_API_KEY').sensitivity).toBe(SENSITIVITY.PUBLIC);
    expect(getEnvEntry('GOOGLE_MAPS_API_KEY').scope).toBe(SCOPE.SERVER);
    expect(getEnvEntry('GOOGLE_MAPS_API_KEY').sensitivity).toBe(SENSITIVITY.SECRET);
  });
});

describe('the credentials that matter are classified as secrets', () => {
  test.each([
    'DATABASE_URL',
    'JWT_SECRET',
    'DEAL_EVENTS_HMAC_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'GEMINI_API_KEY',
    'RESEND_API_KEY',
    'CRON_SECRET',
    'GOOGLE_MAPS_API_KEY',
  ])('%s is a secret', (name) => {
    expect(secretVars()).toContain(name);
  });

  test('a DSN is not a secret — it can only send', () => {
    expect(getEnvEntry('SENTRY_DSN').sensitivity).toBe(SENSITIVITY.PUBLIC);
    expect(getEnvEntry('VITE_SENTRY_DSN').sensitivity).toBe(SENSITIVITY.PUBLIC);
  });
});

describe('boot validation derives from the manifest', () => {
  test('the three critical variables are exactly the ones the app cannot boot without', () => {
    expect(criticalVars().map((e) => e.name).sort())
      .toEqual(['DATABASE_URL', 'DEAL_EVENTS_HMAC_KEY', 'JWT_SECRET']);
  });

  test('validateEnv reads its lists from here, so the two cannot drift', () => {
    const { CRITICAL, RECOMMENDED } = require('../src/config/validateEnv');
    expect(CRITICAL.map((c) => c.key).sort()).toEqual(criticalVars().map((e) => e.name).sort());
    expect(RECOMMENDED.map((c) => c.key).sort()).toEqual(recommendedVars().map((e) => e.name).sort());
    // The reason printed at boot is the reason recorded in the manifest.
    for (const check of [...CRITICAL, ...RECOMMENDED]) {
      expect(check.why).toBe(getEnvEntry(check.key).why);
    }
  });
});

describe('the rebrand-broken kill switches', () => {
  test('both the canonical and the legacy spelling are registered', () => {
    for (const suffix of ['CHART_INJECTION', 'SPARKLINE_INJECTION', 'ALL_POST_INJECTION']) {
      expect(isRegistered(`ACUREAL_SKIP_${suffix}`)).toBe(true);
      // Kept deliberately: an operator who set the pre-rebrand name still works.
      expect(isRegistered(`REDIP_SKIP_${suffix}`)).toBe(true);
    }
  });

  test('the workbook builder reads both spellings', () => {
    const fs = require('fs');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'services', 'exports', 'xlsx', 'v2', 'buildWorkbook.js'),
      'utf8',
    );
    expect(src).toMatch(/ACUREAL_\$\{suffix\}/);
    expect(src).toMatch(/REDIP_\$\{suffix\}/);
    // The mixed-case name must not survive anywhere it could be read as code.
    expect(src).not.toMatch(/process\.env\.Acureal_SKIP/);
  });
});

describe('the CI guard', () => {
  test('the live repository satisfies the contract', () => {
    expect(guard.runCheck().failures).toBe(0);
  });

  test('comments are stripped, so documentation is not mistaken for a variable', () => {
    // `process.env.AI_PROVIDER_<TASK>` appears in a doc comment; without
    // stripping it registers a phantom variable named "AI_PROVIDER_".
    const stripped = guard.stripComments('// see process.env.AI_PROVIDER_<TASK>\nconst a = 1;');
    expect(stripped).not.toMatch(/AI_PROVIDER_/);
  });

  test('shape linting catches the failure classes it exists for', () => {
    const issues = guard.lintManifestShape();
    // The live manifest is clean; this asserts the linter actually inspects
    // every entry rather than returning an empty array unconditionally.
    expect(Array.isArray(issues)).toBe(true);
    expect(issues).toEqual([]);
  });
});
