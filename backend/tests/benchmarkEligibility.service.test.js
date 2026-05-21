'use strict';

/**
 * Tests for benchmarkEligibility.service — Workstream C2, the Layer-4 gate.
 *
 * Both consent dependencies are mocked; the test pins the deterministic
 * AND-of-two-conditions logic and the fail-closed posture.
 */

jest.mock('../src/services/consent.service', () => ({ hasConsent: jest.fn() }));
jest.mock('../src/services/organizationConsent.service', () => ({
  isBenchmarkingOptedOut: jest.fn(),
}));

const consentService = require('../src/services/consent.service');
const organizationConsent = require('../src/services/organizationConsent.service');
const gate = require('../src/services/benchmarkEligibility.service');

const ORG_ID = 'org-1';
const USER_ID = 'user-1';

beforeEach(() => {
  jest.clearAllMocks();
});

let warnSpy;
beforeAll(() => {
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => {
  warnSpy.mockRestore();
});

describe('evaluateEligibility', () => {
  test('eligible when the user consented and the org has not opted out', async () => {
    consentService.hasConsent.mockResolvedValue(true);
    organizationConsent.isBenchmarkingOptedOut.mockResolvedValue(false);

    const result = await gate.evaluateEligibility({ organizationId: ORG_ID, userId: USER_ID });

    expect(result.included_in_aggregate).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.org_opted_out).toBe(false);
    expect(result.user_consented).toBe(true);
    // The gate checks the correct per-user consent purpose.
    expect(consentService.hasConsent).toHaveBeenCalledWith(USER_ID, 'anonymized_benchmarking');
  });

  test('not eligible when the org has opted out — even with user consent', async () => {
    consentService.hasConsent.mockResolvedValue(true);
    organizationConsent.isBenchmarkingOptedOut.mockResolvedValue(true);

    const result = await gate.evaluateEligibility({ organizationId: ORG_ID, userId: USER_ID });

    expect(result.included_in_aggregate).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/organization has opted out/i);
  });

  test('not eligible when the user has not granted consent', async () => {
    consentService.hasConsent.mockResolvedValue(false);
    organizationConsent.isBenchmarkingOptedOut.mockResolvedValue(false);

    const result = await gate.evaluateEligibility({ organizationId: ORG_ID, userId: USER_ID });

    expect(result.included_in_aggregate).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/has not granted/i);
  });

  test('lists both blockers when neither condition holds', async () => {
    consentService.hasConsent.mockResolvedValue(false);
    organizationConsent.isBenchmarkingOptedOut.mockResolvedValue(true);

    const result = await gate.evaluateEligibility({ organizationId: ORG_ID, userId: USER_ID });

    expect(result.included_in_aggregate).toBe(false);
    expect(result.reasons).toHaveLength(2);
  });

  test('fails closed (not eligible) when a dependency throws', async () => {
    consentService.hasConsent.mockRejectedValue(new Error('db down'));
    organizationConsent.isBenchmarkingOptedOut.mockResolvedValue(false);

    const result = await gate.evaluateEligibility({ organizationId: ORG_ID, userId: USER_ID });

    expect(result.included_in_aggregate).toBe(false);
    expect(result.org_opted_out).toBeNull();
    expect(result.user_consented).toBeNull();
    expect(result.reasons[0]).toMatch(/could not be determined/i);
  });
});
