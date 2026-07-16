'use strict';

// Parity guard: backend and frontend each ship a copy of the document-format
// registry (CommonJS for backend, ESM for the SPA). The two are read by
// different runtimes so we can't import from one place — but they MUST stay
// identical, or the file picker offers types the presign step rejects (the
// exact drift this registry was created to end).
// This test reads the frontend file as text, strips the ESM `export ` keywords,
// evals it under a CommonJS shim, and asserts both copies agree — entry by
// entry, and on every derived helper.
// (Same pattern as rentRollMetrics.parity.test.js.)

const fs = require('fs');
const path = require('path');
const Module = require('module');

const backend = require('../src/constants/documentFormats');

const frontendPath = path.join(__dirname, '..', '..', 'frontend', 'src', 'utils', 'documentFormats.js');
const frontendSrc = fs.readFileSync(frontendPath, 'utf8');

const exportNames = [];
const stripped = frontendSrc.replace(/^export\s+(const|function|let)\s+(\w+)/gm, (_, kind, name) => {
  exportNames.push(name);
  return `${kind} ${name}`;
});
const cjsSource = `${stripped}\nmodule.exports = { ${exportNames.join(', ')} };\n`;

const m = new Module('frontend-documentFormats');
m._compile(cjsSource, 'frontend/src/utils/documentFormats.js');
const frontend = m.exports;

