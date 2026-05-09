import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildCsv, downloadCsv, escapeCsvField } from '../csvDownload';

describe('escapeCsvField', () => {
  it('returns empty string for null/undefined', () => {
    expect(escapeCsvField(null)).toBe('');
    expect(escapeCsvField(undefined)).toBe('');
  });

  it('returns plain values unmodified', () => {
    expect(escapeCsvField('hello')).toBe('hello');
    expect(escapeCsvField(42)).toBe('42');
    expect(escapeCsvField(0)).toBe('0');
  });

  it('quotes fields containing commas', () => {
    expect(escapeCsvField('Bandra, West')).toBe('"Bandra, West"');
  });

  it('escapes embedded quotes by doubling them', () => {
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
  });

  it('quotes fields containing newlines', () => {
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
  });
});

describe('buildCsv', () => {
  it('throws when headers is missing or empty', () => {
    expect(() => buildCsv({ rows: [] })).toThrow();
    expect(() => buildCsv({ headers: [], rows: [] })).toThrow();
  });

  it('builds a header-only CSV when rows is empty', () => {
    const out = buildCsv({ headers: ['Stage', 'Count'], rows: [] });
    expect(out).toBe('Stage,Count');
  });

  it('joins cells with commas and rows with LF', () => {
    const out = buildCsv({
      headers: ['Stage', 'Count'],
      rows: [['Sourcing', 4], ['Screening', 7]],
    });
    expect(out).toBe('Stage,Count\nSourcing,4\nScreening,7');
  });

  it('escapes problematic cells correctly', () => {
    const out = buildCsv({
      headers: ['Deal', 'Notes'],
      rows: [['Plot, A', 'has "issue"']],
    });
    expect(out).toBe('Deal,Notes\n"Plot, A","has ""issue"""');
  });

  it('skips non-array rows defensively', () => {
    const out = buildCsv({
      headers: ['A'],
      rows: [['valid'], 'not-an-array', ['also valid']],
    });
    expect(out).toBe('A\nvalid\nalso valid');
  });
});

describe('downloadCsv', () => {
  let originalCreate;
  let originalRevoke;
  let createdUrls;
  let appendedLinks;

  beforeEach(() => {
    createdUrls = [];
    appendedLinks = [];
    originalCreate = URL.createObjectURL;
    originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => {
      const url = `blob:test-${createdUrls.length}`;
      createdUrls.push(url);
      return url;
    });
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });

  it('creates an object URL, builds the link, clicks, and revokes', () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    downloadCsv({ filename: 'test.csv', headers: ['A'], rows: [['1']] });
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it('falls back to a default filename when none is supplied', () => {
    const created = [];
    const original = HTMLAnchorElement.prototype.click;
    Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
      configurable: true,
      writable: true,
      value() {
        created.push(this.download);
      },
    });
    downloadCsv({ headers: ['A'], rows: [['1']] });
    expect(created[0]).toMatch(/^download-\d{4}-\d{2}-\d{2}\.csv$/);
    Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
      configurable: true,
      writable: true,
      value: original,
    });
  });
});
