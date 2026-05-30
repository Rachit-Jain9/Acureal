'use strict';

const {
  classifyInput,
  extractGoogleMapsUrl,
  extractLatLng,
  extractPlusCode,
  extractSurveyNumber,
  isLikelyFreeText,
} = require('../src/utils/propertyCaptureParser');

describe('propertyCaptureParser', () => {
  describe('extractLatLng', () => {
    test('parses comma-separated decimals', () => {
      expect(extractLatLng('12.9716, 77.5946')).toEqual({ lat: 12.9716, lng: 77.5946 });
    });

    test('parses no-space comma-separated decimals', () => {
      expect(extractLatLng('12.9716,77.5946')).toEqual({ lat: 12.9716, lng: 77.5946 });
    });

    test('parses degree-direction notation', () => {
      expect(extractLatLng('12.9716°N, 77.5946°E')).toEqual({ lat: 12.9716, lng: 77.5946 });
    });

    test('parses labelled form', () => {
      expect(extractLatLng('lat: 12.9716, lng: 77.5946')).toEqual({ lat: 12.9716, lng: 77.5946 });
    });

    test('returns null for two integers without decimal (likely sentence noise)', () => {
      expect(extractLatLng('block 12, sector 77')).toBeNull();
    });

    test('returns null for out-of-range values', () => {
      expect(extractLatLng('912.34, 877.99')).toBeNull();
    });

    test('returns null for empty input', () => {
      expect(extractLatLng('')).toBeNull();
      expect(extractLatLng(null)).toBeNull();
    });
  });

  describe('extractPlusCode', () => {
    test('parses a short Plus Code with area context', () => {
      const r = extractPlusCode('3JV8+P4W Bengaluru');
      expect(r).toEqual({ code: '3JV8+P4W', head: '3JV8', tail: 'P4W', isShort: true, areaContext: 'Bengaluru' });
    });

    test('parses a short Plus Code without area context', () => {
      const r = extractPlusCode('3JV8+P4W');
      expect(r.code).toBe('3JV8+P4W');
      expect(r.isShort).toBe(true);
      expect(r.areaContext).toBeNull();
    });

    test('parses a full 8-char Plus Code', () => {
      // 8 head chars from the Plus Code alphabet [23456789CFGHJMPQRVWX]
      const r = extractPlusCode('7JCRJV89+P4W');
      expect(r).not.toBeNull();
      expect(r.head).toBe('7JCRJV89');
      expect(r.isShort).toBe(false);
    });

    test('rejects invalid alphabet (zero, one, A/B/D/E used)', () => {
      // The Plus Code alphabet excludes 0, 1, A, B, D, E. The regex's
      // alternation handles this — invalid alphabet → no match.
      expect(extractPlusCode('0000+0000')).toBeNull();
      expect(extractPlusCode('ABDE+ABD')).toBeNull();
    });

    test('extracts area context trimmed', () => {
      const r = extractPlusCode('3JV8+P4W   Bengaluru, Karnataka');
      expect(r.areaContext).toBe('Bengaluru');
    });

    test('returns null for non-Plus-Code input', () => {
      expect(extractPlusCode('just an address line')).toBeNull();
      expect(extractPlusCode('')).toBeNull();
    });
  });

  describe('extractGoogleMapsUrl', () => {
    test('parses a canonical maps URL with embedded coords', () => {
      const r = extractGoogleMapsUrl('https://www.google.com/maps/place/Some+Place/@12.9716,77.5946,17z');
      expect(r).not.toBeNull();
      expect(r.latLng).toEqual({ lat: 12.9716, lng: 77.5946 });
      expect(r.isShortlink).toBe(false);
    });

    test('parses a goo.gl shortlink and flags it for redirect-follow', () => {
      const r = extractGoogleMapsUrl('https://maps.app.goo.gl/abc123');
      expect(r).not.toBeNull();
      expect(r.isShortlink).toBe(true);
      expect(r.latLng).toBeNull();
    });

    test('extracts the URL even when it is buried in surrounding text', () => {
      const text = 'Hey check this out https://maps.app.goo.gl/xyz789 — asking 18 Cr.';
      const r = extractGoogleMapsUrl(text);
      expect(r).not.toBeNull();
      expect(r.url).toBe('https://maps.app.goo.gl/xyz789');
    });

    test('strips trailing punctuation', () => {
      const r = extractGoogleMapsUrl('see https://maps.app.goo.gl/abc.');
      expect(r.url).toBe('https://maps.app.goo.gl/abc');
    });

    test('rejects non-Google hosts (SSRF protection)', () => {
      expect(extractGoogleMapsUrl('https://evil.example.com/foo')).toBeNull();
      expect(extractGoogleMapsUrl('https://maps.someelse.com/place/X')).toBeNull();
    });

    test('rejects the bare goo.gl generic shortener (SSRF — not maps-specific)', () => {
      // Bare goo.gl is Google's generic (deactivated) shortener and could 302
      // anywhere; it must no longer be classified as a Maps URL/shortlink.
      expect(extractGoogleMapsUrl('https://goo.gl/abc123')).toBeNull();
    });

    test('handles ?q= query coords form', () => {
      const r = extractGoogleMapsUrl('https://maps.google.com/?q=12.9716,77.5946');
      expect(r.latLng).toEqual({ lat: 12.9716, lng: 77.5946 });
    });
  });

  describe('extractSurveyNumber', () => {
    test('parses Survey No. <num>, <location>', () => {
      const r = extractSurveyNumber('Survey No. 45/2, Devanahalli, Bangalore Rural');
      expect(r).toEqual({ surveyNumber: '45/2', location: 'Devanahalli, Bangalore Rural' });
    });

    test('parses S.No. abbreviation', () => {
      const r = extractSurveyNumber('S.No. 45/2A, Whitefield');
      expect(r.surveyNumber).toBe('45/2A');
      expect(r.location).toBe('Whitefield');
    });

    test('parses Sy.No. abbreviation', () => {
      const r = extractSurveyNumber('Sy.No. 102/3 Bommasandra');
      expect(r.surveyNumber).toBe('102/3');
    });

    test('parses without location', () => {
      const r = extractSurveyNumber('Survey No. 88');
      expect(r.surveyNumber).toBe('88');
      expect(r.location).toBeNull();
    });

    test('returns null for non-survey input', () => {
      expect(extractSurveyNumber('Apartment 45/2, Whitefield')).toBeNull();
      expect(extractSurveyNumber('5 acres at 2.5 cr')).toBeNull();
    });
  });

  describe('isLikelyFreeText', () => {
    test('detects broker narrative with area + price keywords', () => {
      const text = '5 acres of land available near KIAL airport road, Devanahalli, asking 18 Cr negotiable. Broker contact attached.';
      expect(isLikelyFreeText(text)).toBe(true);
    });

    test('rejects short address lines', () => {
      expect(isLikelyFreeText('Whitefield Phase 1, Bengaluru')).toBe(false);
    });

    test('detects narrative with promoter / approval keywords', () => {
      const text = 'Joint venture opportunity with established promoter, RERA registered project, located near Hebbal flyover, 3 acres available.';
      expect(isLikelyFreeText(text)).toBe(true);
    });

    test('rejects empty / null', () => {
      expect(isLikelyFreeText('')).toBe(false);
      expect(isLikelyFreeText(null)).toBe(false);
    });
  });

  describe('classifyInput', () => {
    test('classifies empty input', () => {
      expect(classifyInput('').type).toBe('empty');
      expect(classifyInput('   ').type).toBe('empty');
    });

    test('classifies Google Maps URL', () => {
      const r = classifyInput('https://maps.app.goo.gl/abc');
      expect(r.type).toBe('googleMapsUrl');
      expect(r.confidence).toBeGreaterThan(0.9);
    });

    test('classifies Plus Code', () => {
      const r = classifyInput('3JV8+P4W Bengaluru');
      expect(r.type).toBe('plusCode');
      expect(r.parsed.code).toBe('3JV8+P4W');
    });

    test('classifies pure lat/lng with high confidence', () => {
      const r = classifyInput('12.9716, 77.5946');
      expect(r.type).toBe('latLng');
      expect(r.parsed).toEqual({ lat: 12.9716, lng: 77.5946 });
      expect(r.confidence).toBeGreaterThan(0.9);
    });

    test('classifies lat/lng with surrounding text at lower confidence', () => {
      const r = classifyInput('Pin coords are 12.9716, 77.5946 for reference');
      expect(r.type).toBe('latLng');
      expect(r.confidence).toBeLessThan(0.9);
    });

    test('classifies survey number', () => {
      const r = classifyInput('Survey No. 45/2, Devanahalli');
      expect(r.type).toBe('surveyNumber');
      expect(r.parsed.surveyNumber).toBe('45/2');
    });

    test('classifies broker free text', () => {
      const text = '5 acres on KIAL road near airport, asking 18 cr, RERA-registered builder, JV preferred, contact 99xxxxx';
      const r = classifyInput(text);
      expect(r.type).toBe('freeText');
    });

    test('classifies plain address fallback', () => {
      const r = classifyInput('Whitefield Main Road, Bengaluru');
      expect(r.type).toBe('address');
    });

    test('Google Maps URL beats embedded coords', () => {
      // URL with coords inside — classification should be googleMapsUrl,
      // not latLng, because the URL is more specific.
      const r = classifyInput('https://www.google.com/maps/place/X/@12.97,77.59,17z');
      expect(r.type).toBe('googleMapsUrl');
    });

    test('Plus Code beats free text when both could match', () => {
      // A string that has both a Plus Code and narrative-ish length.
      const r = classifyInput('3JV8+P4W Whitefield, 5 acres available for outright sale at 18 crore');
      expect(r.type).toBe('plusCode');
    });
  });
});
