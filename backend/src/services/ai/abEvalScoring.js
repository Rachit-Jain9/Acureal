'use strict';

/**
 * Tier-2 #14 — Deterministic scoring for the parcel-narrative + export-
 * insights A/B eval harness.
 *
 * Pure functions. No DB. No LLM. Given a generated text + the input
 * snapshot it was produced from, score it on two dimensions:
 *
 *   • Hallucination — did the model assert facts (numbers, codes, dates)
 *     that aren't in the snapshot?
 *   • Tone regression — did the model drift from "Bengaluru PE analyst"
 *     into AI-SaaS marketing voice / sloppy hedging / wrong format?
 *
 * Per CLAUDE.md hard rules: scoring is deterministic JS. The LLM under
 * test is the SUBJECT of scoring, not the scorer. (We deliberately do
 * NOT use a second LLM as judge here — that just compounds the
 * uncertainty we're trying to measure. A separate LLM-judge harness is
 * a different feature.)
 *
 * Output shape:
 *   {
 *     hallucination: {
 *       score: 0..100,                 // 100 = no hallucinations
 *       fabricated_numbers: [{ value, context, severity }],
 *       fabricated_strings: [{ token, kind, context }],
 *     },
 *     tone: {
 *       score: 0..100,                 // 100 = perfect institutional voice
 *       violations: [{ kind, snippet, count }],
 *     },
 *     overall: 0..100,                 // weighted: 0.6 * hallucination + 0.4 * tone
 *   }
 */

// ──────────────────────────────────────────────────────────────────────────
// Number scanning
// ──────────────────────────────────────────────────────────────────────────

// Find every numeric token in the generated text. Captures the value, a
// short context window, and a heuristic "kind" so the harness can decide
// if a number falls into a forgivable bucket (date year, percent of small
// magnitude, etc.).
const NUMBER_REGEX = /(?<![\w.])(\d{1,3}(?:,\d{2,3})*(?:\.\d+)?|\d+(?:\.\d+)?)(?![\w])/g;

