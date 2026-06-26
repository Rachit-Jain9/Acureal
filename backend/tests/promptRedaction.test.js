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

  test('masks an email address', () => {
    const r = redactText('Contact the owner at ramesh.rao@gmail.com for a site visit.');
    expect(r.text).toBe(`Contact the owner at ${REDACTED} for a site visit.`);
    expect(r.count).toBe(1);
  });

  test('masks a +91-anchored mobile in common formats', () => {
    expect(redactText('Call +91 9876543210 now').text).toBe(`Call ${REDACTED} now`);
    expect(redactText('Call +91-98765-43210 now').count).toBe(1);
    expect(redactText('Reach +919876543210').count).toBe(1);
  });

  test('still does NOT mask a bare 10-digit number without the +91 anchor', () => {
    expect(redactText('Call 9876543210 for details').count).toBe(0);
    expect(redactText('Registration 9876543210123').count).toBe(0);
  });

  // Context-anchored masking — recall lift where a keyword disambiguates the PII
  // from a khata / survey / registration number (keyword kept, digits masked).
  test('masks a bare Aadhaar when an aadhaar/uid keyword precedes it', () => {
    expect(redactText('Aadhaar No. 123456789012').text).toBe(`Aadhaar No. ${REDACTED}`);
    expect(redactText('UID 1234 5678 9012').text).toBe(`UID ${REDACTED}`);
    expect(redactText('aadhar - 1234-5678-9012').count).toBe(1);
  });

  test('masks a bare 10-digit mobile when a mobile/phone/whatsapp keyword precedes it', () => {
    expect(redactText('Mobile: 9876543210').text).toBe(`Mobile: ${REDACTED}`);
    expect(redactText('phone 9988776655').count).toBe(1);
    expect(redactText('WhatsApp 9123456780').count).toBe(1);
  });

  test('precision: a khata/survey number is NOT swept in when the keyword is far away', () => {
    // The keyword→number gap exceeds the cap, so the product number is untouched.
    expect(redactText('Aadhaar verified separately; khata number 123456789012').count).toBe(0);
    expect(redactText('Mobile tower nearby. Survey number 9876543210 in the records.').count).toBe(0);
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

  test('masks values under contact-channel keys but never name fields (precision)', () => {
    const r = redactFields({
      seller_mobile: '9876543210',
      phone: '080-12345678',
      email_id: 'a@b.com',
      whatsapp_no: 9988776655,
      contact_person: 'A. Rao',
      owner_name: 'B. Singh',
      khata_number: '4567',
    });
    expect(r.fields.seller_mobile).toBe(REDACTED);
    expect(r.fields.phone).toBe(REDACTED);
    expect(r.fields.email_id).toBe(REDACTED);
    expect(r.fields.whatsapp_no).toBe(REDACTED);
    // names and product data stay intact
    expect(r.fields.contact_person).toBe('A. Rao');
    expect(r.fields.owner_name).toBe('B. Singh');
    expect(r.fields.khata_number).toBe('4567');
  });

  test('masks an email or +91 mobile appearing inside any string value', () => {
    const r = redactFields({ notes: 'Owner ramesh@x.com / +91 9988776655 — call before visit.' });
    expect(r.fields.notes).toBe(`Owner ${REDACTED} / ${REDACTED} — call before visit.`);
    expect(r.count).toBe(2);
  });

  test('leaves a clean extraction untouched', () => {
    const clean = { land_area_sqft: 12000, survey_number: '45/2', owner_name: 'A. Rao' };
    const r = redactFields(clean);
    expect(r.fields).toEqual(clean);
    expect(r.count).toBe(0);
  });
});
