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

// ── "required" is an ADJECTIVE far more often than an instruction ───────────
//
// This list used to carry a bare `require[ds]?`, intended for the instruction
// sense ("title chain REQUIRES verification"). It also matched the adjective in
// "REQUIRED approvals" — and that one word held the door open for the single
// most common statutory sentence in Indian real-estate prose:
//
//     "All required approvals have been received."
//
// The pattern matched it. The suppressor then read the governing clause
// ("All required "), saw `required`, and classified an unqualified statutory
// verdict as diligence guidance. Every surface that calls this guard waved it
// through. Found in FOUR live production IC memos in 2026-08, on deals whose
// records held ZERO approval rows — the model read an empty list as "all
// clear" and the guard read "required" as "asking, not asserting".
//
// The tell that it was an accident, not a judgement: `requisite approvals are
// in place` and `the needed approvals have been received` were both caught.
// Only `required` — the phrasing the product's own section heading uses
// ("## 7. Required Approvals") — was blind.
//
// So `require` now suppresses in its VERB senses only. "require"/"requires"
// cannot be adjectival; "is/are/was/were required" and "required to be" are
// unambiguously instructions. Bare adjectival "required <noun>" no longer
// licenses whatever follows it. The narrowing is deliberately asymmetric: a
// rare stilted false positive ("it is required that the title is clear") costs
// a redaction marker, while the false negative it replaces shipped a fabricated
// statutory fact into an investment committee's decision document.
const INSTRUCTION_LEAD =
  /\b(?:verify|verif(?:y|ied|ication)|confirm(?:ed|ation)?|check(?:ed)?|review(?:ed)?|examine[ds]?|inspect(?:ed)?|obtain(?:ed|ing)?|procure[ds]?|secure[ds]?|request(?:ed)?|seek|ensure|establish(?:ed)?|determine[ds]?|ascertain(?:ed)?|validate[ds]?|reconcile[ds]?|assess(?:ed)?|whether|if|unless|until|before|prior\s+to|subject\s+to|conditional\s+(?:on|upon)|contingent\s+(?:on|upon)|pending|awaited?|awaiting|requires?|(?:is|are|was|were)\s+required|required\s+to\s+be|need(?:s|ed)?\s+to\s+be|must\s+be|should\s+be|to\s+be\s+(?:confirmed|verified|established|obtained)|not\s+yet|unverified|unconfirmed|no\s+evidence|without\s+evidence|unable\s+to|cannot|could\s+not|missing|absent|unknown|unclear|assum(?:e|ed|ption)|recommend(?:ed|s)?|consider|re-?examine|flag(?:ged)?|stress-?test|diligence|request|query|question)\b/i;

// ─────────────────────────────────────────────────────────────────────────────
// SHARED GRAMMATICAL SLOTS
//
// The 2026-08-08 audit repeated the `required` lesson from #1100 in a new key:
// the rules matched the CANONICAL phrasing of a verdict and missed its natural
// variants. Measured against the live guard:
//
//     CAUGHT  "Title is clear."
//     CAUGHT  "The title is clean."
//     MISSED  "Title in this belt is generally clean."      ← adverb
//     MISSED  "Titles in this micro-market are typically clean."  ← plural
//     MISSED  "The land has a clear title."                 ← attributive
//
// Every rule had hand-written its own `(?:not\s+)?` slot, so widening meant
// editing twenty-five regexes consistently — which is exactly how a guard
// develops a hole. The three shapes are now GRAMMAR, declared once here and
// spliced into every lane pattern:
//
//   ADVERB     — an adverb may sit between the copula and the adjective.
//   copula()   — the linking verb itself, with an ADVERB slot on both sides of
//                a passive `been` ("have ALREADY BEEN received").
//   QUALIFIER  — a short prepositional phrase may sit between the subject and
//                the copula.
//   HELD       — a possession verb turns an attributive adjective into a claim.
//
// Each is a CLOSED list, not a wildcard. `.{0,40}` would have caught all three
// shapes in one line and been catastrophic: over-redaction shreds legitimate
// diligence prose and devalues the redaction marker, and the marker meaning
// something is the whole legal-four defence.

/** Tagged template that splices the slots below into a case-insensitive rule. */
const rx = (parts, ...slots) => new RegExp(String.raw(parts, ...slots), 'i');