describe('documentFormats parity — backend CommonJS vs frontend ESM mirror', () => {
  test('the mirror carries no CommonJS artifact (it is evaluated as a live ES module in the browser)', () => {
    // A stray `module.exports` / `require` / `process` throws "module is not
    // defined" at module-eval time in the browser and takes the tab down —
    // bundling would NOT catch it (PR #981 shipped exactly that regression).
    expect(frontendSrc).not.toMatch(/^\s*(module\.exports|exports\.)/m);
    expect(frontendSrc).not.toMatch(/\brequire\s*\(/);
    expect(frontendSrc).not.toMatch(/\bprocess\.env\b/);
  });

  test('DOCUMENT_FORMATS is identical (same extensions, same mime/tier/label)', () => {
    expect(Object.keys(frontend.DOCUMENT_FORMATS).sort())
      .toEqual(Object.keys(backend.DOCUMENT_FORMATS).sort());
    for (const ext of Object.keys(backend.DOCUMENT_FORMATS)) {
      expect(frontend.DOCUMENT_FORMATS[ext]).toEqual(backend.DOCUMENT_FORMATS[ext]);
    }
  });

  test('derived lists agree', () => {
    expect(frontend.ALLOWED_EXTENSIONS).toEqual(backend.ALLOWED_EXTENSIONS);
    expect(frontend.ACCEPT_ATTRIBUTE).toBe(backend.ACCEPT_ATTRIBUTE);
    expect(frontend.FALLBACK_MIME).toBe(backend.FALLBACK_MIME);
    expect(frontend.EXTENSIONS_BY_TIER.native).toEqual(backend.EXTENSIONS_BY_TIER.native);
    expect(frontend.EXTENSIONS_BY_TIER.parseable).toEqual(backend.EXTENSIONS_BY_TIER.parseable);
    expect(frontend.EXTENSIONS_BY_TIER.stored_only).toEqual(backend.EXTENSIONS_BY_TIER.stored_only);
  });

  test('helpers agree across every registered extension + adversarial inputs', () => {
    const cases = [
      ...Object.keys(backend.DOCUMENT_FORMATS),
      ...Object.keys(backend.DOCUMENT_FORMATS).map((e) => `deal-pack${e.toUpperCase()}`),
      'rent roll.final.v2.xlsx',
      'ಕನ್ನಡ-ಪತ್ರ.pdf',
      'no-extension',
      '',
      null,
      undefined,
      '.unknown',
      'archive.tar.gz',
    ];
    for (const c of cases) {
      expect(frontend.normalizeExtension(c)).toBe(backend.normalizeExtension(c));
      expect(frontend.isAllowedExtension(c)).toBe(backend.isAllowedExtension(c));
      expect(frontend.mimeForFile(c)).toBe(backend.mimeForFile(c));
      expect(frontend.labelFor(c)).toBe(backend.labelFor(c));
      expect(frontend.unsupportedExtractionMessage(c)).toBe(backend.unsupportedExtractionMessage(c));
      expect(frontend.extractionTierFor({ fileName: c })).toBe(backend.extractionTierFor({ fileName: c }));
      expect(frontend.isExtractable({ fileName: c })).toBe(backend.isExtractable({ fileName: c }));
    }
  });

  test('MIME-only resolution agrees (documents stored without an extension)', () => {
    const mimes = ['application/pdf', 'image/png', 'text/csv', 'image/vnd.dwg', 'application/octet-stream', 'text/csv; charset=utf-8', ''];
    for (const mime of mimes) {
      expect(frontend.extractionTierFor({ fileName: '', fileType: mime }))
        .toBe(backend.extractionTierFor({ fileName: '', fileType: mime }));
    }
  });
});

describe('documentFormats — registry invariants', () => {
  test('every extension starts with a dot, is lowercase, and has mime + tier + label', () => {
    for (const [ext, def] of Object.entries(backend.DOCUMENT_FORMATS)) {
      expect(ext).toMatch(/^\.[a-z0-9]+$/);
      expect(def.mime).toBeTruthy();
      expect(['native', 'parseable', 'stored_only']).toContain(def.tier);
      expect(def.label).toBeTruthy();
    }
  });

  test('native tier holds ONLY provider-documented types (PDF + Gemini-supported images)', () => {
    // Guard against optimistic additions: an undocumented type in this tier
    // reaches the provider as inline bytes and fails there, surfacing to the
    // user as a mystery extraction error rather than an honest "can't read".
    expect(backend.EXTENSIONS_BY_TIER.native).toEqual(
      ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.heic', '.heif'],
    );
  });

  test('formats users asked for are registered with an honest tier', () => {
    // The operator's list (2026-07-16). Each must be uploadable; the tier is
    // the honest claim about whether REDIP can read it.
    expect(backend.extractionTierFor({ fileName: 'a.pdf' })).toBe('native');
    expect(backend.extractionTierFor({ fileName: 'a.png' })).toBe('native');
    expect(backend.extractionTierFor({ fileName: 'a.jpeg' })).toBe('native');
    expect(backend.extractionTierFor({ fileName: 'a.docx' })).toBe('parseable');
    expect(backend.extractionTierFor({ fileName: 'a.pptx' })).toBe('parseable');
    expect(backend.extractionTierFor({ fileName: 'a.xlsx' })).toBe('parseable');
    expect(backend.extractionTierFor({ fileName: 'a.csv' })).toBe('parseable');
    expect(backend.extractionTierFor({ fileName: 'a.json' })).toBe('parseable');
    expect(backend.extractionTierFor({ fileName: 'a.kml' })).toBe('parseable');
    expect(backend.extractionTierFor({ fileName: 'a.kmz' })).toBe('parseable');
    // CAD / SketchUp / Primavera / BIM / GIS binaries: stored, never faked.
    for (const f of ['a.dwg', 'a.dxf', 'a.skp', 'a.xer', 'a.mpp', 'a.ifc', 'a.rvt', 'a.shp']) {
      expect(backend.extractionTierFor({ fileName: f })).toBe('stored_only');
      expect(backend.isAllowedExtension(f)).toBe(true); // uploadable, just not readable
    }
  });

  test('unknown types fail CLOSED to stored_only (never guessed at the provider)', () => {
    expect(backend.extractionTierFor({ fileName: 'mystery.qqq' })).toBe('stored_only');
    expect(backend.extractionTierFor({})).toBe('stored_only');
    expect(backend.isAllowedExtension('malware.exe')).toBe(false);
    expect(backend.isAllowedExtension('script.sh')).toBe(false);
    expect(backend.isAllowedExtension('lib.dll')).toBe(false);
  });

  test('the unsupported-format sentence names the format and offers a way forward', () => {
    const msg = backend.unsupportedExtractionMessage('site-plan.dwg');
    expect(msg).toMatch(/AutoCAD drawing/);
    expect(msg).toMatch(/stored and downloadable/);
    expect(msg).toMatch(/PDF, Excel, or an image/);
  });
});