const parseLoose = (s) => {
  if (!s) return null;
  const cleaned = String(s).replace(/[, ]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

const extractNumbers = (text) => {
  if (!text) return [];
  const out = [];
  let m;
  // Reset regex state for repeated calls.
  NUMBER_REGEX.lastIndex = 0;
  while ((m = NUMBER_REGEX.exec(text)) !== null) {
    const raw = m[1];
    const value = parseLoose(raw);
    if (value === null) continue;
    const start = Math.max(0, m.index - 24);
    const end = Math.min(text.length, m.index + raw.length + 24);
    const context = text.slice(start, end).replace(/\s+/g, ' ').trim();
    out.push({ raw, value, index: m.index, context });
  }
  return out;
};

// Recursively collect every numeric leaf in a snapshot. Used as the
// "allowed numbers" set for hallucination detection.
const collectSnapshotNumbers = (value, acc = new Set()) => {
  if (value === null || value === undefined) return acc;
  if (typeof value === 'number' && Number.isFinite(value)) {
    acc.add(value);
    // Add common derived forms so a snapshot lakh value matches text in
    // both raw and rounded form. e.g. 12.345 → also 12.3, 12, 12.35.
    acc.add(Math.round(value));
    acc.add(Math.round(value * 10) / 10);
    acc.add(Math.round(value * 100) / 100);
    return acc;
  }
  if (typeof value === 'string') {
    // Pull any embedded numbers out of free-text fields (addresses,
    // names) — those count as "in the input" too.
    const inner = extractNumbers(value);
    inner.forEach(({ value: v }) => {
      acc.add(v);
      acc.add(Math.round(v));
    });
    return acc;
  }
  if (Array.isArray(value)) {
    value.forEach((v) => collectSnapshotNumbers(v, acc));
    return acc;
  }
  if (typeof value === 'object') {
    Object.values(value).forEach((v) => collectSnapshotNumbers(v, acc));
    return acc;
  }
  return acc;
};

// Acceptable-number test: claimed value matches any snapshot value
// within ±tolerancePct, OR is a plausible "harmless" number (year,
// single-digit, ordinal).
const FORGIVE_HARMLESS = (value) => {
  if (value === 0 || value === 1) return true;       // ordinals / counts
  if (value >= 1900 && value <= 2099) return true;   // year references
  if (value >= 2 && value <= 30 && Number.isInteger(value)) {
    // Small integers — typical for "3 risks", "5 comps", etc. The
    // harness flags these if they happen NEAR a magnitude keyword
    // (Cr, sqft, %) via the keyword-proximity check below.
    return true;
  }
  return false;
};

const MAGNITUDE_HINTS = [
  '%', 'cr', 'crore', 'crores', 'lakh', 'lakhs', 'sqft', 'sq ft', 'sq.ft',
  'acre', 'acres', 'mn', 'million', 'inr', '₹', 'far', 'fsi',
  'ground coverage', 'setback', 'guidance value', 'rate per sqft',
];

const hasNearbyMagnitudeHint = (context) => {
  const lower = (context || '').toLowerCase();
  return MAGNITUDE_HINTS.some((h) => lower.includes(h));
};

// Check whether a claimed value matches any snapshot value within
// `tolerancePct`.
const matchesSnapshot = (claimed, snapshotSet, tolerancePct = 1) => {
  if (snapshotSet.has(claimed)) return true;
  for (const s of snapshotSet) {
    if (s === 0) {
      if (claimed === 0) return true;
      continue;
    }
    const drift = Math.abs((claimed - s) / s) * 100;
    if (drift <= tolerancePct) return true;
  }
  return false;
};

const scoreHallucination = (text, snapshot, opts = {}) => {
  const tolerancePct = opts.tolerancePct ?? 1;
  const snapshotNumbers = collectSnapshotNumbers(snapshot);
  const claimed = extractNumbers(text);

  const fabricated_numbers = [];
  for (const c of claimed) {
    if (matchesSnapshot(c.value, snapshotNumbers, tolerancePct)) continue;
    if (FORGIVE_HARMLESS(c.value) && !hasNearbyMagnitudeHint(c.context)) continue;
    // Severity: high if next to a magnitude unit (rupees, %, sqft, FAR);
    // medium if just a freestanding number not in snapshot.
    const severity = hasNearbyMagnitudeHint(c.context) ? 'high' : 'medium';
    fabricated_numbers.push({
      value: c.value,
      context: c.context,
      severity,
    });
  }

  // String-level fabrication: zone codes, RERA numbers, dates.
  const fabricated_strings = [];

  // Zone code pattern (Indian master plans): R-1, RES, COM-3, MU, etc.
  // Flag only if the text contains one not present in any snapshot string.
  const ZONE_RE = /\b(?:R|RES|COM|IND|MU|UA|GR|RECN|TR|TRS|UAS|UA-?\d+|R-?\d+)\b/g;
  const snapshotText = JSON.stringify(snapshot || {}).toLowerCase();
  const zoneMatches = (text || '').match(ZONE_RE) || [];
  const seenZones = new Set();
  for (const code of zoneMatches) {
    const lc = code.toLowerCase();
    if (seenZones.has(lc)) continue;
    seenZones.add(lc);
    if (!snapshotText.includes(lc)) {
      fabricated_strings.push({ token: code, kind: 'zone_code', context: code });
    }
  }

  // RERA registration number pattern: PRM/KA/RERA/...
  const RERA_RE = /\b(?:PRM|PR|AGT)\/[A-Z]{2}\/RERA\/[\w/-]+/g;
  const reraMatches = (text || '').match(RERA_RE) || [];
  for (const r of reraMatches) {
    if (!snapshotText.includes(r.toLowerCase())) {
      fabricated_strings.push({ token: r, kind: 'rera_number', context: r });
    }
  }

  const totalSignals = fabricated_numbers.length + fabricated_strings.length;
  // Score: each fabrication knocks 14 points (high) or 7 points (medium).
  // After 3 high-severity fabrications a "blowout" multiplier kicks in
  // so a flagrantly hallucinated output rapidly approaches 0.
  // Floor at 0. A clean output → 100.
  let penalty = 0;
  let highCount = 0;
  for (const f of fabricated_numbers) {
    penalty += f.severity === 'high' ? 14 : 7;
    if (f.severity === 'high') highCount += 1;
  }
  for (const _ of fabricated_strings) {
    penalty += 14;
    highCount += 1;
  }
  if (highCount >= 4) penalty += 25; // egregious-output safety penalty
  const score = Math.max(0, 100 - penalty);

  return {
    score,
    fabricated_numbers,
    fabricated_strings,
    total_signals: totalSignals,
  };
};

// ──────────────────────────────────────────────────────────────────────────
// Tone scoring
// ──────────────────────────────────────────────────────────────────────────

// Words that immediately tell you the model lapsed into AI-SaaS-marketing
// voice. Investor-grade real-estate notes don't say "leverage", "robust",
// "groundbreaking", "synergy".
const FORBIDDEN_TONE_WORDS = [
  'groundbreaking', 'revolutionary', 'paradigm', 'synergy', 'synergies',
  'unlock', 'unlocking', 'unleash', 'cutting-edge', 'state-of-the-art',
  'best-in-class', 'world-class', 'game-changer', 'game-changing',
  'leverage', 'leverages', 'leveraged', 'leveraging',
  'robust', 'seamless', 'seamlessly', 'amazing', 'incredible', 'stunning',
  'exciting', 'innovative', 'transformative',
];

// Phrases that signal vague / hedging language. A few are fine; many = bad.
const HEDGE_PATTERNS = [
  /\bapproximately\b/gi, /\baround\b/gi, /\broughly\b/gi,
  /\bsomewhat\b/gi, /\bperhaps\b/gi, /\barguably\b/gi,
  /\bmight be\b/gi, /\bcould be\b/gi, /\bmay be\b/gi,
];

// Markdown leakage: when prose is required, bullets / headings / fences
// are a tone failure.
const MARKDOWN_PATTERNS = [
  { kind: 'heading',  pattern: /^#{1,6}\s+/gm },
  { kind: 'bullet',   pattern: /^[*\-•]\s+/gm },
  { kind: 'bold',     pattern: /\*\*[^*]+\*\*/g },
  { kind: 'fence',    pattern: /```/g },
];

// Emoji range — any presence is a tone failure for institutional output.
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

// First / second-person markers — a deal note is third-person prose.
const FIRST_PERSON_RE = /\b(I|we recommend|let'?s|you should|you'?ll|in my opinion)\b/gi;

const countMatches = (text, regex) => {
  if (!text) return 0;
  const m = text.match(regex);
  return m ? m.length : 0;
};

const scoreTone = (text, opts = {}) => {
  const violations = [];
  if (!text) {
    return { score: 0, violations: [{ kind: 'empty', snippet: '', count: 1 }] };
  }
  const lower = text.toLowerCase();
  const wordCount = (text.match(/\b\w+\b/g) || []).length;

  // Forbidden words.
  for (const word of FORBIDDEN_TONE_WORDS) {
    const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`, 'gi');
    const count = countMatches(lower, re);
    if (count > 0) {
      const idx = lower.indexOf(word);
      const snippet = idx >= 0
        ? text.slice(Math.max(0, idx - 30), Math.min(text.length, idx + word.length + 30))
        : word;
      violations.push({ kind: 'forbidden_word', snippet, word, count });
    }
  }

  // Hedge density — each match counts; > 3 hedges per 100 words = violation.
  let hedgeTotal = 0;
  for (const re of HEDGE_PATTERNS) {
    hedgeTotal += countMatches(text, re);
  }
  const hedgeDensity = wordCount > 0 ? (hedgeTotal / wordCount) * 100 : 0;
  if (hedgeDensity > 3) {
    violations.push({
      kind: 'excess_hedging',
      snippet: `${hedgeTotal} hedge phrases over ${wordCount} words`,
      count: hedgeTotal,
    });
  }

  // Markdown leakage (configurable: parcel narrative says "plain prose
  // only", IC memos use markdown by design).
  if (opts.disallowMarkdown !== false) {
    for (const { kind, pattern } of MARKDOWN_PATTERNS) {
      const count = countMatches(text, pattern);
      if (count > 0) {
        violations.push({ kind: `markdown_${kind}`, snippet: kind, count });
      }
    }
  }

  // Emoji.
  if (EMOJI_RE.test(text)) {
    violations.push({ kind: 'emoji_present', snippet: 'emoji found', count: 1 });
  }

  // First / second-person voice.
  const fpCount = countMatches(text, FIRST_PERSON_RE);
  if (fpCount > 0) {
    violations.push({ kind: 'first_person_voice', snippet: 'I / we / you usage', count: fpCount });
  }

  // Word count band — caller passes target.
  if (opts.minWords && wordCount < opts.minWords) {
    violations.push({
      kind: 'too_short',
      snippet: `${wordCount} words (target ≥ ${opts.minWords})`,
      count: 1,
    });
  }
  if (opts.maxWords && wordCount > opts.maxWords) {
    violations.push({
      kind: 'too_long',
      snippet: `${wordCount} words (target ≤ ${opts.maxWords})`,
      count: 1,
    });
  }

  // Score: each violation knocks N points; floor 0, cap 100.
  // Calibration: three forbidden marketing words alone should drop you
  // well below 60 so the harness's "is this institutionally voiced"
  // signal stays sharp.
  let penalty = 0;
  for (const v of violations) {
    if (v.kind === 'forbidden_word')      penalty += 18 * Math.min(v.count, 3);
    else if (v.kind === 'emoji_present')  penalty += 25;
    else if (v.kind === 'empty')          penalty += 100;
    else if (v.kind.startsWith('markdown_')) penalty += 6 * Math.min(v.count, 5);
    else if (v.kind === 'first_person_voice') penalty += 10 * Math.min(v.count, 3);
    else if (v.kind === 'excess_hedging') penalty += 12;
    else if (v.kind === 'too_short' || v.kind === 'too_long') penalty += 10;
    else penalty += 5;
  }
  const score = Math.max(0, Math.min(100, 100 - penalty));
  return { score, violations, word_count: wordCount };
};

// ──────────────────────────────────────────────────────────────────────────
// Composite scorer
// ──────────────────────────────────────────────────────────────────────────

/**
 * Score a single (text, snapshot) pair across both dimensions and
 * return the composite. Caller usually averages `overall` across the
 * full eval set to compare two providers/models.
 *
 * Weights: hallucination 0.6, tone 0.4. Hallucination is the harder
 * failure mode (we'd rather have a slightly stiff reply than a
 * confidently-wrong one).
 */
const scoreOutput = (text, snapshot, opts = {}) => {
  const hallucination = scoreHallucination(text, snapshot, opts);
  const tone = scoreTone(text, opts);
  const overall = Math.round(0.6 * hallucination.score + 0.4 * tone.score);
  return {
    hallucination,
    tone,
    overall,
  };
};

module.exports = {
  scoreOutput,
  scoreHallucination,
  scoreTone,
  // Internal helpers — exported for tests.
  _internal: {
    extractNumbers,
    collectSnapshotNumbers,
    matchesSnapshot,
    FORBIDDEN_TONE_WORDS,
  },
};