// "is NOT clear" / "is GENERALLY clean" / "is DULY registered". Replaces the
// per-rule `(?:not\s+)?`, `(?:duly\s+)?` and `(?:fully\s+)?` slots.
//
// Deliberately ABSENT: `yet`. "The title is not yet clear" is honest hedging
// about an open item, not a verdict, and it must keep sailing through — the
// `not\s+yet` entry in INSTRUCTION_LEAD only helps when it sits in the PREFIX,
// and here it would sit inside the match. `still` IS present, because it
// attaches to the adjective ("is still clear" is a verdict) rather than to the
// unresolvedness; "is still pending / still awaited / still under review" stay
// safe because those words are not in any lane's adjective set.
//
// Deliberately PRESENT: `reportedly` / `purportedly` / `apparently`. A hedged
// verdict is still a verdict — the file's stated position on reported speech.
const ADVERB = String.raw`(?:(?:not|no\s+longer|generally|typically|usually|normally|ordinarily|broadly|largely|mostly|essentially|substantially|materially|entirely|fully|wholly|completely|perfectly|apparently|evidently|manifestly|clearly|plainly|reasonably|relatively|comparatively|duly|already|now|currently|presently|still|therefore|indeed|certainly|definitely|absolutely|effectively|otherwise|reportedly|purportedly|prima\s+facie)\s+){0,2}`;

// The copula, with an adverb slot on BOTH sides of the passive participle.
//
// "All required approvals HAVE BEEN received" is the sentence #1100 found in
// four live IC memos. "All required approvals HAVE ALREADY BEEN received" is
// the same claim with one word inserted, and a hand-written `has\s+been`
// alternation cannot see it. Declaring the copula once is what stops the next
// adverb from reopening the hole in one lane while the others stay closed.
//
// `extraVerbs` carries the lane-specific linking verbs — the encumbrance lane's
// "the EC SHOWS nil" has no counterpart in the title lane.
const copula = (extraVerbs = '') =>
  String.raw`\s+(?:will\s+be|is|are|was|were|has|have|had|remains?|appears?\s+to\s+be|stands?${extraVerbs})\s+${ADVERB}(?:been\s+${ADVERB})?`;

// "title IN THIS BELT is clean" / "titles ACROSS THE MICRO-MARKET are clean" /
// "the EC FOR THE LAST 30 YEARS is nil".
//
// Bounded to ONE prepositional phrase, at most four words, from a closed
// preposition set, containing no punctuation — so it can never grow into a
// span that stitches two clauses together and reports a verdict from one
// sentence half against a subject from the other. `on`/`over`/`under` are
// excluded on purpose: they produce "the impact ON TITLE is clear", where
// "clear" means "obvious" rather than "unencumbered".
const QUALIFIER = String.raw`(?:\s+(?:in|across|within|throughout|around|near|at|along|for|to|of)\s+(?:[\w'-]+\s+){0,3}[\w'-]+)?`;

// A modal or infinitive marker in front of a possession verb makes it an
// instruction, not a claim: "the buyer MUST HAVE a clear title" is guidance,
// "the land HAS a clear title" is a verdict. Same asymmetry as `requires` vs
// the adjectival `required` — the inflected form asserts, the bare form after
// a modal instructs.
const NOT_MODAL = String.raw`(?<!\b(?:must|shall|should|would|could|can|may|might|to|cannot|never)\s)`;

// The verbs that make an attributive adjective an assertion about THIS asset.
// `obtain` / `acquire` are excluded: "the buyer must obtain a clear title" is
// the diligence instruction this product exists to give.
const HELD = String.raw`${NOT_MODAL}\b(?:has|have|had|holds?|held|carries|carried|possesses|possessed|enjoys?|enjoyed|retains?|retained|conveys|conveyed|comes?\s+with|came\s+with|is\s+backed\s+by|shows|reflects|discloses|reveals|demonstrates|evidences)\b`;

// Determiners and quantifiers between the possession verb and the adjective:
// "has A clear title", "holds ALL requisite approvals".
const DET = String.raw`(?:(?:an?|the|its|their|his|her|all|both|full|complete|any)\s+){0,2}`;

// Bare `plan` has to stay in the approval lane — Indian deal prose says "the
// plan is sanctioned" and means the building plan. But once QUALIFIER let the
// subject and copula sit apart, "the BUSINESS plan for the quarter is approved"
// started matching: an IC housekeeping note redacted as a statutory verdict.
// Caught by the false-positive sweep, fixed by naming the non-statutory senses
// rather than by dropping the qualifier and losing "the building plan FOR
// BLOCK A is sanctioned". `master` is deliberately absent — a master plan being
// approved IS a statutory fact here.
const NOT_NON_STATUTORY_PLAN = String.raw`(?<!\b(?:business|financial|finance|marketing|project|execution|capital|work|action|contingency|sales|launch|growth|hiring|staffing|test|exit|disposal|treatment|remediation)\s)`;

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
 *
 * ORDER IS PART OF THE CONTRACT. `findLegalAssertion` returns the FIRST match,
 * and the returned `id` is asserted by tests and read by telemetry, so each
 * attributive rule sits immediately after the predicative rule it mirrors.
 */
