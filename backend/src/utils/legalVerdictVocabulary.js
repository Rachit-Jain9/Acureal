'use strict';

/**
 * The vocabulary of a statutory verdict — Karnataka edition.
 *
 * CLAUDE.md's hardest rule: AI may never assert a statutory fact as truth on
 * the "legal four" — title chain, encumbrance status, RERA registration, and
 * statutory approval. Those four lanes are extraction and synthesis aid only;
 * conclusions belong to a human with the source documents in front of them.
 *
 * WHY THIS FILE EXISTS. The guard that enforced it recognised exactly four
 * generic English phrasings: "title is clear", "RERA-compliant", "approval will
 * be granted", and a guarantee catch-all. Acureal is an India-first,
 * Bengaluru-priority product, and an Indian deal document does not talk like
 * that. Every one of these sailed straight through to the customer:
 *
 *     "The A-khata is valid and the EC is nil."
 *     "DC conversion is complete; the land is converted."
 *     "Mutation is done and the RTC is clean."
 *     "Akrama-Sakrama regularisation has been granted."
 *     "The project is registered under K-RERA."
 *     "OC has been received from BBMP."
 *
 * Each is a statutory conclusion stated as fact, in the vocabulary the domain
 * actually uses. The guard was blind to the entire local register.
 *
 * WHY IT IS ITS OWN MODULE. This vocabulary is a DOMAIN concern, shared by the
 * Deal Doctor's tone classifier and the prose scrubber that runs over
 * deal-analysis, doc-insights, IC exports and deal Q&A. It previously lived
 * inside `services/ai/toneClassifier`, which forced `utils/aiLegalProseGuard`
 * to import upward from a util into a service. One definition, one home, no
 * inverted dependency.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE HARD PART IS NOT THE VOCABULARY — IT IS NOT DESTROYING THE PRODUCT.
 *
 * "Verify that the khata is valid" and "The khata is valid" share every
 * keyword. The first is precisely the diligence guidance Acureal exists to
 * give; the second is the verdict it must never state. A keyword guard cannot
 * tell them apart, and a guard that strips both would quietly gut the most
 * useful prose on the platform while looking like it was working.
 *
 * So matching is two-stage: a lane pattern must match, AND the text preceding
 * the match within that sentence must not be an instruction, a question, or a
 * statement of absence. That check is structural rather than another regex
 * layer, which keeps each lane pattern readable and keeps the suppression rule
 * in exactly one place.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Pure deterministic JS. No AI, no I/O, never throws.
 */

// Text that, when it appears BEFORE a match in the same sentence, means the
// sentence is asking for the status rather than asserting it. This is the
// difference between the product working and the product being censored.
//
// Deliberately NOT included: reported speech ("the vendor represents that title
// is clear"). A reader skimming an IC memo sees the claim, not the attribution,
// and the rule is that Acureal never puts a statutory conclusion in front of a
// customer. Attribution is what the evidence ledger is for.
// An instruction only licenses the words that follow it WITHIN THE SAME CLAUSE.
//
//     "Confirm pricing since approval will be granted shortly."
//
// instructs on pricing and then states the approval as settled fact. Testing
// the whole prefix would see "Confirm" and wave the verdict through — the
// instruction governs "pricing", and "since" opens a new clause it cannot
// reach. Causal and adversative connectives break the dependency; "and"/"or"
// deliberately do NOT, because "verify the khata is valid and the EC is nil"
// is one instruction covering both.
const CLAUSE_BREAK =
  /[;–—]|\b(?:since|because|so|therefore|thus|hence|but|however|whereas|although|though|yet|while|given\s+that|as\s+a\s+result|which\s+means)\b/i;

// The last clause of `prefix` — the only part an instruction verb can govern.
// Uses split (which ignores the /g flag and has no lastIndex state) so this is
// stateless and safe to call from a hot path.
const governingClause = (prefix) => prefix.split(CLAUSE_BREAK).pop();

