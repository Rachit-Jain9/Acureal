import { describe, test, expect } from 'vitest';
import { extractStreamingAnswer } from '../useDealQa';

// Tier-2 #11 — progressive parser for the streamed Q&A JSON.
//
// The backend streams Claude's strict { "answer": "...", "citations": [...] }
// JSON object. The UI shouldn't show raw JSON — it should reveal the
// answer field text incrementally. This test exercises the helper's
// behavior on realistic mid-stream buffer states.

describe('extractStreamingAnswer', () => {
  test('returns null before the answer field opens', () => {
    expect(extractStreamingAnswer('{"cit')).toBeNull();
    expect(extractStreamingAnswer('')).toBeNull();
    expect(extractStreamingAnswer(null)).toBeNull();
    expect(extractStreamingAnswer('{')).toBeNull();
    expect(extractStreamingAnswer('{"answer"')).toBeNull();
    expect(extractStreamingAnswer('{"answer":')).toBeNull();
  });

  test('returns the partial answer text once the field opens', () => {
    expect(extractStreamingAnswer('{"answer":"The deal has')).toBe('The deal has');
    expect(extractStreamingAnswer('{"answer":"')).toBe('');
  });

  test('returns the complete answer when JSON is fully formed', () => {
    const json = '{"answer":"The IRR is 22.4%.","citations":[]}';
    expect(extractStreamingAnswer(json)).toBe('The IRR is 22.4%.');
  });

  test('handles escaped quotes inside the answer', () => {
    const buf = '{"answer":"He said \\"yes\\" to the';
    expect(extractStreamingAnswer(buf)).toBe('He said "yes" to the');
  });

  test('handles newlines, tabs, backslashes via JSON escapes', () => {
    expect(extractStreamingAnswer('{"answer":"line one\\nline two')).toBe('line one\nline two');
    expect(extractStreamingAnswer('{"answer":"col\\tval')).toBe('col\tval');
    expect(extractStreamingAnswer('{"answer":"path\\\\file')).toBe('path\\file');
    expect(extractStreamingAnswer('{"answer":"slash\\/here')).toBe('slash/here');
  });

  test('handles unicode escapes', () => {
    // ₹ = ₹ (INR symbol)
    expect(extractStreamingAnswer('{"answer":"Price is \\u20B95 cr')).toBe('Price is ₹5 cr');
  });

  test('stops at the first unescaped closing quote', () => {
    const json = '{"answer":"first part","citations":["nope"]}';
    expect(extractStreamingAnswer(json)).toBe('first part');
  });

  test('tolerates whitespace between key and colon', () => {
    expect(extractStreamingAnswer('{"answer"  :  "spaced')).toBe('spaced');
  });
});