const LEGAL_ASSERTION_RULES = [
  // ── Lane 1: title chain ──────────────────────────────────────────────────
  {
    id: 'title_status',
    lane: 'title',
    // Predicative, plural-aware, adverb-tolerant, and tolerant of a qualifier
    // between subject and copula: "TITLES IN THIS MICRO-MARKET ARE TYPICALLY
    // CLEAN" is the same verdict as "title is clear", dressed for a market
    // paragraph — and it was reaching investor DOCX untouched.
    pattern: rx`\btitles?${QUALIFIER}${copula()}(?:clear|clean|marketable|good|perfect|absolute|valid|undisputed|unencumbered|in\s+order)\b`,
  },
  {
    id: 'title_marketable',
    lane: 'title',
    // The compound legalese is a verdict on its own, with no verb needed.
    pattern: rx`\b(?:clear\s+and\s+marketable|marketable\s+and\s+clear)\s+titles?\b`,
  },
  {
    id: 'title_attributive',
    lane: 'title',
    // "The land HAS A CLEAR TITLE." Bare `clear title` is NOT enough — that
    // would redact "a clear title is a precondition for disbursement", which
    // is legitimate guidance. The possession verb is what makes it a claim
    // about this asset.
    pattern: rx`${HELD}\s+${DET}${ADVERB}(?:clear|clean|marketable|good|perfect|absolute|valid|undisputed|unencumbered)(?:\s+and\s+(?:clear|clean|marketable|good|perfect|absolute|valid|undisputed|unencumbered))?\s+titles?\b`,
  },
  {
    id: 'title_chain_complete',
    lane: 'title',
    pattern: rx`\b(?:title\s+chains?|chain\s+of\s+title|mother\s+deeds?|link\s+documents?)${QUALIFIER}${copula()}(?:complete|unbroken|clean|clear|intact|valid|verified|established|in\s+order)\b`,
  },
  {
    id: 'ownership_established',
    lane: 'title',
    pattern: rx`\b(?:ownership|possession)${QUALIFIER}${copula()}(?:clear|established|undisputed|verified|proven|peaceful|settled|valid)\b`,
  },
  {
    id: 'khata_valid',
    lane: 'title',
    // Khata (BBMP property record). "A-khata" as a classification is an
    // extraction; "the khata is valid / in order / genuine" is a verdict.
    pattern: rx`\b(?:a[\s-]?khatas?|b[\s-]?khatas?|khatas?|kathas?|e[\s-]?khatas?|e[\s-]?aasthi)${QUALIFIER}${copula()}(?:valid|clear|clean|genuine|in\s+order|transferred|updated|regularis|regulariz|converted|obtained|issued)`,
  },
  {
    id: 'khata_valid_attributive',
    lane: 'title',
    pattern: rx`${HELD}\s+${DET}${ADVERB}(?:valid|clean|clear|genuine|transferred|updated)\s+(?:a[\s-]?khatas?|b[\s-]?khatas?|khatas?|kathas?|e[\s-]?khatas?)\b`,
  },
  {
    id: 'revenue_record_clean',
    lane: 'title',
    // RTC / Pahani (Record of Rights, Tenancy & Crops) and mutation entries.
    pattern: rx`\b(?:rtcs?|pahanis?|mutations?|m\.?r\.?\s?no|records?\s+of\s+rights)${QUALIFIER}${copula()}(?:clear|clean|complete|done|effected|updated|valid|in\s+order|reflected|current)\b`,
  },
  {
    id: 'survey_settled',
    lane: 'title',
    // No QUALIFIER here on purpose: "survey" is the one ambiguous head noun in
    // the set, and "the survey OF BUYERS is complete" is a market survey, not
    // a land survey.
    pattern: rx`\b(?:surveys?|podi|phodi|11\s?e\s+sketch|tippani|akarband)${copula()}(?:clear|settled|complete|done|matched|verified|valid|obtained|in\s+order)\b`,
  },
  {
    id: 'no_litigation',
    lane: 'title',
    pattern: rx`\b(?:no|nil|zero)\s+(?:pending\s+)?(?:litigations?|disputes?|court\s+cases?|legal\s+proceedings?|claims?)\b|\b(?:litigation[\s-]free|dispute[\s-]free|free\s+from\s+(?:litigation|disputes?|claims?))\b`,
  },
  {
    id: 'tenure_restriction_clear',
    lane: 'title',
    // PTCL (Prevention of Transfer of Certain Lands Act), Inam, grant lands,
    // acquisition — the Karnataka tenure traps that kill a deal outright.
    pattern: rx`\b(?:not\s+|free\s+from\s+|no\s+)(?:ptcl|inam|grant\s+land|acquisition|land\s+acquisition|tenancy\s+claims?|darkhast)\b|\b(?:ptcl|inam|acquisition)${copula()}(?:clear|cleared|resolved|inapplicable|not\s+applicable)\b`,
  },

  // ── Lane 2: encumbrance ──────────────────────────────────────────────────
  {
    id: 'ec_nil',
    lane: 'encumbrance',
    pattern: rx`\b(?:ecs?|e\.c\.|encumbrance\s+certificates?)${QUALIFIER}${copula('|shows?|reflects?|reveals?|discloses?')}(?:nil|clear|clean|blank|negative|free|empty)\b`,
  },
  {
    id: 'ec_clear_attributive',
    lane: 'encumbrance',
    pattern: rx`${HELD}\s+${DET}${ADVERB}(?:nil|clear|clean|blank|negative)\s+(?:ecs?|e\.c\.|encumbrance\s+certificates?)\b`,
  },
  {
    id: 'no_encumbrance',
    lane: 'encumbrance',
    pattern: rx`\b(?:nil|no|zero)\s+encumbrances?\b|\b(?:free\s+(?:from|of)\s+(?:all\s+)?(?:encumbrances?|charges?|liens?|mortgages?|attachments?))\b|${copula()}unencumbered\b`,
  },
  {
    id: 'no_charges',
    lane: 'encumbrance',
    pattern: rx`\b(?:no|nil)\s+(?:existing\s+)?(?:charges?|liens?|mortgages?|attachments?|hypothecations?)\s+(?:exist|are\s+registered|on\s+(?:the\s+)?(?:property|land|title))?\b`,
  },

  // ── Lane 3: RERA registration ────────────────────────────────────────────
  {
    id: 'rera_status',
    lane: 'rera',
    pattern: rx`\b(?:k[\s-]?rera|rera)[\s-]?(?:compliant|registered|approved|valid|certified|cleared|sanctioned)\b`,
  },
  {
    id: 'rera_registration_valid',
    lane: 'rera',
    pattern: rx`\brera\s+(?:registrations?|numbers?|certificates?|approvals?)${QUALIFIER}${copula()}(?:valid|active|current|in\s+force|subsisting|obtained|granted|clear)\b`,
  },
  {
    id: 'rera_registration_attributive',
    lane: 'rera',
    pattern: rx`${HELD}\s+${DET}${ADVERB}(?:valid|active|current|subsisting|live)\s+(?:k[\s-]?rera|rera)\s+(?:registrations?|numbers?|certificates?|approvals?)\b`,
  },
  {
    id: 'registered_under_rera',
    lane: 'rera',
    // ADVERB absorbs the old `(?:duly\s+)?` slot.
    pattern: rx`${copula()}registered\s+(?:under|with)\s+(?:the\s+)?(?:k[\s-]?rera|rera|real\s+estate\s+regulatory)`,
  },

  // ── Lane 4: statutory approval ───────────────────────────────────────────
  {
    id: 'approval_granted',
    lane: 'approval',
    pattern: rx`\b(?:approvals?|sanctions?|permissions?|licences?|licenses?|clearances?)${QUALIFIER}${copula()}(?:granted|approved|certain|assured|obtained|received|issued|in\s+place|secured|forthcoming)\b`,
  },
  {
    id: 'approval_attributive',
    lane: 'approval',
    // "The project HAS A SANCTIONED BUILDING PLAN" / "the developer HOLDS ALL
    // REQUISITE APPROVALS". `required` sits in the ADJECTIVE set here, which is
    // the mirror image of #1100: there it wrongly suppressed from the prefix,
    // here it is part of what gets caught.
    pattern: rx`${HELD}\s+${DET}${ADVERB}(?:sanctioned|approved|valid|subsisting|current|statutory|requisite|required|necessary|applicable|needed)\s+(?:building\s+plans?|layout\s+plans?|plans?|layouts?|approvals?|sanctions?|permissions?|licences?|licenses?|clearances?|nocs?|occupancy\s+certificates?|commencement\s+certificates?|completion\s+certificates?|ocs?|ccs?)\b`,
  },
  {
    id: 'approval_in_hand',
    lane: 'approval',
    // The active-voice twin of the #1100 production sentence. "All required
    // approvals HAVE BEEN RECEIVED" was caught once that fix landed; "the
    // developer HAS OBTAINED all required approvals" says the same thing and
    // was not. NOT_MODAL keeps "must have obtained the OC" instructional.
    pattern: rx`${NOT_MODAL}\b(?:has|have|had)\s+${ADVERB}(?:obtained|received|secured|procured)\s+${DET}${ADVERB}(?:sanctioned|approved|valid|subsisting|current|statutory|requisite|required|necessary|applicable|needed)?\s*(?:approvals?|sanctions?|permissions?|licences?|licenses?|clearances?|nocs?|occupancy\s+certificates?|commencement\s+certificates?|completion\s+certificates?)\b`,
  },
  {
    id: 'plan_sanctioned',
    lane: 'approval',
    pattern: rx`${NOT_NON_STATUTORY_PLAN}\b(?:building\s+plans?|layout\s+plans?|plans?|layouts?)${QUALIFIER}${copula()}(?:sanctioned|approved|cleared|passed)\b`,
  },
  {
    id: 'authority_approved',
    lane: 'approval',
    // The Bengaluru authority alphabet: BBMP, BDA, BMRDA, BIAAPA, GBA, KIADB,
    // Panchayat, plus the plan-sanctioning verbs they issue.
    pattern: rx`\b(?:bbmp|bda|bmrda|biaapa|gba|kiadb|bwssb|kspcb|panchayat|town\s+planning|tpa)\s+(?:has\s+|have\s+|had\s+)?${ADVERB}(?:approved|sanctioned|cleared|permitted|issued)\b`,
  },
  {
    id: 'certificate_obtained',
    lane: 'approval',
    // OC / CC / completion — the certificates that decide whether a building
    // may legally be occupied or sold.
    pattern: rx`\b(?:ocs?|o\.c\.|ccs?|c\.c\.|occupancy\s+certificates?|commencement\s+certificates?|completion\s+certificates?|khata\s+certificates?)${QUALIFIER}${copula()}(?:received|obtained|issued|granted|in\s+place|available|secured)\b`,
  },
  {
    id: 'conversion_complete',
    lane: 'approval',
    // DC conversion — agricultural to non-agricultural. The single most
    // common Karnataka approval assertion, and a deal-killer when wrong.
    pattern: rx`\b(?:dc\s+conversion|land\s+conversion|conversions?(?:\s+orders?)?)${QUALIFIER}${copula()}(?:done|complete|completed|obtained|granted|valid|in\s+place|effected|approved)\b`,
  },
  {
    id: 'land_is_converted',
    lane: 'approval',
    pattern: rx`\b(?:lands?|property|properties|sites?|parcels?)${QUALIFIER}${copula()}converted\b|\bconverted\s+(?:lands?|property|properties)${copula()}(?:valid|in\s+order)\b`,
  },
  {
    id: 'noc_obtained',
    lane: 'approval',
    pattern: rx`\b(?:nocs?|n\.o\.c\.|no\s+objection\s+certificates?)${QUALIFIER}${copula()}(?:obtained|received|granted|issued|in\s+place|secured)\b`,
  },
  {
    id: 'regularisation_granted',
    lane: 'approval',
    // Akrama-Sakrama — regularisation of unauthorised construction.
    pattern: rx`\b(?:akrama[\s-]?sakrama|akrama|sakrama|regularisations?|regularizations?)${QUALIFIER}${copula()}(?:granted|approved|complete|completed|done|obtained|valid)\b`,
  },
  {
    id: 'zoning_compliant',
    lane: 'approval',
    // ADVERB absorbs the old `(?:fully\s+)?` slot.
    pattern: rx`\b(?:zoning|land\s+use|land[\s-]use)${QUALIFIER}${copula()}(?:compliant|permitted|permissible|approved|in\s+order)\b`,
  },

  // ── Cross-lane: guarantees ───────────────────────────────────────────────
  {
    id: 'guarantee',
    lane: 'guarantee',
    pattern: rx`\b(?:guarantee[ds]?|warrant[ds]?|assure[ds]?)\b[^.]{0,50}\b(?:returns?|outcome|approval|title|rera|profit|clearance|sanction)\b`,
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