const INSTRUCTION_LEAD =
  /\b(?:verify|verif(?:y|ied|ication)|confirm(?:ed|ation)?|check(?:ed)?|review(?:ed)?|examine[ds]?|inspect(?:ed)?|obtain(?:ed|ing)?|procure[ds]?|secure[ds]?|request(?:ed)?|seek|ensure|establish(?:ed)?|determine[ds]?|ascertain(?:ed)?|validate[ds]?|reconcile[ds]?|assess(?:ed)?|whether|if|unless|until|before|prior\s+to|subject\s+to|conditional\s+(?:on|upon)|contingent\s+(?:on|upon)|pending|awaited?|awaiting|require[ds]?|need(?:s|ed)?\s+to\s+be|must\s+be|should\s+be|to\s+be\s+(?:confirmed|verified|established|obtained)|not\s+yet|unverified|unconfirmed|no\s+evidence|without\s+evidence|unable\s+to|cannot|could\s+not|missing|absent|unknown|unclear|assum(?:e|ed|ption)|recommend(?:ed|s)?|consider|re-?examine|flag(?:ged)?|stress-?test|diligence|request|query|question)\b/i;

/**
 * Every rule is `{ id, lane, pattern }`.
 *
 *   id    — stable, greppable, safe to reference from a test or a log line.
 *   lane  — which of the legal four it belongs to, so telemetry can show
 *           WHICH statutory lane a model keeps drifting into.
 *
 * Patterns intentionally allow an optional negation ("title is NOT clear").
 * A negative statutory conclusion is still a statutory conclusion, and coming
 * from an AI narrator about a counterparty's asset it is the more damaging of
 * the two.
 */
