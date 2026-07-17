import { describe, expect, it } from 'vitest';
import { coverageLabel } from '../DocumentsTab';

/**
 * The coverage chip's copy.
 *
 * This is the operator-facing half of the product promise — "REDIP tells you
 * exactly what it processed, and what it didn't." The tests below pin the two
 * things that make the chip trustworthy rather than decorative:
 *
 *   1. It says "sent", never "read". A 200 from the provider is not evidence
 *      that a model attended to page 847, and this product does not claim what
 *      it cannot show.
 *   2. It says NOTHING when there is nothing true to say. Silence beats a
 *      guess — the failure mode that produced the fill-rate "confidence" score
 *      was inventing a number to fill a space.
 */

describe('coverageLabel', () => {
  const receipt = (over) => ({ coverage: { version: 1, method: 'native_pdf', ...over } });

  it('a fully-sent document states the whole page count', () => {
    expect(coverageLabel(receipt({ detected_pages: 327, submitted_pages: 327 })))
      .toBe('All 327 pages sent');
  });

  it('a partially-sent document states BOTH numbers — the gap is the point', () => {
    expect(coverageLabel(receipt({ detected_pages: 327, submitted_pages: 324 })))
      .toBe('324 of 327 pages sent');
  });

  it('uses Indian digit grouping, like every other number in the product', () => {
    expect(coverageLabel(receipt({ detected_pages: 130680, submitted_pages: 130680 })))
      .toBe('All 1,30,680 pages sent');
  });

  it('says "sent" — never "read"', () => {
    const label = coverageLabel(receipt({ detected_pages: 9, submitted_pages: 9 }));
    expect(label).toMatch(/sent/);
    expect(label).not.toMatch(/\bread\b/);
  });

  it('is silent for transcribed formats, where "pages" are not a real unit', () => {
    // A spreadsheet has no pages. Inventing one would be a small lie.
    expect(coverageLabel({ coverage: { method: 'parsed_text' } })).toBeNull();
  });

  it('is silent for single images rather than announcing "All 1 pages sent"', () => {
    expect(coverageLabel({ coverage: { method: 'image', detected_pages: 1, submitted_pages: 1 } })).toBeNull();
  });

  it('is silent for documents extracted before receipts existed', () => {
    // Legacy rows carry no coverage. Showing nothing is honest; guessing is not.
    expect(coverageLabel({ coverage: null })).toBeNull();
    expect(coverageLabel({})).toBeNull();
    expect(coverageLabel(undefined)).toBeNull();
  });

  it('is silent on a malformed or partial receipt instead of rendering junk', () => {
    expect(coverageLabel(receipt({ detected_pages: null, submitted_pages: 5 }))).toBeNull();
    expect(coverageLabel(receipt({ detected_pages: 5, submitted_pages: null }))).toBeNull();
    expect(coverageLabel(receipt({ detected_pages: 0, submitted_pages: 0 }))).toBeNull();
  });
});
