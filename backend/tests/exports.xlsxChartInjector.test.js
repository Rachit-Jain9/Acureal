'use strict';

const JSZip = require('jszip');
const ExcelJS = require('exceljs');
const {
  injectChartsIntoXlsx,
  __internal,
} = require('../src/services/exports/xlsx/v2/chartInjector');

// Build a minimal 2-sheet workbook buffer so the injector has something
// real to splice into. ExcelJS produces well-formed sheetN.xml files
// that mirror what `buildWorkbook.js` writes.
const makeMinimalWorkbookBuffer = async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Inputs');
  const dash = wb.addWorksheet('Dashboard');
  // Populate cells the chart will reference.
  dash.getCell('A1').value = 'Use: Land';
  dash.getCell('B1').value = 85;
  dash.getCell('A2').value = 'Use: Construction';
  dash.getCell('B2').value = 181;
  dash.getCell('A3').value = 'Use: Approvals';
  dash.getCell('B3').value = 0;
  const raw = await wb.xlsx.writeBuffer();
  return Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
};

describe('services/exports/xlsx/v2/chartInjector', () => {
  describe('XML builders', () => {
    test('buildDoughnutChartXml produces a chartSpace with doughnutChart inside', () => {
      const xml = __internal.buildDoughnutChartXml({
        title: 'Test Doughnut',
        sheetName: 'Dashboard',
        categoriesRange: '$A$1:$A$3',
        valuesRange: '$B$1:$B$3',
        colours: ['0E1B2C', 'B5793C', '0F7B5A'],
      });
      expect(xml).toMatch(/<c:chartSpace/);
      expect(xml).toMatch(/<c:doughnutChart>/);
      // Sheet name quoted with embedded ! for the cell range
      expect(xml).toMatch(/'Dashboard'!\$A\$1:\$A\$3/);
      expect(xml).toMatch(/'Dashboard'!\$B\$1:\$B\$3/);
      // Title text
      expect(xml).toMatch(/<a:t>Test Doughnut<\/a:t>/);
      // Each colour gets a dPt block
      expect(xml).toMatch(/<a:srgbClr val="0E1B2C"\/>/);
      expect(xml).toMatch(/<a:srgbClr val="B5793C"\/>/);
      // Hole size + first slice angle
      expect(xml).toMatch(/<c:holeSize val="55"\/>/);
    });

    test('buildBarChartXml renders one ser per series + barDir', () => {
      const xml = __internal.buildBarChartXml({
        title: 'Quarterly Trend',
        sheetName: 'Dashboard',
        categoriesRange: '$A$38:$A$53',
        barDir: 'col',
        series: [
          { name: 'Sales', valuesRange: '$B$38:$B$53', colour: '0F7B5A' },
          { name: 'Construction', valuesRange: '$C$38:$C$53', colour: 'B23A48' },
        ],
      });
      expect(xml).toMatch(/<c:barChart>/);
      expect(xml).toMatch(/<c:barDir val="col"\/>/);
      // Both series labels emitted
      expect(xml).toMatch(/<c:v>Sales<\/c:v>/);
      expect(xml).toMatch(/<c:v>Construction<\/c:v>/);
      // Both colours
      expect(xml).toMatch(/<a:srgbClr val="0F7B5A"\/>/);
      expect(xml).toMatch(/<a:srgbClr val="B23A48"\/>/);
      // Legend renders for multi-series
      expect(xml).toMatch(/<c:legend>/);
      // Cat + val axes both declared
      expect(xml).toMatch(/<c:catAx>/);
      expect(xml).toMatch(/<c:valAx>/);
    });

    test('buildBarChartXml omits legend on single-series', () => {
      const xml = __internal.buildBarChartXml({
        title: 'Single Series',
        sheetName: 'Dashboard',
        categoriesRange: '$A$1:$A$5',
        series: [{ name: 'Only', valuesRange: '$B$1:$B$5', colour: '0E1B2C' }],
      });
      expect(xml).toMatch(/<c:barChart>/);
      expect(xml).not.toMatch(/<c:legend>/);
    });

    test('buildDrawingXml emits one oneCellAnchor per chart anchor', () => {
      const xml = __internal.buildDrawingXml([
        { fromCol: 7, fromRow: 10, widthCols: 6, heightRows: 12 },
        { fromCol: 0, fromRow: 54, widthCols: 13, heightRows: 14 },
      ]);
      const anchors = (xml.match(/<xdr:oneCellAnchor>/g) || []);
      expect(anchors.length).toBe(2);
      // Charts reference rId1 + rId2 in order
      expect(xml).toMatch(/r:id="rId1"/);
      expect(xml).toMatch(/r:id="rId2"/);
    });

    test('ensureContentTypes adds drawing + chart overrides idempotently', () => {
      const base = '<?xml version="1.0"?><Types xmlns="x"><Default/></Types>';
      const out = __internal.ensureContentTypes(base, 2);
      expect(out).toMatch(/\/xl\/drawings\/drawing1\.xml/);
      expect(out).toMatch(/\/xl\/charts\/chart1\.xml/);
      expect(out).toMatch(/\/xl\/charts\/chart2\.xml/);
      // Running twice should be a no-op (idempotent)
      const out2 = __internal.ensureContentTypes(out, 2);
      const drawingMatches = (out2.match(/\/xl\/drawings\/drawing1\.xml/g) || []).length;
      expect(drawingMatches).toBe(1);
    });
  });

  describe('injectChartsIntoXlsx (end-to-end)', () => {
    test('produces a valid xlsx with chart XML embedded + drawing reference on target sheet', async () => {
      const buffer = await makeMinimalWorkbookBuffer();
      const enhanced = await injectChartsIntoXlsx(buffer, {
        targetSheetName: 'Dashboard',
        targetSheetFile: 'sheet2.xml',  // 2nd sheet (we built Inputs first)
        charts: [{
          type: 'doughnut',
          title: 'Test',
          categoriesRange: '$A$1:$A$3',
          valuesRange: '$B$1:$B$3',
          colours: ['0E1B2C', 'B5793C', '0F7B5A'],
          anchor: { fromCol: 4, fromRow: 0, widthCols: 6, heightRows: 12 },
        }],
      });

      expect(Buffer.isBuffer(enhanced)).toBe(true);
      expect(enhanced.slice(0, 2).toString('ascii')).toBe('PK');

      const zip = await JSZip.loadAsync(enhanced);
      expect(zip.file('xl/charts/chart1.xml')).not.toBeNull();
      expect(zip.file('xl/drawings/drawing1.xml')).not.toBeNull();
      expect(zip.file('xl/drawings/_rels/drawing1.xml.rels')).not.toBeNull();

      const sheetXml = await zip.file('xl/worksheets/sheet2.xml').async('string');
      expect(sheetXml).toMatch(/<drawing\s+r:id="rId\d+"\s*\/>/);
    });

    test('roundtrips through ExcelJS without error (a basic Excel-compat check)', async () => {
      const buffer = await makeMinimalWorkbookBuffer();
      const enhanced = await injectChartsIntoXlsx(buffer, {
        targetSheetName: 'Dashboard',
        targetSheetFile: 'sheet2.xml',
        charts: [{
          type: 'doughnut',
          title: 'Roundtrip',
          categoriesRange: '$A$1:$A$3',
          valuesRange: '$B$1:$B$3',
          colours: ['0E1B2C', 'B5793C', '0F7B5A'],
          anchor: { fromCol: 4, fromRow: 0, widthCols: 6, heightRows: 12 },
        }],
      });

      // If our XML / rels are malformed in a way Excel would reject,
      // ExcelJS's own loader typically throws here. Compatibility isn't
      // perfect but this catches the obvious structural mistakes.
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(enhanced);
      expect(wb.worksheets.map((w) => w.name)).toContain('Dashboard');
    });

    test('returns the input buffer untouched when no charts are passed', async () => {
      const buffer = await makeMinimalWorkbookBuffer();
      const result = await injectChartsIntoXlsx(buffer, {
        targetSheetName: 'Dashboard',
        targetSheetFile: 'sheet2.xml',
        charts: [],
      });
      expect(result).toBe(buffer);
    });

    test('throws on unsupported chart type', async () => {
      const buffer = await makeMinimalWorkbookBuffer();
      await expect(injectChartsIntoXlsx(buffer, {
        targetSheetName: 'Dashboard',
        targetSheetFile: 'sheet2.xml',
        charts: [{
          type: 'tornado',   // not yet supported
          title: 'X',
          anchor: { fromCol: 0, fromRow: 0, widthCols: 1, heightRows: 1 },
        }],
      })).rejects.toThrow(/unsupported chart type/);
    });
  });
});