const LEGAL_ASSERTION_RULES = [
  // ── Lane 1: title chain ──────────────────────────────────────────────────
  {
    id: 'title_status',
    lane: 'title',
    pattern: /\btitle\s+(?:is|was|are|remains?|appears?\s+to\s+be|has\s+been)\s+(?:not\s+)?(?:clear|clean|marketable|good|perfect|absolute|valid|undisputed|unencumbered|in\s+order)\b/i,
  },
  {
    id: 'title_marketable',
    lane: 'title',
    pattern: /\b(?:clear\s+and\s+marketable|marketable\s+and\s+clear)\s+title\b/i,
  },
  {
    id: 'title_chain_complete',
    lane: 'title',
    pattern: /\b(?:title\s+chain|chain\s+of\s+title|mother\s+deed|link\s+documents?)\s+(?:is|are|was|has\s+been)\s+(?:not\s+)?(?:complete|unbroken|clean|clear|intact|valid|verified|established|in\s+order)\b/i,
  },
  {
    id: 'ownership_established',
    lane: 'title',
    pattern: /\b(?:ownership|possession)\s+(?:is|was|has\s+been)\s+(?:not\s+)?(?:clear|established|undisputed|verified|proven|peaceful|settled|valid)\b/i,
  },
  {
    id: 'khata_valid',
    lane: 'title',
    // Khata (BBMP property record). "A-khata" as a classification is an
    // extraction; "the khata is valid / in order / genuine" is a verdict.
    pattern: /\b(?:a[\s-]?khata|b[\s-]?khata|khata|katha|e[\s-]?khata|e[\s-]?aasthi)\s+(?:is|was|has\s+been|stands?)\s+(?:not\s+)?(?:valid|clear|clean|genuine|in\s+order|transferred|updated|regularis|regulariz|converted|obtained|issued)/i,
  },
  {
    id: 'khata_valid_attributive',
    lane: 'title',
    pattern: /\b(?:has|holds?|carries|possesses)\s+(?:a\s+)?(?:valid|clean|clear|genuine)\s+(?:a[\s-]?khata|b[\s-]?khata|khata|katha|e[\s-]?khata)\b/i,
  },
  {
    id: 'revenue_record_clean',
    lane: 'title',
    // RTC / Pahani (Record of Rights, Tenancy & Crops) and mutation entries.
    pattern: /\b(?:rtc|pahani|mutation|m\.?r\.?\s?no|record\s+of\s+rights)\s+(?:is|are|was|has\s+been)\s+(?:not\s+)?(?:clear|clean|complete|done|effected|updated|valid|in\s+order|reflected|current)\b/i,
  },
  {
    id: 'survey_settled',
    lane: 'title',
    pattern: /\b(?:survey|podi|phodi|11\s?e\s+sketch|tippani|akarband)\s+(?:is|was|has\s+been)\s+(?:not\s+)?(?:clear|settled|complete|done|matched|verified|valid|obtained|in\s+order)\b/i,
  },
  {
    id: 'no_litigation',
    lane: 'title',
    pattern: /\b(?:no|nil|zero)\s+(?:pending\s+)?(?:litigation|litigations|disputes?|court\s+cases?|legal\s+proceedings?|claims?)\b|\b(?:litigation[\s-]free|dispute[\s-]free|free\s+from\s+(?:litigation|disputes?|claims?))\b/i,
  },
  {
    id: 'tenure_restriction_clear',
    lane: 'title',
    // PTCL (Prevention of Transfer of Certain Lands Act), Inam, grant lands,
    // acquisition — the Karnataka tenure traps that kill a deal outright.
    pattern: /\b(?:not\s+|free\s+from\s+|no\s+)(?:ptcl|inam|grant\s+land|acquisition|land\s+acquisition|tenancy\s+claims?|darkhast)\b|\b(?:ptcl|inam|acquisition)\s+(?:is|was|has\s+been)\s+(?:not\s+)?(?:clear|cleared|resolved|inapplicable|not\s+applicable)\b/i,
  },

  // ── Lane 2: encumbrance ──────────────────────────────────────────────────
  {
    id: 'ec_nil',
    lane: 'encumbrance',
    pattern: /\b(?:ec|e\.c\.|encumbrance\s+certificate)\s+(?:is|was|are|shows?|reflects?|reveals?|has\s+been|discloses?)\s+(?:not\s+)?(?:nil|clear|clean|blank|negative|free|empty)\b/i,
  },
  {
    id: 'no_encumbrance',
    lane: 'encumbrance',
    pattern: /\b(?:nil|no|zero)\s+encumbrances?\b|\b(?:free\s+(?:from|of)\s+(?:all\s+)?(?:encumbrances?|charges?|liens?|mortgages?|attachments?))\b|\bis\s+(?:not\s+)?unencumbered\b/i,
  },
  {
    id: 'no_charges',
    lane: 'encumbrance',
    pattern: /\b(?:no|nil)\s+(?:existing\s+)?(?:charges?|liens?|mortgages?|attachments?|hypothecations?)\s+(?:exist|are\s+registered|on\s+(?:the\s+)?(?:property|land|title))?\b/i,
  },

  // ── Lane 3: RERA registration ────────────────────────────────────────────
  {
    id: 'rera_status',
    lane: 'rera',
    pattern: /\b(?:k[\s-]?rera|rera)[\s-]?(?:compliant|registered|approved|valid|certified|cleared|sanctioned)\b/i,
  },
  {
    id: 'rera_registration_valid',
    lane: 'rera',
    pattern: /\brera\s+(?:registration|number|certificate|approval)\s+(?:is|was|remains?|has\s+been)\s+(?:not\s+)?(?:valid|active|current|in\s+force|subsisting|obtained|granted|clear)\b/i,
  },
  {
    id: 'registered_under_rera',
    lane: 'rera',
    pattern: /\b(?:is|was|has\s+been|stands?)\s+(?:duly\s+)?registered\s+(?:under|with)\s+(?:the\s+)?(?:k[\s-]?rera|rera|real\s+estate\s+regulatory)/i,
  },

  // ── Lane 4: statutory approval ───────────────────────────────────────────
  {
    id: 'approval_granted',
    lane: 'approval',
    pattern: /\b(?:approval|sanction|permission|licence|license|clearance)s?\s+(?:will\s+be|is|are|was|were|has\s+been|have\s+been)\s+(?:not\s+)?(?:granted|approved|certain|assured|obtained|received|issued|in\s+place|secured|forthcoming)\b/i,
  },
  {
    id: 'plan_sanctioned',
    lane: 'approval',
    pattern: /\b(?:building\s+plan|layout\s+plan|plan|layout)\s+(?:is|was|has\s+been)\s+(?:not\s+)?(?:sanctioned|approved|cleared|passed)\b/i,
  },
  {
    id: 'authority_approved',
    lane: 'approval',
    // The Bengaluru authority alphabet: BBMP, BDA, BMRDA, BIAAPA, GBA, KIADB,
    // Panchayat, plus the plan-sanctioning verbs they issue.
    pattern: /\b(?:bbmp|bda|bmrda|biaapa|gba|kiadb|bwssb|kspcb|panchayat|town\s+planning|tpa)\s+(?:has\s+)?(?:approved|sanctioned|cleared|permitted|issued)\b/i,
  },
  {
    id: 'certificate_obtained',
    lane: 'approval',
    // OC / CC / completion — the certificates that decide whether a building
    // may legally be occupied or sold.
    pattern: /\b(?:oc|o\.c\.|cc|c\.c\.|occupancy\s+certificate|commencement\s+certificate|completion\s+certificate|khata\s+certificate)\s+(?:is|was|has\s+been)\s+(?:not\s+)?(?:received|obtained|issued|granted|in\s+place|available|secured)\b/i,
  },
  {
    id: 'conversion_complete',
    lane: 'approval',
    // DC conversion — agricultural to non-agricultural. The single most
    // common Karnataka approval assertion, and a deal-killer when wrong.
    pattern: /\b(?:dc\s+conversion|land\s+conversion|conversion(?:\s+order)?)\s+(?:is|was|has\s+been)\s+(?:not\s+)?(?:done|complete|completed|obtained|granted|valid|in\s+place|effected|approved)\b/i,
  },
  {
    id: 'land_is_converted',
    lane: 'approval',
    pattern: /\b(?:land|property|site|parcel)\s+(?:is|was|has\s+been)\s+(?:not\s+)?(?:duly\s+)?converted\b|\bconverted\s+(?:land|property)\s+(?:is|was)\s+(?:not\s+)?(?:valid|in\s+order)\b/i,
  },
  {
    id: 'noc_obtained',
    lane: 'approval',
    pattern: /\b(?:noc|n\.o\.c\.|no\s+objection\s+certificate)s?\s+(?:is|are|was|were|has\s+been|have\s+been)\s+(?:not\s+)?(?:obtained|received|granted|issued|in\s+place|secured)\b/i,
  },
  {
    id: 'regularisation_granted',
    lane: 'approval',
    // Akrama-Sakrama — regularisation of unauthorised construction.
    pattern: /\b(?:akrama[\s-]?sakrama|akrama|sakrama|regularisation|regularization)\s+(?:is|was|has\s+been)\s+(?:not\s+)?(?:granted|approved|complete|completed|done|obtained|valid)\b/i,
  },
  {
    id: 'zoning_compliant',
    lane: 'approval',
    pattern: /\b(?:zoning|land\s+use|land[\s-]use)\s+(?:is|was)\s+(?:not\s+)?(?:fully\s+)?(?:compliant|permitted|permissible|approved|in\s+order)\b/i,
  },

  // ── Cross-lane: guarantees ───────────────────────────────────────────────
  {
    id: 'guarantee',
    lane: 'guarantee',
    pattern: /\b(?:guarantee[ds]?|warrant[ds]?|assure[ds]?)\b[^.]{0,50}\b(?:returns?|outcome|approval|title|rera|profit|clearance|sanction)\b/i,
  },
];

