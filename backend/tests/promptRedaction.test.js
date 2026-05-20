'use strict';

// Unit tests for the AI-pipeline PII redaction.
//
// The contract that matters: PAN and spaced-Aadhaar are masked, but
// legitimate product data — khata numbers, survey numbers, company names,
// phone numbers — is NEVER touched. Precision over recall.

const { redactText, redactFields, REDACTED } = require('../src/services/ai/promptRedaction');

describe('promptRedaction.redactText', () => {
  test('masks a PAN', () => {
    const r = redactText('Seller PAN is ABCDE1234F as per records.');
    expect(r.text).toBe(`Seller PAN is ${REDACTED} as per records.`);
    expect(r.count).toBe(1);
  });

  test('masks Aadhaar in the 4-4-4 spaced format', () => {
    const r = redactText('Aadhaar: 1234 5678 9012');
    expect(r.text).toBe(`Aadhaar: ${REDACTED}`);
    expect(r.count).toBe(1);
  });

  test('does NOT mask a bare 12-digit number (could be a khata / survey number)', () => {
    const r = redactText('Khata number 123456789012');
    expect(r.text).toBe('Khata number 123456789012');
    expect(r.count).toBe(0);
  });

  test('does NOT mask a 10-digit phone number or ordinary document text', () => {
    expect(redactText('Call 9876543210 for details').count).toBe(0);
    expect(redactText('Survey No. 45/2, Whitefield, Bengaluru').count).toBe(0);
  });

  test('counts and masks multiple matches', () => {
    const r = redactText('PAN ABCDE1234F and AAAAA9999A');
    expect(r.count).toBe(2);
    expect(r.text).not.toMatch(/ABCDE1234F/);
    expect(r.text).not.toMatch(/AAAAA9999A/);
  });

  test('passes non-strings through untouched', () => {
    expect(redactText(null)).toEqual({ text: null, count: 0 });
    expect(redactText(undefined)).toEqual({ text: undefined, count: 0 });
    expect(redactText(42)).toEqual({ text: 42, count: 0 });
  });
});

describe('promptRedaction.redactFields', () => {
  test('masks a value under an aadhaar-named key, even a bare number', () => {
    const r = redactFields({ aadhaar_number: '123456789012', owner_name: 'A. Rao' });
    expect(r.fields.aadhaar_number).toBe(REDACTED);
    expect(r.fields.owner_name).toBe('A. Rao');
    expect(r.count).toBe(1);
  });

  test('masks PAN-named keys (pan, seller_pan, pan_number)', () => {
    const r = redactFields({ pan: 'x', seller_pan: 'y', pan_number: 'z' });
    expect(r.fields.pan).toBe(REDACTED);
    expect(r.fields.seller_pan).toBe(REDACTED);
    expect(r.fields.pan_number).toBe(REDACTED);
  });

  test('does NOT mask company_name despite the "pan" substring (precision)', () => {
    const r = redactFields({ company_name: 'Whitefield Estates Pvt Ltd', khata_number: '4567' });
    expect(r.fields.company_name).toBe('Whitefield Estates Pvt Ltd');
    expect(r.fields.khata_number).toBe('4567');
    expect(r.count).toBe(0);
  });

  test('masks a PAN appearing in any string value regardless of key', () => {
    const r = redactFields({ notes: 'Buyer PAN ABCDE1234F on file' });
    expect(r.fields.notes).toBe(`Buyer PAN ${REDACTED} on file`);
    expect(r.count).toBe(1);
  });

  test('deep-walks nested objects and arrays', () => {
    const r = redactFields({
      parties: [{ name: 'X', aadhaar: '111122223333' }],
      meta: { sub_registrar: { pan_no: 'QWERT5678Y' } },
    });
    expect(r.fields.parties[0].aadhaar).toBe(REDACTED);
    expect(r.fields.parties[0].name).toBe('X');
    expect(r.fields.meta.sub_registrar.pan_no).toBe(REDACTED);
    expect(r.count).toBe(2);
  });

  test('does not mutate the input object', () => {
    const input = { aadhaar: '123456789012' };
    redactFields(input);
    expect(input.aadhaar).toBe('123456789012');
  });

  test('leaves a clean extraction untouched', () => {
    const clean = { land_area_sqft: 12000, survey_number: '45/2', owner_name: 'A. Rao' };
    const r = redactFields(clean);
    expect(r.fields).toEqual(clean);
    expect(r.count).toBe(0);
  });
});
