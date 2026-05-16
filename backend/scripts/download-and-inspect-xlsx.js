#!/usr/bin/env node

/**
 * download-and-inspect-xlsx.js — bypass Excel to capture pristine REDIP output.
 *
 * Why this script exists:
 *   The Pointec Pens hospitality Dashboard bug evaded 4 rounds of fixes
 *   (#327, #329, #332, #333) because Excel auto-repairs the file on open
 *   AND saves the repaired version. We can never see what REDIP actually
 *   shipped — only what Excel left after repair.
 *
 *   This script downloads the workbook directly via HTTP (no Excel involved),
 *   unzips it in-memory, and dumps per-sheet diagnostics. Operator runs this
 *   instead of double-clicking the file, and we see the pristine pre-repair
 *   state.
 *
 * Usage:
 *   1. Open a deal in your browser, log in, copy the auth cookie.
 *   2. Run:
 *      DEAL_URL='https://redip.vercel.app/api/exports/xlsx/v2/<deal-id>' \
 *      AUTH_COOKIE='session=...' \
 *      node backend/scripts/download-and-inspect-xlsx.js
 *
 *   3. Share the console output. It tells us exactly which sheets have
 *      content, which are empty, and which (if any) have malformed XML.
 *
 * What this script CANNOT do:
 *   It runs ENTIRELY against the deployed Vercel build. If Vercel is still
 *   deploying your latest commit, this will hit the previous deploy.
 *
 * What it CAN do:
 *   Show whether the empty-Dashboard bug is server-side (REDIP ships empty)
 *   or client-side (REDIP ships full, Excel scrubs on open). That alone
 *   tells us where to focus the next fix.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const JSZip = require('jszip');

const dealUrl = process.env.DEAL_URL;
const authCookie = process.env.AUTH_COOKIE;

if (!dealUrl) {
  console.error('Set DEAL_URL env var to the deal export URL.');
  console.error('Example: DEAL_URL="https://redip.vercel.app/api/exports/xlsx/v2/8548ba23-625b-40c5-8c47-6a6a74fdc082"');
  process.exit(1);
}

console.log(`Downloading from: ${dealUrl}`);
if (!authCookie) {
  console.warn('⚠ No AUTH_COOKIE set — the request may fail with 401/403 if the endpoint requires auth.');
}

const downloadBuffer = (url) => new Promise((resolve, reject) => {
  const opts = { headers: {} };
  if (authCookie) opts.headers.Cookie = authCookie;
  https.get(url, opts, (res) => {
    if (res.statusCode === 301 || res.statusCode === 302) {
      console.log(`  → redirected to: ${res.headers.location}`);
      return downloadBuffer(res.headers.location).then(resolve, reject);
    }
    if (res.statusCode !== 200) {
      return reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
    }
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve(Buffer.concat(chunks)));
    res.on('error', reject);
    return undefined;
  }).on('error', reject);
});

(async () => {
  let buffer;
  try {
    buffer = await downloadBuffer(dealUrl);
  } catch (err) {
    console.error(`Download failed: ${err.message}`);
    process.exit(1);
  }

  console.log(`Downloaded ${buffer.length.toLocaleString()} bytes`);

  // Save pristine copy
  const outPath = path.join(process.cwd(), `pristine-${Date.now()}.xlsx`);
  fs.writeFileSync(outPath, buffer);
  console.log(`Pristine file saved to: ${outPath}`);
  console.log('  ⚠ DO NOT open this in Excel — that would auto-repair it and we\'d lose the pristine state.');
  console.log('');

  // Unzip + inspect
  const zip = await JSZip.loadAsync(buffer);

  // 1. Map sheets
  const wbXml = await zip.file('xl/workbook.xml').async('string');
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const rIdToTarget = {};
  for (const m of relsXml.matchAll(/<Relationship\s+Id="(rId\d+)"\s+[^>]*Target="([^"]+)"/g)) {
    rIdToTarget[m[1]] = m[2];
  }
  const sheetMap = {};
  for (const m of wbXml.matchAll(/<sheet\s+name="([^"]+)"\s+sheetId="\d+"\s+(?:state="[^"]+"\s+)?r:id="(rId\d+)"/g)) {
    const name = m[1].replace(/&amp;/g, '&');
    const target = rIdToTarget[m[2]];
    if (target) sheetMap[target.replace(/^.*\//, '')] = name;
  }

  // 2. Per-sheet diagnostics
  console.log('=== PER-SHEET DIAGNOSTICS ===');
  const sheetFiles = zip.file(/^xl\/worksheets\/sheet\d+\.xml$/).sort((a, b) => a.name.localeCompare(b.name));
  for (const file of sheetFiles) {
    const xml = await file.async('string');
    const basename = file.name.replace(/^.*\//, '');
    const displayName = sheetMap[basename] || basename;
    const cellCount = (xml.match(/<c\s+r="/g) || []).length;
    const isEmpty = /<sheetData\s*\/>/.test(xml);
    const formulaCount = (xml.match(/<f\b/g) || []).length;
    const cfRuleCount = (xml.match(/<cfRule\b/g) || []).length;
    const mergedCells = (xml.match(/<mergeCell\b/g) || []).length;
    const flag = isEmpty ? ' ⚠ EMPTY' : '';
    console.log(`  ${basename.padEnd(12)} (${displayName.padEnd(35)}): ${String(cellCount).padStart(4)} cells, ${String(xml.length).padStart(7)} bytes, ${String(formulaCount).padStart(3)} formulas, ${String(cfRuleCount).padStart(3)} CF rules, ${String(mergedCells).padStart(3)} merges${flag}`);
  }
  console.log('');

  // 3. Comments + drawings
  console.log('=== COMMENTS / DRAWINGS / CHARTS ===');
  for (const m of [/^xl\/comments\d+\.xml$/, /^xl\/drawings\/drawing\d+\.xml$/, /^xl\/charts\/chart\d+\.xml$/]) {
    const files = zip.file(m);
    for (const f of files) {
      console.log(`  ${f.name}: ${(await f.async('string')).length.toLocaleString()} bytes`);
    }
    if (files.length === 0) {
      console.log(`  (no files matching ${m})`);
    }
  }
  console.log('');

  // 4. Named ranges
  const definedNames = [...wbXml.matchAll(/<definedName\s+name="([^"]+)"/g)].map((x) => x[1]);
  console.log(`=== NAMED RANGES: ${definedNames.length} total ===`);
  const critical = ['OccupancyPct', 'VacancyPct', 'BaseRentPerSqftMonth', 'ExitCapRate',
    'ExitCapRatePct', 'TotalProjectCostCr', 'SaleableAreaSqft', 'TotalExitCostPct',
    'HospitalityKeys', 'HospitalityADRBase', 'HospitalityOccupancyPct'];
  for (const n of critical) {
    console.log(`  ${definedNames.includes(n) ? 'OK' : 'MISSING'}: ${n}`);
  }
  console.log('');

  // 5. Workbook generation metadata
  const coreXml = await zip.file('docProps/core.xml').async('string');
  const created = (coreXml.match(/<dcterms:created[^>]*>([^<]+)/) || [])[1];
  const modified = (coreXml.match(/<dcterms:modified[^>]*>([^<]+)/) || [])[1];
  console.log('=== FILE METADATA ===');
  console.log(`  Created : ${created}`);
  console.log(`  Modified: ${modified}`);
  console.log(`  Diff    : ${created === modified ? 'pristine (never opened in Excel)' : 'Excel touched the file'}`);
  console.log('');

  // 6. Summary verdict
  const dashFile = sheetFiles.find((f) => sheetMap[f.name.replace(/^.*\//, '')] === 'Dashboard');
  if (dashFile) {
    const xml = await dashFile.async('string');
    const cellCount = (xml.match(/<c\s+r="/g) || []).length;
    console.log('=== VERDICT ===');
    if (cellCount === 0) {
      console.log('  ⛔ DASHBOARD SHIPS EMPTY FROM REDIP — server-side bug.');
      console.log('     The fix needs to happen in the build pipeline.');
      console.log('     Share this output with the dev so they can pinpoint the corruption.');
    } else if (cellCount < 100) {
      console.log(`  ⚠ DASHBOARD SHIPS SPARSE (${cellCount} cells) — partial render.`);
      console.log('     The build pipeline failed mid-render. Look at server logs for errors.');
    } else {
      console.log(`  ✓ DASHBOARD SHIPS RENDERED (${cellCount} cells).`);
      console.log('     If you opened this file in Excel and saw an empty Dashboard, the bug is');
      console.log('     EXCEL-SIDE — something in REDIP\'s XML triggers Excel\'s auto-repair.');
      console.log('     The fix needs strict XML validation that mimics Excel\'s parser.');
    }
  } else {
    console.log('=== VERDICT ===');
    console.log('  ⛔ Could not locate the Dashboard sheet at all — workbook structure is broken.');
  }
})();
