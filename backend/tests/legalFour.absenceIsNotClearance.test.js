'use strict';

/**
 * "Absence is not clearance" — the regression suite for a defect this product
 * shipped to real investment committees.
 *
 * In August 2026 four IC memos sat in the production `ai_artifacts` table. Two
 * of them told the committee, in the section headed **Required Approvals**:
 *
 *     "All required approvals have been received."
 *     "All required approvals are received."
 *
 * The deals behind them held ZERO approval rows. A third listed six named
 * approvals — Fire NOC, DC Conversion Order, BESCOM, BWSSB, Environment
 * Clearance, Sanctioned Building Plan — under a heading "Received:", against a
 * database in which no approval row has ever carried that status. The word is
 * not even in the vocabulary (pending / in_progress / validated / issue /
 * expired). Every approval row in production, all 33 of them, is `pending`.
 *
 * Three independent failures had to line up, and each gets tests here:
 *
 *   1. THE GUARD HAD A HOLE. `INSTRUCTION_LEAD` carried a bare `require[ds]?`,
 *      meant for "title chain REQUIRES verification". It also matched the
 *      adjective in "REQUIRED approvals" — so the suppressor read
 *      "All required " as diligence guidance and let the verdict through.
 *      `requisite` and `needed` were caught; only `required` was blind, which
 *      is the phrasing the memo's own section heading uses.
 *
 *   2. NOTHING CALLED THE GUARD. icMemo applied the stance-verb neutraliser
 *      alone; inconsistencyDetector persisted raw model markdown. Both reach
 *      the LP-facing tear-sheet PDF.
 *
 *   3. THE PROMPT REWARDED THE FABRICATION. It said "if everything closed, say
 *      so" and handed the model an empty array with nothing to distinguish
 *      "nothing recorded" from "nothing outstanding".
 */

const {
  findLegalAssertion,
  INSTRUCTION_LEAD,
  governingClause,
} = require('../src/utils/legalVerdictVocabulary');
const { sanitizeAiProse, LEGAL_REDACTION_MARKER } = require('../src/utils/aiLegalProseGuard');

// ── 1. The hole in the suppressor ───────────────────────────────────────────

describe('adjectival "required" no longer licenses a statutory verdict', () => {
  // Verbatim from the production artifacts.
  test.each([
    ['All required approvals have been received.', 'approval_granted'],
    ['All required approvals are received.', 'approval_granted'],
    ['The required NOCs are obtained.', 'noc_obtained'],
    ['Required clearances have been granted.', 'approval_granted'],
    ['The required building plan is sanctioned.', 'plan_sanctioned'],
    ['All required permissions are in place.', 'approval_granted'],
  ])('caught: %s', (sentence, expectedId) => {
    const found = findLegalAssertion(sentence);
    expect(found).not.toBeNull();
    expect(found.id).toBe(expectedId);
  });

  test('the sibling phrasings that were always caught still are', () => {
    // These two worked before the fix. Their asymmetry with "required" is what
    // proved the hole was an accident rather than a judgement call.
    expect(findLegalAssertion('All requisite approvals are in place.')).not.toBeNull();
    expect(findLegalAssertion('The needed approvals have been received.')).not.toBeNull();
  });

  test('the suppressor no longer fires on the bare adjective', () => {
    expect(INSTRUCTION_LEAD.test(governingClause('All required '))).toBe(false);
  });
});

describe('the instruction senses of "require" still suppress', () => {
  // The whole point of the suppressor: diligence guidance must survive. A guard
  // that strips "verify the khata is valid" guts the product while looking like
  // it works.
  test.each([
    'Title chain requires verification against the mother deed.',
    'This requires approval from BBMP before the LOI is released.',
    'The khata is required to be validated before closing.',
    'A fresh EC is required to be obtained for the full 30-year period.',
    'Confirmation that the approval has been granted is required.',
    // Instruction lead wins even over the newly-caught phrasing.
    'Verify whether all required approvals have been received.',
    'Confirm the required NOCs are obtained before disbursement.',
    'Flag that the required RERA registration is not yet on file.',
  ])('survives: %s', (sentence) => {
    expect(findLegalAssertion(sentence)).toBeNull();
  });
});

// ── 2. The guard actually runs on the artifact path ─────────────────────────

describe('sanitizeAiProse redacts the production memo text', () => {
  test('the Required Approvals fabrication is replaced with the marker', () => {
    const memo = [
      '## 7. Required Approvals',
      'All required approvals have been received.',
    ].join('\n');
    const result = sanitizeAiProse(memo);

    expect(result.legalRemoved).toBe(1);
    expect(result.legalLanes).toContain('approval');
    expect(result.text).toContain(LEGAL_REDACTION_MARKER);
    expect(result.text).not.toContain('approvals have been received');
    // The heading is prose, not a verdict — it must survive, or the memo's
    // structure collapses.
    expect(result.text).toContain('## 7. Required Approvals');
  });

  test('re-running the guard is a no-op — safe to apply on read and on write', () => {
    // The read path re-guards rows written before the guard existed, so the
    // two applications must compose. The redaction marker itself must not
    // contain anything the vocabulary would match.
    const once = sanitizeAiProse('All required approvals have been received.').text;
    const twice = sanitizeAiProse(once);
    expect(twice.text).toBe(once);
    expect(twice.legalRemoved).toBe(0);
  });

  test('a legitimately-pending approval line is untouched', () => {
    const text = 'Fire NOC — recorded status: pending. RERA Karnataka Registration — recorded status: pending.';
    const result = sanitizeAiProse(text);
    expect(result.legalRemoved).toBe(0);
    expect(result.text).toBe(text);
  });
});

