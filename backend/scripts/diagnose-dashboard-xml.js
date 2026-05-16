#!/usr/bin/env node

// One-shot diagnostic script (2026-05-15 production-bug postmortem):
// Generate a fresh workbook, unzip in-memory, and dump the comments XML
// + Dashboard sheet XML so we can confirm the hotfix produces well-formed
// XML that Microsoft Excel will accept (Jest tests passed even when the
// production file failed Excel's stricter parser).
//
// Run: node backend/scripts/diagnose-dashboard-xml.js

'use strict';

const path = require('path');
const fs = require('fs');
const JSZip = require('jszip');
const { buildDealWorkbookV2 } = require('../src/services/exports/xlsx/v2/buildWorkbook');

// Match the Pointec Pens hospitality fixture that broke in production
const hospitalityContext = () => ({
  deal: {
    id: 999,
    name: 'Pointec Pens (hospitality, diagnostic)',
    asset_class: 'hospitality',
    deal_type: 'outright_purchase',
    city: 'Bengaluru',
    state: 'Karnataka',
    project_duration_months: 48,
    model_params: {
      inputs: {
        sellingRatePerSqft: 0,
        landCostCr: 35,
        constructionCostPerSqft: 6400,
        approvalCostCr: 5,
        debtLTV: 0.55,
        debtRatePct: 0.115,
        hospitalityKeys: 250,
        hospitalityADRBase: 7500,
        hospitalityOccupancyPct: 0.70,
        exitCapRate: 0.095,
      },
    },
  },
  property: {
    property_name: 'Pointec Pens hospitality (diagnostic)',
    city: 'Bengaluru',
    micro_market: 'CBD',
    land_area_sqft: 60000,
    saleable_area_sqft: 220000,
    existing_fsi: 2.5,
    property_type: 'hospitality',
  },
});

(async () => {
  console.log('Building workbook from hospitality fixture…');
  const buffer = await buildDealWorkbookV2(hospitalityContext());
  console.log(`Workbook size: ${buffer.length.toLocaleString()} bytes`);

  const zip = await JSZip.loadAsync(buffer);
  const outDir = path.join(__dirname, '..', '..', 'tmp', 'diag');
  fs.mkdirSync(outDir, { recursive: true });

  // Dump Dashboard sheet (sheet2 after Executive Briefing)
  const sheetFiles = zip.file(/^xl\/worksheets\/sheet\d+\.xml$/);
  for (const file of sheetFiles) {
    const xml = await file.async('string');
    const out = path.join(outDir, path.basename(file.name));
    fs.writeFileSync(out, xml);
    const hasDashboard = xml.includes('Dashboard');
    const cellCount = (xml.match(/<c\s+r="/g) || []).length;
    const emptyShell = /<sheetData\s*\/>/.test(xml);
    console.log(`  ${path.basename(file.name)}: ${cellCount} cells${hasDashboard ? ' (Dashboard)' : ''}${emptyShell ? ' ⚠ EMPTY SHELL' : ''}`);
  }

  // Dump comments XML
  const commentFiles = zip.file(/^xl\/comments\d+\.xml$/);
  for (const file of commentFiles) {
    const xml = await file.async('string');
    const out = path.join(outDir, path.basename(file.name));
    fs.writeFileSync(out, xml);
    const kpiBenchmarks = (xml.match(/KPI Benchmark/g) || []).length;
    const insetMode = /insetmode/i.test(xml);
    const objectLeak = /\[object Object\]/.test(xml);
    const openTexts = (xml.match(/<text>/g) || []).length;
    const closeTexts = (xml.match(/<\/text>/g) || []).length;
    console.log(`  ${path.basename(file.name)}: ${kpiBenchmarks} KPI Benchmark notes${insetMode ? ' ⚠ INSETMODE' : ''}${objectLeak ? ' ⚠ [object Object] LEAK' : ''}${openTexts !== closeTexts ? ` ⚠ TEXT TAG MISMATCH (${openTexts}/${closeTexts})` : ''}`);
  }

  // Write a copy of the full buffer for manual Excel-open inspection
  const fullPath = path.join(outDir, 'diagnostic-workbook.xlsx');
  fs.writeFileSync(fullPath, buffer);
  console.log(`\nFull workbook written to: ${fullPath}`);
  console.log('Open it in Microsoft Excel to confirm no repair dialog appears.');
})();
