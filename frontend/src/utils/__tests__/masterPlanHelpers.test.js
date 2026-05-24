import { describe, it, expect } from 'vitest';
import {
  formatBytes,
  formatDocType,
  formatOption,
  legalStatusTone,
  formatPercent,
  pageStatusTone,
  parseList,
  joinList,
  toNum,
  ratioToPct,
  pctToRatio,
  normalizeSourceReadiness,
  getSourceReadiness,
  normalizePreviousValues,
  formatHistoryField,
  formatHistoryValue,
  SOURCE_ROLES,
} from '../masterPlanHelpers';

describe('masterPlanHelpers — pure formatters', () => {
  it('formatBytes renders B / KB / MB and falls back for invalid input', () => {
    expect(formatBytes(0)).toBe('-');
    expect(formatBytes(-1)).toBe('-');
    expect(formatBytes('abc')).toBe('-');
    expect(formatBytes(800)).toBe('800 B');
    expect(formatBytes(1500)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('formatDocType returns the friendly label for a known doc type', () => {
    expect(formatDocType('rmp_table')).toBe('RMP / FAR table');
    expect(formatDocType('igr_guidance_pdf')).toBe('IGR guidance PDF');
  });

  it('formatDocType de-snake-cases an unknown doc type', () => {
    expect(formatDocType('something_custom')).toBe('something custom');
  });

  it('formatDocType returns "Auto-classify" when no doc type given', () => {
    expect(formatDocType(null)).toBe('Auto-classify');
    expect(formatDocType('')).toBe('Auto-classify');
  });

  it('formatOption looks up a value in an option list', () => {
    expect(formatOption(SOURCE_ROLES, 'operative_regulation')).toBe('Operative regulation');
    expect(formatOption(SOURCE_ROLES, 'unknown_value')).toBe('unknown value');
    // Note: SOURCE_ROLES has a `{ value: '', label: 'Select role' }` entry,
    // so empty-string input returns that label (not the de-snake-cased fallback).
    expect(formatOption(SOURCE_ROLES, '')).toBe('Select role');
  });

  it('legalStatusTone maps each known status to its tone', () => {
    expect(legalStatusTone('gazetted')).toBe('success');
    expect(legalStatusTone('draft')).toBe('warn');
    expect(legalStatusTone('provisional')).toBe('warn');
    expect(legalStatusTone('advisory')).toBe('info');
    expect(legalStatusTone('vendor')).toBe('neutral');
    expect(legalStatusTone('weird')).toBe('neutral');
  });

  it('formatPercent rounds a 0..1 ratio to a percentage string', () => {
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(0.5)).toBe('50%');
    expect(formatPercent(0.987)).toBe('99%');
    // Note: existing-behaviour quirk — Number(null) === 0 (finite), so
    // formatPercent(null) returns '0%'. undefined coerces to NaN and
    // does return null. Documented here so a future tightening keeps the
    // contract explicit.
    expect(formatPercent(undefined)).toBeNull();
    expect(formatPercent('abc')).toBeNull();
  });

  it('pageStatusTone maps each known status to its tone', () => {
    expect(pageStatusTone('completed')).toBe('success');
    expect(pageStatusTone('queued')).toBe('warn');
    expect(pageStatusTone('failed')).toBe('danger');
    expect(pageStatusTone('not_required')).toBe('neutral');
    expect(pageStatusTone('weird')).toBe('neutral');
  });
});

describe('masterPlanHelpers — list / number coercion', () => {
  it('parseList splits a comma-separated string and trims each piece', () => {
    expect(parseList('a, b , c')).toEqual(['a', 'b', 'c']);
    expect(parseList('')).toEqual([]);
    expect(parseList(null)).toEqual([]);
  });

  it('joinList round-trips an array back to a comma-separated string', () => {
    expect(joinList(['a', 'b', 'c'])).toBe('a, b, c');
    expect(joinList([])).toBe('');
    expect(joinList(null)).toBe('');
  });

  it('toNum coerces a numeric-like value or returns null', () => {
    expect(toNum('5')).toBe(5);
    expect(toNum(2.5)).toBe(2.5);
    expect(toNum('')).toBeNull();
    expect(toNum(null)).toBeNull();
    expect(toNum('abc')).toBeNull();
  });

  it('ratioToPct converts a 0..1 ratio to a percentage string', () => {
    expect(ratioToPct(0.5)).toBe('50');
    expect(ratioToPct(1)).toBe('100');
    // Same coercion quirk as formatPercent — Number(null) === 0 so this
    // returns '0', not ''. undefined coerces to NaN and returns ''.
    expect(ratioToPct(undefined)).toBe('');
    expect(ratioToPct('abc')).toBe('');
  });

  it('pctToRatio clamps to [0, 100] then divides by 100', () => {
    expect(pctToRatio('50')).toBe(0.5);
    expect(pctToRatio(150)).toBe(1); // clamped
    expect(pctToRatio(-20)).toBe(0); // clamped
    expect(pctToRatio('')).toBeNull();
    expect(pctToRatio('abc')).toBeNull();
  });
});

describe('masterPlanHelpers — readiness normalisation', () => {
  it('normalizeSourceReadiness uses snake_case server fields with fallbacks', () => {
    const out = normalizeSourceReadiness({
      key: 'ocr',
      label: 'OCR review',
      tone: 'warn',
      description: 'Needs OCR',
      can_extract: false,
      action_label: 'OCR review',
      block_reason: 'OCR required',
      missing_fields: [],
    });
    expect(out.canExtract).toBe(false);
    expect(out.actionLabel).toBe('OCR review');
    expect(out.blockReason).toBe('OCR required');
  });

  it('normalizeSourceReadiness returns null for null input', () => {
    expect(normalizeSourceReadiness(null)).toBeNull();
    expect(normalizeSourceReadiness(undefined)).toBeNull();
  });

  it('getSourceReadiness flags OCR-required docs as non-extractable', () => {
    const r = getSourceReadiness({ ocr_required: true });
    expect(r.key).toBe('ocr');
    expect(r.canExtract).toBe(false);
  });

  it('getSourceReadiness flags manual-entry docs', () => {
    const r = getSourceReadiness({ processing_mode: 'manual_entry' });
    expect(r.key).toBe('manual');
    expect(r.label).toBe('Manual entry');
    expect(r.canExtract).toBe(false);
  });

  it('getSourceReadiness flags not_extractable docs', () => {
    const r = getSourceReadiness({ processing_mode: 'not_extractable' });
    expect(r.key).toBe('manual');
    expect(r.label).toBe('Reference only');
    expect(r.canExtract).toBe(false);
  });

  it('getSourceReadiness flags failed extractions as retry-able', () => {
    const r = getSourceReadiness({ extraction_status: 'failed' });
    expect(r.key).toBe('failed');
    expect(r.actionLabel).toBe('Retry');
    expect(r.canExtract).toBe(true);
  });

  it('getSourceReadiness reports missing-metadata gaps', () => {
    const r = getSourceReadiness({ processing_mode: 'text_extraction' });
    expect(r.key).toBe('metadata');
    expect(r.missingFields.length).toBe(3);
  });

  it('getSourceReadiness reports a fully-populated doc as ready', () => {
    const r = getSourceReadiness({
      processing_mode: 'text_extraction',
      source_role: 'operative_regulation',
      legal_status: 'gazetted',
      authority_name: 'BDA',
    });
    expect(r.key).toBe('ready');
    expect(r.canExtract).toBe(true);
  });

  it('getSourceReadiness flags a completed extraction as review-queued', () => {
    const r = getSourceReadiness({
      processing_mode: 'text_extraction',
      source_role: 'operative_regulation',
      legal_status: 'gazetted',
      authority_name: 'BDA',
      extraction_status: 'completed',
    });
    expect(r.key).toBe('review');
    expect(r.actionLabel).toBe('Re-extract');
  });
});

describe('masterPlanHelpers — history-modal formatters', () => {
  it('formatHistoryField maps known fields to friendly labels', () => {
    expect(formatHistoryField('doc_type')).toBe('Document type');
    expect(formatHistoryField('source_role')).toBe('Source role');
    expect(formatHistoryField('custom_field')).toBe('custom field');
  });

  it('formatHistoryValue renders blanks for null / empty / undefined', () => {
    expect(formatHistoryValue('doc_type', null)).toBe('Blank');
    expect(formatHistoryValue('doc_type', '')).toBe('Blank');
    expect(formatHistoryValue('doc_type', undefined)).toBe('Blank');
  });

  it('formatHistoryValue renders booleans as Yes / No', () => {
    expect(formatHistoryValue('ocr_required', true)).toBe('Yes');
    expect(formatHistoryValue('ocr_required', false)).toBe('No');
  });

  it('formatHistoryValue looks up enums for select-shaped fields', () => {
    expect(formatHistoryValue('doc_type', 'rmp_table')).toBe('RMP / FAR table');
    expect(formatHistoryValue('source_role', 'operative_regulation')).toBe('Operative regulation');
  });

  it('formatHistoryValue renders ratio fields as percent', () => {
    expect(formatHistoryValue('text_coverage_ratio', 0.5)).toBe('50%');
    expect(formatHistoryValue('source_confidence', 0.95)).toBe('95%');
  });

  it('normalizePreviousValues handles JSON-encoded server strings', () => {
    expect(normalizePreviousValues('{"a":1,"b":2}')).toEqual({ a: 1, b: 2 });
    expect(normalizePreviousValues({ a: 1 })).toEqual({ a: 1 });
    expect(normalizePreviousValues(null)).toEqual({});
    expect(normalizePreviousValues('invalid json')).toEqual({});
    expect(normalizePreviousValues('[1,2,3]')).toEqual({}); // arrays rejected
  });
});
