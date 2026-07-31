'use strict';

/**
 * Lightweight script-based language detection for Indian-real-estate
 * documents. Counts characters in the major Indic Unicode blocks against
 * Latin-script characters to classify a sample as primarily Kannada,
 * Devanagari (Hindi/Marathi), Tamil, Telugu, or English.
 *
 * Why not use a full library:
 *   - franc / cld3 / fasttext-langid would add 5-30 MB to the bundle
 *     for a problem we can solve with character-set coverage.
 *   - Acureal only needs to populate the `language` column on
 *     `ai_call_logs` for the cost/quality dashboard. It's directional
 *     telemetry, not a hard classifier.
 *   - Our documents are mixed-script (Kannada + English in the same
 *     deed). The right answer is "majority script" rather than "exact
 *     ISO 639-3 with confidence".
 *
 * Returns ISO 639-1 codes:
 *   en  — Latin-majority (English / Romanised)
 *   hi  — Devanagari-majority
 *   kn  — Kannada-majority
 *   ta  — Tamil-majority
 *   te  — Telugu-majority
 *   mul — Mixed: no script clearly dominates (>= 25% each of Indic + Latin)
 *   und — Undetermined (empty / non-text)
 */

// Unicode blocks per the standard:
//   Devanagari: U+0900–U+097F (also U+A8E0–U+A8FF for extended)
//   Kannada:    U+0C80–U+0CFF
//   Tamil:      U+0B80–U+0BFF
//   Telugu:     U+0C00–U+0C7F
//   Latin Basic: U+0041–U+007A (we count alphabetic chars only)
const COUNTERS = [
  { key: 'devanagari', test: (c) => (c >= 0x0900 && c <= 0x097F) || (c >= 0xA8E0 && c <= 0xA8FF), iso: 'hi' },
  { key: 'kannada',    test: (c) => c >= 0x0C80 && c <= 0x0CFF, iso: 'kn' },
  { key: 'tamil',      test: (c) => c >= 0x0B80 && c <= 0x0BFF, iso: 'ta' },
  { key: 'telugu',     test: (c) => c >= 0x0C00 && c <= 0x0C7F, iso: 'te' },
  { key: 'latin',      test: (c) => (c >= 0x0041 && c <= 0x005A) || (c >= 0x0061 && c <= 0x007A), iso: 'en' },
];

const MIN_SAMPLE_CHARS = 12;   // below this, return undetermined
const SAMPLE_CAP = 4000;        // scan at most this many chars from the input
const MAJORITY_THRESHOLD = 0.6; // dominant script must be ≥60% of *script chars*
const MIXED_THRESHOLD = 0.25;   // both Indic+Latin ≥25% → 'mul' (mixed)

const detectLanguage = (text) => {
  if (typeof text !== 'string' || !text.trim()) return 'und';
  const sample = text.length > SAMPLE_CAP ? text.slice(0, SAMPLE_CAP) : text;
  const counts = Object.fromEntries(COUNTERS.map((c) => [c.key, 0]));
  let scriptChars = 0;
  for (let i = 0; i < sample.length; i += 1) {
    const code = sample.charCodeAt(i);
    for (const c of COUNTERS) {
      if (c.test(code)) {
        counts[c.key] += 1;
        scriptChars += 1;
        break;
      }
    }
  }
  if (scriptChars < MIN_SAMPLE_CHARS) return 'und';

  // Find the dominant Indic script (if any) and compare against Latin.
  const indicTotal = counts.devanagari + counts.kannada + counts.tamil + counts.telugu;
  const indicShare = indicTotal / scriptChars;
  const latinShare = counts.latin / scriptChars;

  // Mixed: meaningful presence of both Indic and Latin.
  if (indicShare >= MIXED_THRESHOLD && latinShare >= MIXED_THRESHOLD) return 'mul';

  // Pick the single highest-count counter; if its share clears the
  // majority threshold, return its ISO code; otherwise fall back to 'mul'.
  let topKey = null;
  let topCount = 0;
  for (const c of COUNTERS) {
    if (counts[c.key] > topCount) {
      topCount = counts[c.key];
      topKey = c.key;
    }
  }
  const topShare = topCount / scriptChars;
  if (topShare >= MAJORITY_THRESHOLD) {
    return COUNTERS.find((c) => c.key === topKey).iso;
  }
  return 'mul';
};

module.exports = {
  detectLanguage,
  // Exported for tests
  COUNTERS,
  MIN_SAMPLE_CHARS,
  MAJORITY_THRESHOLD,
};
