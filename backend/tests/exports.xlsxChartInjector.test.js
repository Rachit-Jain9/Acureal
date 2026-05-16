'use strict';

const JSZip = require('jszip');
const ExcelJS = require('exceljs');
const {
  injectChartsIntoXlsx,
  injectSparklinesIntoXlsx,
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
        title: 'Monthly Trend',
        sheetName: 'Dashboard',
        categoriesRange: '$A$39:$A$62',
        barDir: 'col',
        series: [
          { name: 'Sales', valuesRange: '$B$39:$B$62', colour: '0F7B5A' },
          { name: 'Construction', valuesRange: '$C$39:$C$62', colour: 'B23A48' },
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

    // PR-F: combo chart for the Monthly Trend Dashboard chart.
    // Office's combo pattern: barChart + lineChart inside the same
    // <c:plotArea>, sharing the category axis but with the line series
    // on a secondary value axis (right side).
    test('buildComboChartXml renders barChart + lineChart sharing cat axis', () => {
      const xml = __internal.buildComboChartXml({
        title: 'Monthly Trend - Sales / Construction / Cumulative',
        sheetName: 'Dashboard',
        categoriesRange: '$A$39:$A$62',
        barSeries: [
          { name: 'Sales (Cr)', valuesRange: '$B$39:$B$62', colour: '0F7B5A' },
          { name: 'Construction (Cr)', valuesRange: '$C$39:$C$62', colour: 'B23A48' },
        ],
        lineSeries: [
          { name: 'Cumulative Net CF (Cr)', valuesRange: '$E$39:$E$62', colour: 'B5793C' },
        ],
      });

      // Both chart elements present in one plotArea
      expect(xml).toMatch(/<c:barChart>/);
      expect(xml).toMatch(/<c:lineChart>/);

      // Both bar series labels + the line series label
      expect(xml).toMatch(/<c:v>Sales \(Cr\)<\/c:v>/);
      expect(xml).toMatch(/<c:v>Construction \(Cr\)<\/c:v>/);
      expect(xml).toMatch(/<c:v>Cumulative Net CF \(Cr\)<\/c:v>/);

      // Bar palette + line palette
      expect(xml).toMatch(/<a:srgbClr val="0F7B5A"\/>/);
      expect(xml).toMatch(/<a:srgbClr val="B23A48"\/>/);
      expect(xml).toMatch(/<a:srgbClr val="B5793C"\/>/);

      // Three axes (cat + left val + right val with crosses="max")
      const catAxes = (xml.match(/<c:catAx>/g) || []).length;
      const valAxes = (xml.match(/<c:valAx>/g) || []).length;
      expect(catAxes).toBe(1);
      expect(valAxes).toBe(2);
      // Right axis crosses="max" → renders on the right side
      expect(xml).toMatch(/<c:crosses val="max"\/>/);

      // Line series gets markers (circles) for visual continuity
      expect(xml).toMatch(/<c:marker><c:symbol val="circle"\/>/);

      // Legend at bottom (combo always shows legend)
      expect(xml).toMatch(/<c:legend>/);
    });

    // PR-G: tornado chart on the Dashboard. Office pattern: horizontal
    // clustered-bar with overlap=100, so the two series (low-case
    // negative deltas + high-case positive deltas) draw at the same
    // Y position and extend in opposite directions from 0.
    test('buildTornadoChartXml renders horizontal bar with overlap=100 + two oppositely-coloured series', () => {
      const xml = __internal.buildTornadoChartXml({
        title: 'Driver Impact on Margin',
        sheetName: 'Dashboard',
        categoriesRange: '$H$25:$H$26',
        lowValuesRange: '$I$25:$I$26',
        highValuesRange: '$J$25:$J$26',
        lowColour: 'B23A48',
        highColour: '0F7B5A',
      });

      // Horizontal bar (barDir="bar"), not vertical
      expect(xml).toMatch(/<c:barChart>/);
      expect(xml).toMatch(/<c:barDir val="bar"\/>/);

      // Critical: overlap=100 makes the two series share the same Y
      // position, producing the tornado pattern
      expect(xml).toMatch(/<c:overlap val="100"\/>/);

      // Both series labels emitted
      expect(xml).toMatch(/<c:v>Low Case<\/c:v>/);
      expect(xml).toMatch(/<c:v>High Case<\/c:v>/);

      // Both colours emitted (red for downside, green for upside)
      expect(xml).toMatch(/<a:srgbClr val="B23A48"\/>/);
      expect(xml).toMatch(/<a:srgbClr val="0F7B5A"\/>/);

      // Value axis uses signed-format codes so deltas read as +/-
      expect(xml).toMatch(/formatCode="\+0\.0;-0\.0;0"/);

      // Both series reference the same categories range
      const catRefs = (xml.match(/\$H\$25:\$H\$26/g) || []).length;
      expect(catRefs).toBeGreaterThanOrEqual(2);
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

    test('buildSparklineExtXml emits native x14 sparkline groups', () => {
      const xml = __internal.buildSparklineExtXml('Dashboard', [
        { location: 'B9', dataRange: '$B$39:$B$62', colour: '0F7B5A' },
        { location: 'D9', dataRange: '$D$39:$D$62', colour: 'B5793C' },
      ]);
      expect(xml).toMatch(/<x14:sparklineGroups>/);
      expect(xml).toMatch(/<xm:sqref>B9<\/xm:sqref>/);
      expect(xml).toMatch(/<xm:sqref>D9<\/xm:sqref>/);
      expect(xml).toMatch(/'Dashboard'!\$B\$39:\$B\$62/);
      expect(xml).toMatch(/'Dashboard'!\$D\$39:\$D\$62/);
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
          // 'sankey' isn't supported (Office doesn't have a native
          // sankey chart type, and we haven't built a custom one).
          type: 'sankey',
          title: 'X',
          anchor: { fromCol: 0, fromRow: 0, widthCols: 1, heightRows: 1 },
        }],
      })).rejects.toThrow(/unsupported chart type/);
    });

    // ──────────────────────────────────────────────────────────────────
    // PR-NX17 (2026-05-16) ROOT-CAUSE REGRESSION GUARD
    // ──────────────────────────────────────────────────────────────────
    // The Pointec Pens hospitality bug that survived 4 fix attempts:
    // chart injection slammed `<drawing/>` right before `</worksheet>`
    // even when `<legacyDrawing/>` or `<tableParts>` or `<extLst>` were
    // already present. OOXML schema requires `<drawing>` to come BEFORE
    // those elements. Excel rejected the out-of-order XML and auto-
    // repaired the entire Dashboard sheet to `<sheetData/>`.
    test('PR-NX17 REGRESSION: <drawing> is inserted BEFORE <legacyDrawing> per OOXML schema', () => {
      const sheetXml = '<?xml version="1.0"?>'
        + '<worksheet><sheetData/>'
        + '<legacyDrawing r:id="rId99"/>'
        + '</worksheet>';
      const patched = __internal.patchWorksheetXmlForDrawing(sheetXml, 'rId7');
      // The drawing tag MUST appear before legacyDrawing
      const drawingIdx = patched.indexOf('<drawing ');
      const legacyIdx = patched.indexOf('<legacyDrawing ');
      expect(drawingIdx).toBeGreaterThan(0);
      expect(legacyIdx).toBeGreaterThan(0);
      expect(drawingIdx).toBeLessThan(legacyIdx); // critical OOXML ordering
    });

    test('PR-NX17 REGRESSION: <drawing> is inserted BEFORE <tableParts>', () => {
      const sheetXml = '<?xml version="1.0"?>'
        + '<worksheet><sheetData/>'
        + '<tableParts count="1"><tablePart r:id="rId5"/></tableParts>'
        + '</worksheet>';
      const patched = __internal.patchWorksheetXmlForDrawing(sheetXml, 'rId7');
      const drawingIdx = patched.indexOf('<drawing ');
      const tableIdx = patched.indexOf('<tableParts');
      expect(drawingIdx).toBeLessThan(tableIdx);
    });

    test('PR-NX17 REGRESSION: <drawing> is inserted BEFORE <extLst>', () => {
      const sheetXml = '<?xml version="1.0"?>'
        + '<worksheet><sheetData/>'
        + '<extLst><ext uri="x"/></extLst>'
        + '</worksheet>';
      const patched = __internal.patchWorksheetXmlForDrawing(sheetXml, 'rId7');
      const drawingIdx = patched.indexOf('<drawing ');
      const extLstIdx = patched.indexOf('<extLst>');
      expect(drawingIdx).toBeLessThan(extLstIdx);
    });

    test('PR-NX17 REGRESSION: <drawing> position when ALL schema-later elements coexist (worst case)', () => {
      // The Pointec Pens hospitality Dashboard has comments (legacyDrawing
      // from PR-NX11 KPI Benchmark notes) + tableParts (Inputs QA tables
      // shared via sharedStrings) + extLst (sparkline injection). All
      // three present at the worksheet tail. Drawing MUST come before all.
      const sheetXml = '<?xml version="1.0"?>'
        + '<worksheet><sheetData/>'
        + '<legacyDrawing r:id="rId98"/>'
        + '<tableParts count="1"><tablePart r:id="rId97"/></tableParts>'
        + '<extLst><ext uri="x"/></extLst>'
        + '</worksheet>';
      const patched = __internal.patchWorksheetXmlForDrawing(sheetXml, 'rId7');
      const drawingIdx = patched.indexOf('<drawing ');
      const legacyIdx = patched.indexOf('<legacyDrawing ');
      const tableIdx = patched.indexOf('<tableParts');
      const extLstIdx = patched.indexOf('<extLst>');
      expect(drawingIdx).toBeLessThan(legacyIdx);
      expect(drawingIdx).toBeLessThan(tableIdx);
      expect(drawingIdx).toBeLessThan(extLstIdx);
    });

    test('PR-NX17 REGRESSION: fallback to </worksheet>-insertion when no schema-later elements exist', () => {
      const sheetXml = '<?xml version="1.0"?>'
        + '<worksheet><sheetData/></worksheet>';
      const patched = __internal.patchWorksheetXmlForDrawing(sheetXml, 'rId7');
      expect(patched).toContain('<drawing r:id="rId7"/></worksheet>');
    });

    test('PR-NX17 REGRESSION: end-to-end — hospitality-like sheet with comments + tables ships valid order', async () => {
      // Reproduce the production failure mode: ExcelJS-written sheet with
      // legacyDrawing (comments) + tableParts + sparkline-style extLst,
      // then chart injection. Should produce schema-valid XML.
      const wb = new ExcelJS.Workbook();
      wb.addWorksheet('Inputs');
      const dash = wb.addWorksheet('Dashboard');
      dash.getCell('A1').value = 'Use: Land';
      dash.getCell('B1').value = 85;
      // Attach a comment (will cause ExcelJS to emit <legacyDrawing>)
      dash.getCell('B1').note = 'Sample comment';
      const raw = await wb.xlsx.writeBuffer();
      const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);

      const enhanced = await injectChartsIntoXlsx(buffer, {
        targetSheetName: 'Dashboard',
        targetSheetFile: 'sheet2.xml',
        charts: [{
          type: 'doughnut',
          title: 'Test',
          categoriesRange: '$A$1:$A$1',
          valuesRange: '$B$1:$B$1',
          colours: ['0E1B2C'],
          anchor: { fromCol: 4, fromRow: 0, widthCols: 6, heightRows: 12 },
        }],
      });

      const zip = await JSZip.loadAsync(enhanced);
      const xml = await zip.file('xl/worksheets/sheet2.xml').async('string');
      const drawingIdx = xml.indexOf('<drawing ');
      const legacyIdx = xml.indexOf('<legacyDrawing');
      // Both must be present
      expect(drawingIdx).toBeGreaterThan(0);
      if (legacyIdx > 0) {
        // If comments produced legacyDrawing, our patch MUST put drawing first
        expect(drawingIdx).toBeLessThan(legacyIdx);
      }
      // ExcelJS round-trip should accept the patched XML
      const wb2 = new ExcelJS.Workbook();
      await wb2.xlsx.load(enhanced);
      expect(wb2.worksheets.map((w) => w.name)).toContain('Dashboard');
    });
  });

  describe('injectSparklinesIntoXlsx (end-to-end)', () => {
    test('patches the target worksheet with native sparkline XML and roundtrips', async () => {
      const buffer = await makeMinimalWorkbookBuffer();
      const enhanced = await injectSparklinesIntoXlsx(buffer, {
        targetSheetName: 'Dashboard',
        targetSheetFile: 'sheet2.xml',
        sparklines: [
          { location: 'B9', dataRange: '$B$1:$B$3', colour: '0F7B5A' },
          { location: 'D9', dataRange: '$B$1:$B$3', colour: 'B5793C' },
        ],
      });

      const zip = await JSZip.loadAsync(enhanced);
      const sheetXml = await zip.file('xl/worksheets/sheet2.xml').async('string');
      expect(sheetXml).toMatch(/<x14:sparklineGroups>/);
      expect(sheetXml).toMatch(/<xm:sqref>B9<\/xm:sqref>/);
      expect(sheetXml).toMatch(/<xm:sqref>D9<\/xm:sqref>/);

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(enhanced);
      expect(wb.worksheets.map((w) => w.name)).toContain('Dashboard');
    });

    test('returns the input buffer untouched when no sparklines are passed', async () => {
      const buffer = await makeMinimalWorkbookBuffer();
      const result = await injectSparklinesIntoXlsx(buffer, {
        targetSheetName: 'Dashboard',
        targetSheetFile: 'sheet2.xml',
        sparklines: [],
      });
      expect(result).toBe(buffer);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // PR-NX24 (2026-05-16) REGRESSION GUARD: per-chart fault tolerance,
  // extLst ordering, diagnostics opts.
  //
  // The bug class this fixes: charts STILL missing from production files
  // after PR-NX17 (drawing-ordering fix) and PR-NX16 (REDIP_SKIP escape
  // hatches). Two symptoms:
  //   (1) ONE bad chart spec (invalid range, unsupported type, bad escape)
  //       caused the WHOLE chart-injection step to throw; outer catch
  //       swallowed it → zero charts shipped even though 2/3 were valid.
  //   (2) Sparkline injection patched extLst INSIDE an existing extLst
  //       that ExcelJS had placed BEFORE legacyDrawing — schema-invalid,
  //       triggered Excel auto-repair which scrubbed the Dashboard.
  // ──────────────────────────────────────────────────────────────────────
  describe('PR-NX24 — per-chart fault tolerance', () => {
    test('one bad spec does not kill the good ones (partial success)', async () => {
      const buffer = await makeMinimalWorkbookBuffer();
      const diagnostics = {};
      const enhanced = await injectChartsIntoXlsx(buffer, {
        targetSheetName: 'Dashboard',
        targetSheetFile: 'sheet2.xml',
        charts: [
          // GOOD
          {
            type: 'doughnut',
            title: 'Good Doughnut',
            categoriesRange: '$A$1:$A$3',
            valuesRange: '$B$1:$B$3',
            colours: ['0E1B2C', 'B5793C', '0F7B5A'],
            anchor: { fromCol: 4, fromRow: 0, widthCols: 6, heightRows: 12 },
          },
          // BAD: unsupported type — pre-NX24 this killed the whole batch
          {
            type: 'sankey',
            title: 'Bad Sankey',
            anchor: { fromCol: 0, fromRow: 14, widthCols: 6, heightRows: 12 },
          },
          // GOOD
          {
            type: 'bar',
            title: 'Good Bar',
            categoriesRange: '$A$1:$A$3',
            barDir: 'col',
            series: [{ name: 'X', valuesRange: '$B$1:$B$3', colour: '0F7B5A' }],
            anchor: { fromCol: 10, fromRow: 0, widthCols: 6, heightRows: 12 },
          },
        ],
        diagnostics,
      });

      // Buffer is still a valid xlsx
      expect(Buffer.isBuffer(enhanced)).toBe(true);
      const zip = await JSZip.loadAsync(enhanced);
      // 2 charts shipped (indexed sequentially — the bad one is SKIPPED)
      expect(zip.file('xl/charts/chart1.xml')).not.toBeNull();
      expect(zip.file('xl/charts/chart2.xml')).not.toBeNull();
      expect(zip.file('xl/charts/chart3.xml')).toBeNull(); // bad one not written
      // Drawing references 2 charts only
      const drawingXml = await zip.file('xl/drawings/drawing1.xml').async('string');
      const anchors = (drawingXml.match(/<xdr:oneCellAnchor>/g) || []);
      expect(anchors.length).toBe(2);

      // Diagnostics object populated
      expect(diagnostics.requestedCount).toBe(3);
      expect(diagnostics.builtCount).toBe(2);
      expect(diagnostics.failureCount).toBe(1);
      expect(diagnostics.failures).toHaveLength(1);
      expect(diagnostics.failures[0].type).toBe('sankey');
      expect(diagnostics.failures[0].chartIndex).toBe(1);
      expect(diagnostics.failures[0].error).toMatch(/unsupported chart type/);
    });

    test('all-bad batch still throws (caller fallback fires)', async () => {
      const buffer = await makeMinimalWorkbookBuffer();
      const diagnostics = {};
      await expect(injectChartsIntoXlsx(buffer, {
        targetSheetName: 'Dashboard',
        targetSheetFile: 'sheet2.xml',
        charts: [
          { type: 'sankey', title: 'X', anchor: { fromCol: 0, fromRow: 0, widthCols: 1, heightRows: 1 } },
          { type: 'pyramid', title: 'Y', anchor: { fromCol: 0, fromRow: 2, widthCols: 1, heightRows: 1 } },
        ],
        diagnostics,
      })).rejects.toThrow(/all 2 charts failed/);

      // Even on wholesale failure, diagnostics MUST be populated so the
      // caller's catch can still log per-spec attribution.
      expect(diagnostics.requestedCount).toBe(2);
      expect(diagnostics.builtCount).toBe(0);
      expect(diagnostics.failureCount).toBe(2);
      expect(diagnostics.failures.map((f) => f.type)).toEqual(['sankey', 'pyramid']);
    });

    test('all-good batch populates diagnostics with zero failures', async () => {
      const buffer = await makeMinimalWorkbookBuffer();
      const diagnostics = {};
      await injectChartsIntoXlsx(buffer, {
        targetSheetName: 'Dashboard',
        targetSheetFile: 'sheet2.xml',
        charts: [{
          type: 'doughnut',
          title: 'Only',
          categoriesRange: '$A$1:$A$3',
          valuesRange: '$B$1:$B$3',
          colours: ['0E1B2C', 'B5793C', '0F7B5A'],
          anchor: { fromCol: 4, fromRow: 0, widthCols: 6, heightRows: 12 },
        }],
        diagnostics,
      });
      expect(diagnostics.requestedCount).toBe(1);
      expect(diagnostics.builtCount).toBe(1);
      expect(diagnostics.failureCount).toBe(0);
      expect(diagnostics.failures).toEqual([]);
    });

    test('omitting diagnostics opt still works (backward compat)', async () => {
      const buffer = await makeMinimalWorkbookBuffer();
      // No diagnostics key in opts — should not throw / should still produce buffer
      const enhanced = await injectChartsIntoXlsx(buffer, {
        targetSheetName: 'Dashboard',
        targetSheetFile: 'sheet2.xml',
        charts: [{
          type: 'doughnut',
          title: 'NoDiag',
          categoriesRange: '$A$1:$A$3',
          valuesRange: '$B$1:$B$3',
          colours: ['0E1B2C', 'B5793C', '0F7B5A'],
          anchor: { fromCol: 4, fromRow: 0, widthCols: 6, heightRows: 12 },
        }],
      });
      expect(Buffer.isBuffer(enhanced)).toBe(true);
    });
  });

  describe('PR-NX24 — patchWorksheetXmlForSparklines extLst ordering', () => {
    // The bug: when ExcelJS had ALREADY emitted an <extLst> (for iconSet
    // conditional formatting), our pre-NX24 patch did .replace(/<\/extLst>\s*/)
    // which spliced sparkline content INSIDE that existing extLst. The
    // merged extLst landed at the original (early) position, BEFORE
    // legacyDrawing or tableParts — violating CT_Worksheet child-order
    // schema. Excel rejected and auto-repaired, scrubbing the Dashboard.
    test('lifts existing extLst out when it sits BEFORE legacyDrawing', () => {
      const sheetXml = '<?xml version="1.0"?>'
        + '<worksheet>'
        + '<sheetData/>'
        + '<extLst><ext uri="iconSet">iconStuff</ext></extLst>'   // <- ExcelJS-placed
        + '<legacyDrawing r:id="rId99"/>'                          // <- after extLst (wrong)
        + '</worksheet>';
      const patched = __internal.patchWorksheetXmlForSparklines(
        sheetXml,
        'Dashboard',
        [{ location: 'B9', dataRange: '$B$1:$B$3', colour: '0F7B5A' }],
      );

      const extLstIdx = patched.indexOf('<extLst>');
      const legacyIdx = patched.indexOf('<legacyDrawing');
      const sparkIdx = patched.indexOf('<x14:sparklineGroups>');
      // extLst MUST be after legacyDrawing now (schema-valid)
      expect(legacyIdx).toBeGreaterThan(0);
      expect(extLstIdx).toBeGreaterThan(legacyIdx);
      // Sparkline content lives INSIDE the lifted extLst
      expect(sparkIdx).toBeGreaterThan(extLstIdx);
      // Original iconSet content is preserved (lift, don't drop)
      expect(patched).toContain('iconStuff');
      // Exactly ONE extLst remains (we lifted, didn't append a second one)
      const extCount = (patched.match(/<extLst>/g) || []).length;
      expect(extCount).toBe(1);
    });

    test('existing extLst at end (after legacyDrawing) — sparkline appended in place', () => {
      const sheetXml = '<?xml version="1.0"?>'
        + '<worksheet>'
        + '<sheetData/>'
        + '<legacyDrawing r:id="rId99"/>'
        + '<extLst><ext uri="iconSet">iconStuff</ext></extLst>'
        + '</worksheet>';
      const patched = __internal.patchWorksheetXmlForSparklines(
        sheetXml,
        'Dashboard',
        [{ location: 'B9', dataRange: '$B$1:$B$3', colour: '0F7B5A' }],
      );
      const extCount = (patched.match(/<extLst>/g) || []).length;
      expect(extCount).toBe(1);
      // legacyDrawing still before extLst
      expect(patched.indexOf('<legacyDrawing')).toBeLessThan(patched.indexOf('<extLst>'));
      // Both the original iconSet ext + the new sparkline ext live inside
      expect(patched).toContain('iconStuff');
      expect(patched).toMatch(/<x14:sparklineGroups>/);
    });

    test('no existing extLst — sparkline ext inserted right before </worksheet>', () => {
      const sheetXml = '<?xml version="1.0"?>'
        + '<worksheet><sheetData/><legacyDrawing r:id="rId1"/></worksheet>';
      const patched = __internal.patchWorksheetXmlForSparklines(
        sheetXml,
        'Dashboard',
        [{ location: 'B9', dataRange: '$B$1:$B$3', colour: '0F7B5A' }],
      );
      // extLst MUST come after legacyDrawing
      expect(patched.indexOf('<legacyDrawing')).toBeLessThan(patched.indexOf('<extLst>'));
      expect(patched).toMatch(/<x14:sparklineGroups>/);
    });

    test('idempotent — second call is a no-op when sparklines already present', () => {
      const sheetXml = '<?xml version="1.0"?>'
        + '<worksheet><sheetData/></worksheet>';
      const once = __internal.patchWorksheetXmlForSparklines(
        sheetXml,
        'Dashboard',
        [{ location: 'B9', dataRange: '$B$1:$B$3', colour: '0F7B5A' }],
      );
      const twice = __internal.patchWorksheetXmlForSparklines(
        once,
        'Dashboard',
        [{ location: 'B9', dataRange: '$B$1:$B$3', colour: '0F7B5A' }],
      );
      // Second call returns the same string — no duplicate sparkline blocks
      expect(twice).toBe(once);
    });

    test('end-to-end — sheet with comments (legacyDrawing) + pre-existing extLst + sparklines all coexist', async () => {
      // Worst-case real-world combo: PR-NX11 KPI Benchmark notes
      // (legacyDrawing) + a pre-existing extLst (placed BEFORE legacyDrawing
      // — the schema-invalid position ExcelJS sometimes emits) + sparkline
      // injection. Pre-NX24 this was the Pointec Pens Dashboard regression
      // class — extLst stayed in the wrong position after sparkline patch,
      // Excel auto-repaired and scrubbed the Dashboard.
      //
      // Rather than fight ExcelJS's iconSet API quirks to produce the
      // pre-existing extLst, we patch the worksheet XML directly via
      // JSZip — this gives us deterministic control over the exact XML
      // structure that triggers the bug.
      const wb = new ExcelJS.Workbook();
      wb.addWorksheet('Inputs');
      const dash = wb.addWorksheet('Dashboard');
      dash.getCell('A1').value = 'KPI';
      dash.getCell('B1').value = 100;
      dash.getCell('A2').value = 'KPI2';
      dash.getCell('B2').value = 50;
      dash.getCell('A3').value = 'KPI3';
      dash.getCell('B3').value = 75;
      // Force a legacyDrawing via a cell comment (PR-NX11 pattern)
      dash.getCell('B1').note = 'Benchmark median: 75';
      const raw = await wb.xlsx.writeBuffer();
      const baseBuffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);

      // Manually inject a pre-existing extLst BEFORE legacyDrawing — this
      // is the malformed pattern we need to ensure our sparkline patch
      // corrects. Real-world this comes from ExcelJS emitting iconSet CF
      // before legacyDrawing in some workbook configurations.
      const baseZip = await JSZip.loadAsync(baseBuffer);
      const sheet2Path = 'xl/worksheets/sheet2.xml';
      let sheet2Xml = await baseZip.file(sheet2Path).async('string');
      // Insert <extLst> right before </worksheet> — but BEFORE the existing
      // legacyDrawing. We do this by finding </worksheet> and prepending an
      // extLst right before it, but FIRST we move legacyDrawing to come
      // AFTER (simulating the wrong-order case).
      // Simpler: just put an extLst INSIDE the sheet at a wrong position
      // by inserting it right after </sheetData>.
      sheet2Xml = sheet2Xml.replace(
        /<\/sheetData>/,
        '</sheetData><extLst><ext uri="iconSetTest" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main">iconStuff</ext></extLst>',
      );
      baseZip.file(sheet2Path, sheet2Xml);
      const buffer = await baseZip.generateAsync({ type: 'nodebuffer' });

      // Sanity check: the bad pattern is set up — extLst lives before legacyDrawing
      const preZip = await JSZip.loadAsync(buffer);
      const preXml = await preZip.file(sheet2Path).async('string');
      const preLegacyIdx = preXml.indexOf('<legacyDrawing');
      const preExtLstIdx = preXml.indexOf('<extLst>');
      // Confirm test setup is producing the bad pattern we want to fix
      if (preLegacyIdx > 0 && preExtLstIdx > 0) {
        expect(preExtLstIdx).toBeLessThan(preLegacyIdx); // bad: extLst before legacyDrawing
      }

      // Now run the sparkline injector — it should LIFT the existing extLst
      // and place it after all schema-later elements.
      const enhanced = await injectSparklinesIntoXlsx(buffer, {
        targetSheetName: 'Dashboard',
        targetSheetFile: 'sheet2.xml',
        sparklines: [{ location: 'C1', dataRange: '$B$1:$B$3', colour: '0F7B5A' }],
      });

      // ExcelJS round-trip must succeed (no schema-invalid XML)
      const wb2 = new ExcelJS.Workbook();
      await wb2.xlsx.load(enhanced);
      expect(wb2.worksheets.map((w) => w.name)).toContain('Dashboard');

      const zip = await JSZip.loadAsync(enhanced);
      const xml = await zip.file(sheet2Path).async('string');
      // Sparkline group lives in xml
      expect(xml).toMatch(/<x14:sparklineGroups>/);
      // Original iconSet content preserved (lift, don't drop)
      expect(xml).toContain('iconStuff');
      // CRITICAL: exactly ONE extLst, and it must be AFTER legacyDrawing
      const extCount = (xml.match(/<extLst>/g) || []).length;
      expect(extCount).toBe(1);
      const legacyIdx = xml.indexOf('<legacyDrawing');
      const extLstIdx = xml.indexOf('<extLst>');
      expect(legacyIdx).toBeGreaterThan(0);
      expect(extLstIdx).toBeGreaterThan(legacyIdx); // fixed order
    });
  });
});