// ── 3. Absence is not clearance ─────────────────────────────────────────────

describe('the deterministic diligence posture distinguishes unrecorded from settled', () => {
  const { __buildDiligencePostureForTests: build } = require('../src/services/icMemo.service');

  test('an EMPTY register reports recorded:false, not a clean bill', () => {
    // Jaraka Bande / Kaval: 0 dd_items, 0 approval_items. The memo said
    // "All required approvals are received."
    const posture = build([], []);
    expect(posture.ddItems.recorded).toBe(false);
    expect(posture.approvals.recorded).toBe(false);
    expect(posture.ddItems.total).toBe(0);
    expect(posture.approvals.total).toBe(0);
    // Nothing in the block can be read as "satisfied".
    expect(posture.approvals.validated).toBe(0);
    expect(posture.ddItems.completed).toBe(0);
  });

  test('a fully-pending register is recorded but wholly outstanding', () => {
    // Hopefarm Junction: 21 dd_items, none completed, 0 approvals.
    const dd = Array.from({ length: 21 }, () => ({ status: 'pending', is_required: true }));
    const posture = build(dd, []);
    expect(posture.ddItems.recorded).toBe(true);
    expect(posture.ddItems.total).toBe(21);
    expect(posture.ddItems.completed).toBe(0);
    expect(posture.ddItems.outstanding).toBe(21);
    expect(posture.ddItems.blockers).toBe(21);
  });

  test('counts follow each row\'s own status, never a generalisation', () => {
    // Jigani: 21 dd_items with 4 completed; 11 approvals, all pending.
    const dd = [
      ...Array.from({ length: 4 }, () => ({ status: 'completed', is_required: true })),
      ...Array.from({ length: 15 }, () => ({ status: 'pending', is_required: true })),
      { status: 'not_applicable', is_required: true },
      { status: 'flagged', is_required: false },
    ];
    const approvals = Array.from({ length: 11 }, () => ({ status: 'pending' }));
    const posture = build(dd, approvals);

    expect(posture.ddItems.total).toBe(21);
    expect(posture.ddItems.completed).toBe(4);
    // not_applicable is settled; flagged is open.
    expect(posture.ddItems.outstanding).toBe(16);
    // The flagged row is not required, so it is open but not a blocker.
    expect(posture.ddItems.blockers).toBe(15);

    expect(posture.approvals.recorded).toBe(true);
    expect(posture.approvals.total).toBe(11);
    expect(posture.approvals.validated).toBe(0);
    expect(posture.approvals.outstanding).toBe(11);
  });

  test('only "validated" settles an approval — the invented statuses do not', () => {
    // "received" is the word the model used. It is not a status this system
    // stores, so it must count as outstanding rather than silently settle.
    const posture = build([], [
      { status: 'validated' },
      { status: 'received' },
      { status: 'issue' },
      { status: 'expired' },
    ]);
    expect(posture.approvals.validated).toBe(1);
    expect(posture.approvals.outstanding).toBe(3);
  });

  test('null / undefined registers degrade to unrecorded, never to clear', () => {
    for (const posture of [build(null, undefined), build(undefined, null)]) {
      expect(posture.ddItems.recorded).toBe(false);
      expect(posture.approvals.recorded).toBe(false);
    }
  });
});

// ── The prompt carries the rule the model broke ─────────────────────────────

describe('the IC memo prompt states the rule explicitly', () => {
  const { SYSTEM_PROMPT } = require('../src/services/icMemo.service');

  test('absence-is-not-clearance is spelled out', () => {
    expect(SYSTEM_PROMPT).toMatch(/ABSENCE IS NOT CLEARANCE/);
    expect(SYSTEM_PROMPT).toMatch(/empty list means UNRECORDED, never SATISFIED/i);
  });

  test('the forbidden statutory status words are named', () => {
    // The exact words the production memos used.
    expect(SYSTEM_PROMPT).toMatch(/"Received", "obtained", "granted", "secured" and "in place" are forbidden/);
  });

  test('the legal-four rule is present and permits diligence instructions', () => {
    expect(SYSTEM_PROMPT).toMatch(/NEVER state a statutory conclusion as fact/);
    expect(SYSTEM_PROMPT).toMatch(/instruct the reader to verify, confirm, obtain or flag/);
  });
});
