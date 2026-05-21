'use strict';

/**
 * Benchmark-eligibility gate — Workstream C2.
 *
 * The deterministic gate from docs/DATA_GOVERNANCE.md §3 (Layer 4) and §4
 * (invariant 3): no deal data — even de-identified — enters the anonymized
 * cross-tenant benchmark layer unless BOTH conditions hold:
 *
 *   1. The contributing user holds a current granted `anonymized_benchmarking`
 *      consent (per-user, DPDP §6 — `user_consents`, shipped 20260607).
 *   2. The owning organization has NOT engaged the org-level "do not
 *      benchmark" opt-out (`organization_consents`, this workstream).
 *
 * This module is the single server-side place that decides eligibility, so
 * the gate cannot be partially applied. It is pure rule logic — no AI, no
 * heuristics — exactly the deterministic-decision posture CLAUDE.md mandates.
 *
 * Per the plan, C2 ships the gate, not the statistics: the k-anonymity
 * benchmark queries (C4) are a separate, later workstream. This function is
 * the foundation they will call.
 *
 * Fail-closed: if eligibility cannot be determined (an unexpected error),
 * the result is `included_in_aggregate: false`. A privacy gate that cannot
 * verify consent must assume there is none.
 */

const consentService = require('./consent.service');
const organizationConsent = require('./organizationConsent.service');
const log = require('../lib/logger').child({ module: 'benchmarkEligibility.service' });

// The per-user consent purpose that gates benchmark contribution.
const BENCHMARK_CONSENT_PURPOSE = 'anonymized_benchmarking';

/**
 * Evaluate whether a (organization, user) pair's deal data is currently
 * eligible to contribute a row to the anonymized benchmark layer.
 *
 * Eligibility is always computed live — never read from a stored flag — so a
 * withdrawn consent or a newly-engaged org opt-out takes effect immediately
 * (DATA_GOVERNANCE invariant 4: withdrawal is retroactive).
 *
 * @param {object} input
 * @param {string} input.organizationId  the deal's owning organisation.
 * @param {string} input.userId          the contributing user (e.g. the
 *                                        deal's creator).
 * @returns {Promise<{
 *   included_in_aggregate: boolean,
 *   org_opted_out: boolean|null,
 *   user_consented: boolean|null,
 *   reasons: string[],
 * }>}  reasons lists the blockers; it is empty exactly when eligible.
 */
const evaluateEligibility = async ({ organizationId = null, userId = null } = {}) => {
  try {
    const [orgOptedOut, userConsented] = await Promise.all([
      organizationConsent.isBenchmarkingOptedOut(organizationId),
      consentService.hasConsent(userId, BENCHMARK_CONSENT_PURPOSE),
    ]);

    const reasons = [];
    if (orgOptedOut) {
      reasons.push('The organization has opted out of contributing to market benchmarks.');
    }
    if (!userConsented) {
      reasons.push('The contributing user has not granted anonymized-benchmarking consent.');
    }

    return {
      included_in_aggregate: reasons.length === 0,
      org_opted_out: orgOptedOut,
      user_consented: userConsented,
      reasons,
    };
  } catch (err) {
    // Fail-closed — a gate that cannot verify consent must assume there is none.
    log.warn('benchmark_eligibility_evaluation_failed', { error: err.message });
    return {
      included_in_aggregate: false,
      org_opted_out: null,
      user_consented: null,
      reasons: ['Eligibility could not be determined; treated as not eligible.'],
    };
  }
};

module.exports = {
  BENCHMARK_CONSENT_PURPOSE,
  evaluateEligibility,
};
