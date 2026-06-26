'use strict';

// Regression guard for the per-row comp-provenance treatment (audit #26 +
// CLAUDE.md hard rule "always surface source, freshness, and confidence"). Pins
// (a) the export comps query carries the provenance columns, (b) each export
// format renders via the deterministic deriver, and (c) the old overclaims —
// where a null is_verified read as "Verified"/"Yes", and possession_year (a
// FUTURE milestone) posed as data freshness — cannot creep back in.

const fs = require('fs');
const path = require('path');
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', 'src', rel), 'utf8');

describe('comps provenance is wired into every export path', () => {
  test('export comps query selects the provenance columns', () => {
    const src = read('services/dealExport.service.js');
    expect(src).toMatch(/data_type, source_url, as_of_date, updated_at/);
  });

  test('DOCX renders the provenance line and drops the bare null->Yes verified cell', () => {
    const src = read('services/exports/docx/buildReport.js');
    expect(src).toMatch(/formatProvenanceLine\(c\)/);
    expect(src).toMatch(/deriveCompProvenance/);
    expect(src).not.toMatch(/is_verified === false \? 'No' : 'Yes'/);
  });

  test('PPTX uses the honest deriver and fixes the verified-count overclaim', () => {
    const src = read('services/exports/pptx/slides.js');
    expect(src).toMatch(/deriveCompProvenance/);
    expect(src).not.toMatch(/is_verified === false \? 'No' : 'Yes'/);
    expect(src).not.toMatch(/is_verified !== false/); // the null-counts-as-verified bug
    expect(src).not.toMatch(/TOP VERIFIED COMPARABLES/); // overclaiming title
  });

  test('reportPack renders a provenance table and counts only is_verified===true', () => {
    const src = read('services/exports/reportPack/composePack.js');
    expect(src).toMatch(/deriveCompProvenance/);
    expect(src).not.toMatch(/\.filter\(\(c\) => c\.is_verified !== false\)/);
    expect(src).toMatch(/c\.is_verified === true/);
  });

  test('XLSX source-register freshness is the as-of date, never possession_year', () => {
    const src = read('services/exports/xlsx/v2/buildWorkbook.js');
    expect(src).not.toMatch(/comps\[0\]\?\.possession_year/);
    expect(src).toMatch(/formatAbsoluteDate/);
  });
});
