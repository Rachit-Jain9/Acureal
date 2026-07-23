'use strict';

// Deterministic parse-to-text stage. Every fixture here is a REAL file built
// in-memory by the same libraries that produce them in the wild (exceljs,
// jszip), so these tests exercise the actual byte-level parse path rather
// than a mock of it.

const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const {
  Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun,
} = require('docx');
const { parseDocumentToText, MAX_TEXT_CHARS } = require('../src/services/ai/documentTextExtractor');

const buildWorkbook = async (rows, sheetName = 'Rent Roll') => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
};

describe('parseDocumentToText — spreadsheets', () => {
  test('transcribes an XLSX rent roll to tab-separated rows, keeping the sheet name', async () => {
    const buffer = await buildWorkbook([
      ['Unit', 'Tenant', 'Area (sqft)', 'Rent/sqft'],
      ['G-01', 'Anchor Retail Pvt Ltd', 12000, 110],
      ['G-02', 'Cafe Coffee Day', 850, 240],
    ]);
    const { text, kind, meta } = await parseDocumentToText(buffer, 'roll.xlsx');
    expect(kind).toBe('spreadsheet');
    expect(meta.sheets).toBe(1);
    expect(text).toMatch(/### Sheet: Rent Roll/);
    expect(text).toMatch(/Unit\tTenant\tArea \(sqft\)\tRent\/sqft/);
    expect(text).toMatch(/G-01\tAnchor Retail Pvt Ltd\t12000\t110/);
  });

  // REGRESSION — production incident 2026-07-22. A real cash-flow workbook
  // failed extraction 8 times out of 8 with the raw JS string "Invalid time
  // value". Root cause: ExcelJS yields `new Date(NaN)` for a malformed or
  // out-of-range serial date; `instanceof Date` passes, so cellToText called
  // toISOString() and threw RangeError — aborting the ENTIRE workbook parse
  // before classification ever ran (which is why all 8 rows had doc_type NULL).
  // One unreadable cell must never cost the whole document.
  test('an invalid Date cell degrades to empty and does NOT abort the parse', async () => {
    const { cellToText } = require('../src/services/ai/documentTextExtractor').__internal;

    // The exact value ExcelJS hands back for a malformed serial date.
    expect(() => cellToText(new Date(NaN))).not.toThrow();
    expect(cellToText(new Date(NaN))).toBe('');

    // Valid dates still transcribe as ISO calendar dates.
    expect(cellToText(new Date('2026-03-09T00:00:00Z'))).toBe('2026-03-09');
  });

  test('a workbook containing an invalid date still transcribes its other cells', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Cash Flows');
    ws.addRow(['Period', 'Date', 'Inflow']);
    const row = ws.addRow(['Q1', null, 4200000]);
    // Plant the poison cell the way ExcelJS surfaces it from a corrupt serial.
    row.getCell(2).value = new Date(NaN);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    const { text } = await parseDocumentToText(buffer, 'Cash Flows Statement.xlsx');
    expect(text).toMatch(/### Sheet: Cash Flows/);
    expect(text).toMatch(/Period/);
    expect(text).toMatch(/4200000/);
  });

  test('reads Kannada cell content verbatim', async () => {
    const buffer = await buildWorkbook([['ಮಾಲೀಕರ ಹೆಸರು', 'ಸರ್ವೆ ಸಂಖ್ಯೆ'], ['ರಮೇಶ್ ಕುಮಾರ್', '೧೨೩/೪']]);
    const { text } = await parseDocumentToText(buffer, 'rtc.xlsx');
    expect(text).toMatch(/ಮಾಲೀಕರ ಹೆಸರು/);
    expect(text).toMatch(/ರಮೇಶ್ ಕುಮಾರ್/);
  });

  test('formula cells transcribe their CACHED RESULT, never the formula source', async () => {
    // Formula-injection posture, matching the deterministic template importer:
    // the model must never see "=cmd|..." or an attacker-authored formula.
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Calc');
    ws.addRow(['Total']);
    ws.getCell('A2').value = { formula: 'SUM(B1:B9)', result: 4200 };
    ws.getCell('A3').value = { formula: 'HYPERLINK("http://evil.example","click")', result: 'click' };
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    const { text } = await parseDocumentToText(buffer, 'calc.xlsx');
    expect(text).toMatch(/4200/);
    expect(text).toMatch(/click/);
    expect(text).not.toMatch(/SUM\(B1:B9\)/);
    expect(text).not.toMatch(/evil\.example/);
  });

  test('handles multiple sheets and skips fully empty rows', async () => {
    const wb = new ExcelJS.Workbook();
    const a = wb.addWorksheet('Leases');
    a.addRow(['Unit', 'Rent']); a.addRow([]); a.addRow(['G-01', 110]);
    const b = wb.addWorksheet('Assumptions');
    b.addRow(['Escalation', '15%']);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    const { text, meta } = await parseDocumentToText(buffer, 'pack.xlsx');
    expect(meta.sheets).toBe(2);
    expect(text).toMatch(/### Sheet: Leases/);
    expect(text).toMatch(/### Sheet: Assumptions/);
    expect(text).toMatch(/Escalation\t15%/);
  });

  test('an empty workbook is an honest error, not a silent empty extraction', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Blank');
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    await expect(parseDocumentToText(buffer, 'blank.xlsx')).rejects.toThrow(/No readable text/);
  });
});

describe('parseDocumentToText — delimited + structured data', () => {
  test('CSV passes through verbatim', async () => {
    const csv = Buffer.from('project,rate_psf,city\nBrigade Cornerstone,7450,Bengaluru\n', 'utf8');
    const { text, kind } = await parseDocumentToText(csv, 'comps.csv');
    expect(kind).toBe('delimited');
    expect(text).toMatch(/comma-separated/);
    expect(text).toMatch(/Brigade Cornerstone,7450,Bengaluru/);
  });

  test('TSV is labelled tab-separated', async () => {
    const { text } = await parseDocumentToText(Buffer.from('a\tb\n1\t2\n', 'utf8'), 'x.tsv');
    expect(text).toMatch(/tab-separated/);
  });

  test('valid JSON is pretty-printed', async () => {
    const { text, meta } = await parseDocumentToText(
      Buffer.from('{"survey_number":"123/4","area_sqft":45000}', 'utf8'), 'parcel.json',
    );
    expect(meta.valid).toBe(true);
    expect(text).toMatch(/"survey_number": "123\/4"/);
  });

  test('malformed JSON is transcribed raw AND says so (never presented as structured)', async () => {
    const { text, meta } = await parseDocumentToText(Buffer.from('{broken', 'utf8'), 'bad.json');
    expect(meta.valid).toBe(false);
    expect(text).toMatch(/does NOT parse as valid JSON/);
    expect(text).toMatch(/Do not assume any structure/);
  });

  test('GeoJSON is labelled as GeoJSON', async () => {
    const geo = JSON.stringify({ type: 'Feature', properties: { khata: '456' }, geometry: null });
    const { text } = await parseDocumentToText(Buffer.from(geo, 'utf8'), 'parcel.geojson');
    expect(text).toMatch(/^GeoJSON document/);
    expect(text).toMatch(/"khata": "456"/);
  });
});

describe('parseDocumentToText — KML / KMZ', () => {
  const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Placemark><name>Survey 123/4</name><description>Whitefield parcel</description>
<Polygon><outerBoundaryIs><LinearRing><coordinates>77.7,12.9 77.8,12.9 77.8,13.0</coordinates></LinearRing></outerBoundaryIs></Polygon>
</Placemark></Document></kml>`;

  test('KML flattens to element: value lines including coordinates', async () => {
    const { text, kind } = await parseDocumentToText(Buffer.from(KML, 'utf8'), 'parcel.kml');
    expect(kind).toBe('xml');
    expect(text).toMatch(/name: Survey 123\/4/);
    expect(text).toMatch(/description: Whitefield parcel/);
    expect(text).toMatch(/coordinates: 77\.7,12\.9/);
  });

  test('KMZ unzips to its KML and parses', async () => {
    const zip = new JSZip();
    zip.file('doc.kml', KML);
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const { text, meta } = await parseDocumentToText(buffer, 'parcel.kmz');
    expect(meta.archiveEntry).toBe('doc.kml');
    expect(text).toMatch(/name: Survey 123\/4/);
  });

  test('a KMZ with no KML inside fails with a readable message', async () => {
    const zip = new JSZip();
    zip.file('readme.txt', 'nothing here');
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    await expect(parseDocumentToText(buffer, 'empty.kmz')).rejects.toThrow(/contains no \.kml/);
  });

  test('an archive with too many entries is rejected (zip-bomb guard)', async () => {
    const zip = new JSZip();
    for (let i = 0; i < 600; i += 1) zip.file(`f${i}.kml`, '<kml/>');
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    await expect(parseDocumentToText(buffer, 'bomb.kmz')).rejects.toThrow(/above the 512 REDIP reads/);
  });
});

describe('parseDocumentToText — DOCX', () => {
  const cell = (t) => new TableCell({ children: [new Paragraph(t)] });

  const buildDocx = async (children) => {
    const doc = new Document({ sections: [{ children }] });
    return Packer.toBuffer(doc);
  };

  test('preserves table-cell boundaries as tab-separated rows (a smeared rent-roll table is useless)', async () => {
    const buffer = await buildDocx([
      new Paragraph({ children: [new TextRun('LEASE SCHEDULE')] }),
      new Table({
        rows: [
          new TableRow({ children: [cell('Unit'), cell('Tenant'), cell('Rent')] }),
          new TableRow({ children: [cell('G-01'), cell('Anchor Retail Pvt Ltd'), cell('110')] }),
        ],
      }),
    ]);
    const { text, kind } = await parseDocumentToText(buffer, 'lease.docx');
    expect(kind).toBe('docx');
    expect(text).toMatch(/LEASE SCHEDULE/);
    expect(text).toMatch(/Unit\tTenant\tRent/);
    expect(text).toMatch(/G-01\tAnchor Retail Pvt Ltd\t110/);
  });

  test('reads Kannada body and table text verbatim', async () => {
    const buffer = await buildDocx([
      new Paragraph({ children: [new TextRun('ಗುತ್ತಿಗೆ ಪತ್ರ')] }),
      new Table({ rows: [new TableRow({ children: [cell('ಮಾಲೀಕರು'), cell('ರಮೇಶ್ ಕುಮಾರ್')] })] }),
    ]);
    const { text } = await parseDocumentToText(buffer, 'kannada.docx');
    expect(text).toMatch(/ಗುತ್ತಿಗೆ ಪತ್ರ/);
    expect(text).toMatch(/ಮಾಲೀಕರು\tರಮೇಶ್ ಕುಮಾರ್/);
  });

  test('an empty document is an honest error, not a silent empty extraction', async () => {
    const buffer = await buildDocx([new Paragraph('')]);
    await expect(parseDocumentToText(buffer, 'blank.docx')).rejects.toThrow(/No readable text/);
  });
});

describe('parseDocumentToText — PPTX', () => {
  const slideXml = (text) => `<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;

  test('extracts text per slide, in numeric slide order', async () => {
    const zip = new JSZip();
    zip.file('ppt/slides/slide1.xml', slideXml('Whitefield Land Opportunity'));
    zip.file('ppt/slides/slide2.xml', slideXml('IRR 22%'));
    // slide10 must sort AFTER slide2 — lexicographic order would break this.
    zip.file('ppt/slides/slide10.xml', slideXml('Appendix'));
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    const { text, kind, meta } = await parseDocumentToText(buffer, 'ic.pptx');
    expect(kind).toBe('pptx');
    expect(meta.slides).toBe(3);
    expect(text).toMatch(/### Slide 1\nWhitefield Land Opportunity/);
    expect(text.indexOf('### Slide 2')).toBeLessThan(text.indexOf('### Slide 10'));
  });

  test('a deck with no slides fails with a readable message', async () => {
    const zip = new JSZip();
    zip.file('ppt/presentation.xml', '<p:presentation/>');
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    await expect(parseDocumentToText(buffer, 'empty.pptx')).rejects.toThrow(/no readable slides/);
  });
});

describe('parseDocumentToText — guards', () => {
  test('refuses a stored_only format by name', async () => {
    await expect(parseDocumentToText(Buffer.from('x'), 'plan.dwg'))
      .rejects.toThrow(/not a parseable document format/);
  });

  test('refuses an empty buffer', async () => {
    await expect(parseDocumentToText(Buffer.alloc(0), 'a.csv')).rejects.toThrow(/File is empty/);
  });

  // Regression: every parser prepends an explanatory preamble ("transcribed by
  // REDIP…"). If the preamble were composed unconditionally, a content-free
  // file would return non-empty text, sail past the empty-document guard, and
  // be sent to the model — which would then answer from REDIP's own header.
  // The guard must see the DOCUMENT's contribution, not the wrapper.
  test.each([
    ['whitespace-only CSV', '   \n  \n', 'blank.csv'],
    ['whitespace-only text', '\n\n\n', 'blank.txt'],
  ])('a content-free file is an honest error, not a preamble-only "extraction" (%s)', async (_label, content, name) => {
    await expect(parseDocumentToText(Buffer.from(content, 'utf8'), name))
      .rejects.toThrow(/No readable text found/);
  });

  test('caps enormous output and ANNOUNCES the truncation', async () => {
    // Wide enough that the character cap (not the row cap) is what bites:
    // ~4,000 rows × ~170 chars ≈ 680k > MAX_TEXT_CHARS.
    const filler = 'a deliberately long registered legal entity name Private Limited, Bengaluru, Karnataka'; // ~85 chars
    const rows = [['Unit', 'Tenant', 'Rent']];
    for (let i = 0; i < 4000; i += 1) {
      rows.push([`U-${i}`, `Tenant number ${i} — ${filler} — ${filler}`, 100000 + i]);
    }
    const buffer = await buildWorkbook(rows);
    const { text } = await parseDocumentToText(buffer, 'huge.xlsx');
    expect(text.length).toBeLessThanOrEqual(MAX_TEXT_CHARS + 400);
    // The model (and reviewer) must know the tail is missing — a silent cut
    // would let a partial read masquerade as a complete one.
    expect(text).toMatch(/output truncated/);
    expect(text).toMatch(/Treat any "total" or "count" as covering only the rows shown/);
  });

  test('caps a very tall sheet at the row limit and says so', async () => {
    const rows = [['Unit', 'Rent']];
    for (let i = 0; i < 5200; i += 1) rows.push([`U-${i}`, 100 + i]); // > MAX_SHEET_ROWS (5,000)
    const buffer = await buildWorkbook(rows);
    const { text, meta } = await parseDocumentToText(buffer, 'tall.xlsx');
    expect(meta.rowLimited).toBe(true);
    expect(text).toMatch(/exceeded 5,000 rows and were cut off/);
  });
});