/**
 * Find the first statutory assertion in a single sentence.
 *
 * @param {string} sentence
 * @returns {{ id: string, lane: string, matched: string } | null}
 */
const findLegalAssertion = (sentence) => {
  if (typeof sentence !== 'string' || sentence.length === 0) return null;

  for (const rule of LEGAL_ASSERTION_RULES) {
    const match = rule.pattern.exec(sentence);
    // Patterns are non-global, so lastIndex never advances — but resetting is
    // cheap insurance against a future edit adding a /g flag and turning this
    // into an intermittent miss, which is the worst possible failure for a
    // security-shaped guard.
    rule.pattern.lastIndex = 0;
    if (!match) continue;

    // The same words in an instruction, a question, or a statement of absence
    // are the diligence guidance this product exists to give. Only what
    // precedes the claim — in the same clause — can distinguish them.
    if (INSTRUCTION_LEAD.test(governingClause(sentence.slice(0, match.index)))) continue;

    return { id: rule.id, lane: rule.lane, matched: match[0] };
  }
  return null;
};

/** True when the sentence states a statutory conclusion as fact. */
const assertsLegalStatus = (sentence) => findLegalAssertion(sentence) !== null;

// Back-compatible view for callers that only need the raw patterns. Kept so
// `toneClassifier` can continue to export `LEGAL_VERDICT_PATTERNS` unchanged.
// Prefer `findLegalAssertion` — the bare patterns have no instruction-lead
// suppression and will flag "verify the khata is valid".
const LEGAL_VERDICT_PATTERNS = LEGAL_ASSERTION_RULES.map((rule) => rule.pattern);

const LEGAL_LANES = Object.freeze(['title', 'encumbrance', 'rera', 'approval', 'guarantee']);

module.exports = {
  LEGAL_ASSERTION_RULES,
  LEGAL_VERDICT_PATTERNS,
  LEGAL_LANES,
  INSTRUCTION_LEAD,
  CLAUSE_BREAK,
  governingClause,
  findLegalAssertion,
  assertsLegalStatus,
};
