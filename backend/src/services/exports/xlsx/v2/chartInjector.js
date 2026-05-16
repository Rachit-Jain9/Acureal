'use strict';

/**
 * Native chart XML injector for ExcelJS-produced .xlsx buffers.
 *
 * Why: ExcelJS 4.4.0 has no `addChart` API (verified empirically — `addChart`
 * is undefined on worksheet instances; no chart-xform module exists in the
 * library's source). The workbook our generator writes therefore has zero
 * native chart objects, even though the Dashboard layout is clearly chart-
 * shaped. The operator's brutal-roast called this out specifically.
 *
 * This injector takes the buffer ExcelJS just wrote, unzips it via JSZip,
 * splices in:
 *   - one xl/charts/chartN.xml per chart spec (the chart definition)
 *   - one xl/drawings/drawing1.xml anchoring every chart on the target sheet
 *   - the drawing → chart relationships (xl/drawings/_rels/drawing1.xml.rels)
 *   - the worksheet → drawing relationship (xl/worksheets/_rels/sheetN.xml.rels)
 *   - chart + drawing content-type entries in [Content_Types].xml
 *
 * It produces a new buffer that Excel + LibreOffice + Google Sheets parse
 * as having real native chart objects bound to live cell ranges — change
 * an input on the Inputs sheet, every chart recalculates.
 *
 * Conservative scope for v1: doughnut, clustered-column bar, and clustered-
 * horizontal-bar. Combo (column + line) is rendered as two separate charts
 * stacked. Scatter / radar / area can be added later if needed.
 *
 * The chart XML mirrors the structure of the operator's reference template
 * pack (`REDIP_India_Template_*.xlsx`, openpyxl-generated) — same element
 * order, same minimal namespace declarations — so files open without the
 * "Excel found a problem with formulas in this workbook" repair dialog.
 */

const JSZip = require('jszip');

const escapeXml = (s) => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

// Cell-range references inside chart XML need the sheet-name wrapped in
// single quotes when the name contains spaces or special characters. The
// operator's sheet names ("Inputs & Assumptions", "Phasing & Sales Collection",
// "Quarterly Cash Flow & Debt", "Dashboard") all contain spaces and the `&`
// character so we always quote, always XML-escape.
const sheetRefForChart = (sheetName, range) => `'${escapeXml(sheetName)}'!${range}`;

const sheetRefForSparkline = (sheetName, range) => `'${escapeXml(String(sheetName).replace(/'/g, "''"))}'!${range}`;

const buildSparklineExtXml = (targetSheetName, sparklines) => {
  const groups = (sparklines || []).map((sparkline, idx) => {
    const colour = sparkline.colour || 'B5793C';
    return [
      `<x14:sparklineGroup type="line" displayEmptyCellsAs="gap" xr:uid="{00000000-0000-0000-0000-${String(idx + 1).padStart(12, '0')}}">`,
      `<x14:colorSeries rgb="FF${colour}"/>`,
      '<x14:colorNegative rgb="FFB23A48"/>',
      '<x14:colorAxis rgb="FF6B7280"/>',
      `<x14:colorMarkers rgb="FF${colour}"/>`,
      '<x14:colorFirst rgb="FF0E1B2C"/>',
      '<x14:colorLast rgb="FF0F7B5A"/>',
      '<x14:sparklines><x14:sparkline>',
      `<xm:f>${sheetRefForSparkline(sparkline.sheetName || targetSheetName, sparkline.dataRange)}</xm:f>`,
      `<xm:sqref>${escapeXml(sparkline.location)}</xm:sqref>`,
      '</x14:sparkline></x14:sparklines>',
      '</x14:sparklineGroup>',
    ].join('');
  }).join('');
  return [
    '<ext uri="{05C60535-1F16-4fd2-B633-F4F36F0B64E0}"',
    ' xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"',
    ' xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main"',
    ' xmlns:xr="http://schemas.microsoft.com/office/spreadsheetml/2014/revision">',
    `<x14:sparklineGroups>${groups}</x14:sparklineGroups>`,
    '</ext>',
  ].join('');
};

// PR-NX24 (2026-05-16) — OOXML schema fix for extLst ordering.
//
// Per CT_Worksheet child-element schema order, the tail elements MUST appear
// in this sequence:
//   ... → drawing → legacyDrawing → legacyDrawingHF → picture → oleObjects
//       → controls → webPublishItems → tableParts → extLst (LAST)
//
// Pre-NX24 the sparkline patch inserted extLst right before </worksheet>.
// When a sheet already had a legacyDrawing (from cell comments — e.g., the
// PR-NX11 KPI Benchmark notes), the resulting order was:
//   <legacyDrawing/><extLst>...</extLst></worksheet>  ✓ CORRECT
// BUT if ExcelJS had already inserted an extLst itself (for conditional-
// formatting iconSet rules), our patch would do .replace(/<\/extLst>\s*/,
// ...) which inserts INSIDE the existing extLst. The merged extLst then
// landed at the OLD extLst's position — typically BEFORE legacyDrawing,
// producing:
//   <extLst>...new sparklineGroups...</extLst><legacyDrawing/></worksheet>
// which violates the schema and triggers Excel auto-repair on open.
//
// Fix: ALWAYS ensure the final extLst lands AFTER legacyDrawing (and after
// tableParts, picture, controls, etc.). If an existing extLst is found in
// the wrong position, lift it out and re-insert at the correct place
// right before </worksheet>.
const patchWorksheetXmlForSparklines = (sheetXml, targetSheetName, sparklines) => {
  if (!Array.isArray(sparklines) || sparklines.length === 0) return sheetXml;
  if (sheetXml.includes('<x14:sparklineGroups')) return sheetXml;

  const sparklineExt = buildSparklineExtXml(targetSheetName, sparklines);

  // Case 1: existing <extLst>...</extLst> block.
  // Two sub-cases:
  //   (a) extLst is already at the END (right before </worksheet>) — just
  //       insert the sparkline <ext> inside it. Order stays valid.
  //   (b) extLst is somewhere in the middle (e.g., between mergeCells and
  //       conditionalFormatting) — that's invalid OOXML. Lift it out and
  //       re-insert at the end with the sparkline content appended.
  const existingExtLstMatch = sheetXml.match(/<extLst>([\s\S]*?)<\/extLst>/);
  if (existingExtLstMatch) {
    const tailWithoutExtLst = sheetXml.slice(existingExtLstMatch.index + existingExtLstMatch[0].length);
    // Heuristic: if anything after the existing extLst (before </worksheet>)
    // looks like another schema-later element, the extLst is in the wrong
    // position and needs to be lifted.
    const tailHasLaterElements = /<(legacyDrawing|tableParts|picture|oleObjects|controls|drawing\s)/.test(tailWithoutExtLst);
    if (tailHasLaterElements) {
      // LIFT: remove the existing extLst, re-insert with sparkline content at end
      const innerContent = existingExtLstMatch[1];
      const without = sheetXml.replace(existingExtLstMatch[0], '');
      return without.replace(
        /<\/worksheet>\s*$/,
        `<extLst>${innerContent}${sparklineExt}</extLst></worksheet>`,
      );
    }
    // extLst is already at the end — just inject sparkline content into it
    return sheetXml.replace(/<\/extLst>\s*/, `${sparklineExt}</extLst>`);
  }

  // Case 2: no existing extLst — insert at very end (after all other schema
  // elements like legacyDrawing, tableParts).
  return sheetXml.replace(/<\/worksheet>\s*$/, `<extLst>${sparklineExt}</extLst></worksheet>`);
};

// ────────────────────────────────────────────────────────────────────────
// Chart XML builders — one function per chart type. Each returns a string
// that goes into xl/charts/chartN.xml.
// ────────────────────────────────────────────────────────────────────────

const chartXmlHeader =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"'
  + ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
  + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';

const chartXmlFooter = '</c:chartSpace>';

const titleBlock = (titleText) => titleText
  ? `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1100" b="1"/></a:pPr><a:r><a:rPr lang="en-IN" sz="1100" b="1"/><a:t>${escapeXml(titleText)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>`
  : '<c:autoTitleDeleted val="1"/>';

const seriesColours = (colours) => (colours || []).map((c, idx) =>
  `<c:dPt><c:idx val="${idx}"/><c:bubble3D val="0"/><c:spPr><a:solidFill><a:srgbClr val="${c}"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:dPt>`
).join('');

/**
 * Doughnut chart — single series, one slice per category. Used for Sources &
 * Uses on the Dashboard.
 *
 * @param {Object} spec
 * @param {string} spec.title
 * @param {string} spec.sheetName
 * @param {string} spec.categoriesRange  e.g. "$A$12:$A$16" (relative to sheetName)
 * @param {string} spec.valuesRange      e.g. "$B$12:$B$16"
 * @param {string[]} spec.colours        ARGB hex strings, one per slice
 * @returns {string} the chart XML
 */
const buildDoughnutChartXml = (spec) => {
  const catRef = sheetRefForChart(spec.sheetName, spec.categoriesRange);
  const valRef = sheetRefForChart(spec.sheetName, spec.valuesRange);
  return [
    chartXmlHeader,
    '<c:chart>',
    titleBlock(spec.title),
    '<c:plotArea>',
    '<c:layout/>',
    '<c:doughnutChart>',
    '<c:varyColors val="1"/>',
    '<c:ser>',
    '<c:idx val="0"/>',
    '<c:order val="0"/>',
    seriesColours(spec.colours),
    `<c:cat><c:strRef><c:f>${catRef}</c:f></c:strRef></c:cat>`,
    `<c:val><c:numRef><c:f>${valRef}</c:f></c:numRef></c:val>`,
    '</c:ser>',
    '<c:firstSliceAng val="0"/>',
    '<c:holeSize val="55"/>',
    '</c:doughnutChart>',
    '</c:plotArea>',
    '<c:legend><c:legendPos val="r"/><c:overlay val="0"/></c:legend>',
    '<c:plotVisOnly val="1"/>',
    '<c:dispBlanksAs val="gap"/>',
    '</c:chart>',
    chartXmlFooter,
  ].join('');
};

/**
 * Clustered-column or clustered-bar chart. One or more numeric series sharing
 * the same category axis. Used for Monthly Trend on the Dashboard.
 *
 * @param {Object} spec
 * @param {string} spec.title
 * @param {string} spec.sheetName
 * @param {string} spec.categoriesRange  e.g. "$A$38:$A$53"
 * @param {Array<{name: string, valuesRange: string, colour: string}>} spec.series
 * @param {('col'|'bar')} spec.barDir  default 'col'
 * @returns {string}
 */
const buildBarChartXml = (spec) => {
  const catRef = sheetRefForChart(spec.sheetName, spec.categoriesRange);
  const barDir = spec.barDir === 'bar' ? 'bar' : 'col';
  const series = (spec.series || []).map((s, idx) => [
    '<c:ser>',
    `<c:idx val="${idx}"/>`,
    `<c:order val="${idx}"/>`,
    `<c:tx><c:v>${escapeXml(s.name || `Series ${idx + 1}`)}</c:v></c:tx>`,
    s.colour ? `<c:spPr><a:solidFill><a:srgbClr val="${s.colour}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr>` : '',
    `<c:cat><c:strRef><c:f>${catRef}</c:f></c:strRef></c:cat>`,
    `<c:val><c:numRef><c:f>${sheetRefForChart(spec.sheetName, s.valuesRange)}</c:f></c:numRef></c:val>`,
    '</c:ser>',
  ].join('')).join('');

  return [
    chartXmlHeader,
    '<c:chart>',
    titleBlock(spec.title),
    '<c:plotArea>',
    '<c:layout/>',
    '<c:barChart>',
    `<c:barDir val="${barDir}"/>`,
    '<c:grouping val="clustered"/>',
    '<c:varyColors val="0"/>',
    series,
    '<c:gapWidth val="80"/>',
    '<c:axId val="111"/>',
    '<c:axId val="222"/>',
    '</c:barChart>',
    '<c:catAx>',
    '<c:axId val="111"/>',
    '<c:scaling><c:orientation val="minMax"/></c:scaling>',
    '<c:delete val="0"/>',
    `<c:axPos val="${barDir === 'col' ? 'b' : 'l'}"/>`,
    '<c:crossAx val="222"/>',
    '</c:catAx>',
    '<c:valAx>',
    '<c:axId val="222"/>',
    '<c:scaling><c:orientation val="minMax"/></c:scaling>',
    '<c:delete val="0"/>',
    `<c:axPos val="${barDir === 'col' ? 'l' : 'b'}"/>`,
    '<c:numFmt formatCode="#,##0" sourceLinked="0"/>',
    '<c:crossAx val="111"/>',
    '</c:valAx>',
    '</c:plotArea>',
    spec.series && spec.series.length > 1
      ? '<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>'
      : '',
    '<c:plotVisOnly val="1"/>',
    '<c:dispBlanksAs val="gap"/>',
    '</c:chart>',
    chartXmlFooter,
  ].join('');
};

/**
 * Tornado chart — horizontal-bar chart with two overlapping series
 * (low-case deltas as negative values, high-case deltas as positive
 * values, both drawn at the same Y position via `<c:overlap val="100"/>`).
 *
 * Each category is one sensitivity driver; the two series represent the
 * downside (red, negative delta) and upside (green, positive delta)
 * from the base case. Result: each driver row is one horizontal bar
 * extending left from 0 (low) and right from 0 (high).
 *
 * The caller passes pre-computed delta values (low usually negative,
 * high usually positive). The chart's value axis renders 0 at the
 * centre, which is the base case the bars deviate from. To make this
 * read clearly the caller should also include a labelled cell elsewhere
 * on the sheet showing the base IRR / margin so the reader knows the
 * 0-axis represents.
 *
 * @param {Object} spec
 * @param {string} spec.title
 * @param {string} spec.sheetName
 * @param {string} spec.categoriesRange  driver labels
 * @param {string} spec.lowValuesRange   negative delta values (low-case)
 * @param {string} spec.highValuesRange  positive delta values (high-case)
 * @param {string} spec.lowColour        ARGB hex for the downside bar
 * @param {string} spec.highColour       ARGB hex for the upside bar
 * @returns {string}
 */
const buildTornadoChartXml = (spec) => {
  const catRef = sheetRefForChart(spec.sheetName, spec.categoriesRange);
  const lowRef = sheetRefForChart(spec.sheetName, spec.lowValuesRange);
  const highRef = sheetRefForChart(spec.sheetName, spec.highValuesRange);
  const lowColour = spec.lowColour || 'B23A48';   // dataNegative
  const highColour = spec.highColour || '0F7B5A'; // dataPositive

  return [
    chartXmlHeader,
    '<c:chart>',
    titleBlock(spec.title),
    '<c:plotArea>',
    '<c:layout/>',
    '<c:barChart>',
    '<c:barDir val="bar"/>',
    '<c:grouping val="clustered"/>',
    '<c:varyColors val="0"/>',
    // Low-case series — negative deltas extend left from 0
    '<c:ser>',
    '<c:idx val="0"/>',
    '<c:order val="0"/>',
    '<c:tx><c:v>Low Case</c:v></c:tx>',
    `<c:spPr><a:solidFill><a:srgbClr val="${lowColour}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr>`,
    `<c:cat><c:strRef><c:f>${catRef}</c:f></c:strRef></c:cat>`,
    `<c:val><c:numRef><c:f>${lowRef}</c:f></c:numRef></c:val>`,
    '</c:ser>',
    // High-case series — positive deltas extend right from 0
    '<c:ser>',
    '<c:idx val="1"/>',
    '<c:order val="1"/>',
    '<c:tx><c:v>High Case</c:v></c:tx>',
    `<c:spPr><a:solidFill><a:srgbClr val="${highColour}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr>`,
    `<c:cat><c:strRef><c:f>${catRef}</c:f></c:strRef></c:cat>`,
    `<c:val><c:numRef><c:f>${highRef}</c:f></c:numRef></c:val>`,
    '</c:ser>',
    // overlap=100 → both series drawn at the same Y position. Since one
    // is positive and the other negative they extend in opposite
    // directions, visually producing the tornado.
    '<c:overlap val="100"/>',
    '<c:gapWidth val="40"/>',
    '<c:axId val="111"/>',
    '<c:axId val="222"/>',
    '</c:barChart>',
    // Category axis (vertical, drivers listed top-to-bottom)
    '<c:catAx>',
    '<c:axId val="111"/>',
    '<c:scaling><c:orientation val="minMax"/></c:scaling>',
    '<c:delete val="0"/>',
    '<c:axPos val="l"/>',
    '<c:crossAx val="222"/>',
    '</c:catAx>',
    // Value axis (horizontal, signed deltas)
    '<c:valAx>',
    '<c:axId val="222"/>',
    '<c:scaling><c:orientation val="minMax"/></c:scaling>',
    '<c:delete val="0"/>',
    '<c:axPos val="b"/>',
    '<c:numFmt formatCode="+0.0;-0.0;0" sourceLinked="0"/>',
    '<c:crossAx val="111"/>',
    '</c:valAx>',
    '</c:plotArea>',
    '<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>',
    '<c:plotVisOnly val="1"/>',
    '<c:dispBlanksAs val="gap"/>',
    '</c:chart>',
    chartXmlFooter,
  ].join('');
};

/**
 * Combo chart — clustered-column + line in one plot area, sharing the
 * category axis but with the line series on a secondary value axis on
 * the right side. The canonical analyst read for a Monthly Trend
 * showing period contribution (column) + cumulative trajectory (line)
 * where the cumulative crossover point is the "deal turns positive"
 * moment.
 *
 * Office's combo chart pattern: barChart element shares axId 111 (cat)
 * and 222 (left val), lineChart shares axId 111 (cat) and 333 (right
 * val with crosses="max" so it renders on the right side).
 *
 * @param {Object} spec
 * @param {string} spec.title
 * @param {string} spec.sheetName
 * @param {string} spec.categoriesRange
 * @param {Array<{name: string, valuesRange: string, colour: string}>} spec.barSeries   1+ column series (left axis)
 * @param {Array<{name: string, valuesRange: string, colour: string}>} spec.lineSeries  1+ line series (right axis)
 * @returns {string}
 */
const buildComboChartXml = (spec) => {
  const catRef = sheetRefForChart(spec.sheetName, spec.categoriesRange);
  const barSeries = (spec.barSeries || []).map((s, idx) => [
    '<c:ser>',
    `<c:idx val="${idx}"/>`,
    `<c:order val="${idx}"/>`,
    `<c:tx><c:v>${escapeXml(s.name || `Bar ${idx + 1}`)}</c:v></c:tx>`,
    s.colour ? `<c:spPr><a:solidFill><a:srgbClr val="${s.colour}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr>` : '',
    `<c:cat><c:strRef><c:f>${catRef}</c:f></c:strRef></c:cat>`,
    `<c:val><c:numRef><c:f>${sheetRefForChart(spec.sheetName, s.valuesRange)}</c:f></c:numRef></c:val>`,
    '</c:ser>',
  ].join('')).join('');

  const barCount = (spec.barSeries || []).length;
  const lineSeries = (spec.lineSeries || []).map((s, idx) => [
    '<c:ser>',
    `<c:idx val="${barCount + idx}"/>`,
    `<c:order val="${barCount + idx}"/>`,
    `<c:tx><c:v>${escapeXml(s.name || `Line ${idx + 1}`)}</c:v></c:tx>`,
    s.colour
      ? `<c:spPr><a:ln w="22225"><a:solidFill><a:srgbClr val="${s.colour}"/></a:solidFill></a:ln></c:spPr>`
      : '',
    // Smooth line for visual continuity; markers at each data point
    `<c:marker><c:symbol val="circle"/><c:size val="6"/>${s.colour ? `<c:spPr><a:solidFill><a:srgbClr val="${s.colour}"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr>` : ''}</c:marker>`,
    `<c:cat><c:strRef><c:f>${catRef}</c:f></c:strRef></c:cat>`,
    `<c:val><c:numRef><c:f>${sheetRefForChart(spec.sheetName, s.valuesRange)}</c:f></c:numRef></c:val>`,
    '<c:smooth val="0"/>',
    '</c:ser>',
  ].join('')).join('');

  return [
    chartXmlHeader,
    '<c:chart>',
    titleBlock(spec.title),
    '<c:plotArea>',
    '<c:layout/>',
    // ── Bar (column) chart — left value axis (222) ──
    '<c:barChart>',
    '<c:barDir val="col"/>',
    '<c:grouping val="clustered"/>',
    '<c:varyColors val="0"/>',
    barSeries,
    '<c:gapWidth val="80"/>',
    '<c:axId val="111"/>',
    '<c:axId val="222"/>',
    '</c:barChart>',
    // ── Line chart — right secondary value axis (333) ──
    '<c:lineChart>',
    '<c:grouping val="standard"/>',
    '<c:varyColors val="0"/>',
    lineSeries,
    '<c:marker val="1"/>',
    '<c:axId val="111"/>',
    '<c:axId val="333"/>',
    '</c:lineChart>',
    // ── Category axis (shared) ──
    '<c:catAx>',
    '<c:axId val="111"/>',
    '<c:scaling><c:orientation val="minMax"/></c:scaling>',
    '<c:delete val="0"/>',
    '<c:axPos val="b"/>',
    '<c:crossAx val="222"/>',
    '</c:catAx>',
    // ── Left value axis (bars) ──
    '<c:valAx>',
    '<c:axId val="222"/>',
    '<c:scaling><c:orientation val="minMax"/></c:scaling>',
    '<c:delete val="0"/>',
    '<c:axPos val="l"/>',
    '<c:numFmt formatCode="#,##0" sourceLinked="0"/>',
    '<c:crossAx val="111"/>',
    '</c:valAx>',
    // ── Right value axis (cumulative line) ──
    '<c:valAx>',
    '<c:axId val="333"/>',
    '<c:scaling><c:orientation val="minMax"/></c:scaling>',
    '<c:delete val="0"/>',
    '<c:axPos val="r"/>',
    '<c:numFmt formatCode="#,##0" sourceLinked="0"/>',
    '<c:crossAx val="111"/>',
    '<c:crosses val="max"/>',
    '</c:valAx>',
    '</c:plotArea>',
    '<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>',
    '<c:plotVisOnly val="1"/>',
    '<c:dispBlanksAs val="gap"/>',
    '</c:chart>',
    chartXmlFooter,
  ].join('');
};

// ────────────────────────────────────────────────────────────────────────
// Drawing XML — anchors all charts on a single sheet. Excel allows multiple
// charts in one drawing; we emit one <xdr:oneCellAnchor> per chart pointing
// at a (column, row) origin with a fixed pixel extent.
// ────────────────────────────────────────────────────────────────────────

const EMU_PER_COLUMN = 760000;   // approximate width of one default-width column in EMUs
const EMU_PER_ROW = 190000;      // approximate height of one default row

const buildDrawingXml = (chartAnchors) => {
  const anchors = chartAnchors.map((a, idx) => [
    '<xdr:oneCellAnchor>',
    '<xdr:from>',
    `<xdr:col>${a.fromCol}</xdr:col><xdr:colOff>0</xdr:colOff>`,
    `<xdr:row>${a.fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff>`,
    '</xdr:from>',
    `<xdr:ext cx="${a.widthCols * EMU_PER_COLUMN}" cy="${a.heightRows * EMU_PER_ROW}"/>`,
    '<xdr:graphicFrame macro="">',
    '<xdr:nvGraphicFramePr>',
    `<xdr:cNvPr id="${idx + 2}" name="Chart ${idx + 1}"/>`,
    '<xdr:cNvGraphicFramePr/>',
    '</xdr:nvGraphicFramePr>',
    '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>',
    '<a:graphic>',
    '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">',
    `<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId${idx + 1}"/>`,
    '</a:graphicData>',
    '</a:graphic>',
    '</xdr:graphicFrame>',
    '<xdr:clientData/>',
    '</xdr:oneCellAnchor>',
  ].join('')).join('');

  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" '
    + 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
    + anchors
    + '</xdr:wsDr>';
};

const buildDrawingRels = (chartCount) => {
  const rels = [];
  for (let i = 0; i < chartCount; i += 1) {
    rels.push(`<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${i + 1}.xml"/>`);
  }
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + rels.join('')
    + '</Relationships>';
};

// ────────────────────────────────────────────────────────────────────────
// Worksheet patch — inject the <drawing r:id="..."/> reference into the
// target sheet's XML and add a relationship to drawing1.xml in its rels.
// ExcelJS doesn't write a <drawing> element when no images/charts are
// present, so we insert it before the closing </worksheet> tag.
// ────────────────────────────────────────────────────────────────────────

// PR-NX17 (2026-05-16) — ROOT CAUSE of the hospitality Dashboard bug
// that survived PRs #327, #329, #332, #333.
//
// OOXML schema strictly orders worksheet child elements at the end of
// `<worksheet>`. The relevant tail-element ordering (from the official
// ECMA-376 schema, sheet element):
//
//   sheetData, sheetCalcPr, sheetProtection, protectedRanges, scenarios,
//   autoFilter, sortState, dataConsolidate, customSheetViews,
//   mergeCells, phoneticPr, conditionalFormatting, dataValidations,
//   hyperlinks, printOptions, pageMargins, pageSetup, headerFooter,
//   rowBreaks, colBreaks, customProperties, cellWatches, ignoredErrors,
//   smartTags, **drawing**, legacyDrawing, legacyDrawingHF, picture,
//   oleObjects, controls, webPublishItems, tableParts, **extLst**
//
// Pre-fix `patchWorksheetXmlForDrawing` slammed `<drawing/>` right
// before `</worksheet>`. When the Dashboard already had `<legacyDrawing/>`
// (from PR-NX11's KPI Benchmark cell-comments) or `<tableParts>` or
// `<extLst>` (from later sparkline injection), the resulting order was:
//
//   <legacyDrawing/><drawing/></worksheet>      ← WRONG
//   <tableParts>...</tableParts><drawing/></ws> ← WRONG
//   <extLst>...</extLst><drawing/></worksheet>  ← WRONG
//
// Microsoft Excel parses the worksheet strictly per the schema and
// rejects out-of-order elements. Its auto-repair kicks in and SCRUBS
// the entire `<sheetData>` block (along with everything else) leaving
// only the bare worksheet skeleton with `<sheetData/>`. The hospitality
// deals — which trigger cell-comments more aggressively due to PR-NX11
// + PR-NX15 compat section — were the most exposed to this bug.
//
// FIX: insert `<drawing/>` BEFORE any of the schema-later elements,
// not right before `</worksheet>`.
const SCHEMA_LATER_THAN_DRAWING = /<(legacyDrawing|legacyDrawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)\b/;

const patchWorksheetXmlForDrawing = (sheetXml, drawingRelId) => {
  if (sheetXml.includes('<drawing ')) return sheetXml;  // already has one — leave it alone
  const drawingTag = `<drawing r:id="${drawingRelId}"/>`;
  const match = sheetXml.match(SCHEMA_LATER_THAN_DRAWING);
  if (match) {
    // Insert <drawing/> immediately BEFORE the first schema-later element
    // so the resulting order matches OOXML schema and Excel accepts it.
    const insertAt = match.index;
    return sheetXml.slice(0, insertAt) + drawingTag + sheetXml.slice(insertAt);
  }
  // No schema-later elements present — fall back to inserting before </worksheet>
  return sheetXml.replace(
    /<\/worksheet>\s*$/,
    `${drawingTag}</worksheet>`,
  );
};

const ensureWorksheetRels = (relsXml, drawingRelId) => {
  if (!relsXml) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + `<Relationship Id="${drawingRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>`
      + '</Relationships>';
  }
  if (relsXml.includes('/drawings/drawing1.xml')) return relsXml;
  // Find the highest existing rId in the rels file, increment, append.
  const existingIds = [...relsXml.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1]));
  const nextId = (existingIds.length ? Math.max(...existingIds) : 0) + 1;
  const newRel = `<Relationship Id="rId${nextId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>`;
  return relsXml.replace(/<\/Relationships>\s*$/, `${newRel}</Relationships>`);
};

const ensureContentTypes = (xml, chartCount) => {
  // Drawing override
  let updated = xml;
  if (!updated.includes('/xl/drawings/drawing1.xml')) {
    const drawingOverride = '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>';
    updated = updated.replace(/<\/Types>\s*$/, `${drawingOverride}</Types>`);
  }
  // Chart overrides
  for (let i = 1; i <= chartCount; i += 1) {
    const partName = `/xl/charts/chart${i}.xml`;
    if (updated.includes(partName)) continue;
    const chartOverride = `<Override PartName="${partName}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`;
    updated = updated.replace(/<\/Types>\s*$/, `${chartOverride}</Types>`);
  }
  return updated;
};

// ────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────

/**
 * Inject native chart objects into an ExcelJS-produced .xlsx buffer.
 *
 * @param {Buffer} xlsxBuffer
 * @param {Object} opts
 * @param {string} opts.targetSheetName       Sheet that hosts every chart
 *                                            (Dashboard in our generator)
 * @param {string} opts.targetSheetFile       Internal worksheet file name
 *                                            (e.g. 'sheet4.xml') — ExcelJS
 *                                            assigns these by sheet position,
 *                                            and the caller passes the one
 *                                            matching targetSheetName
 * @param {Array<Object>} opts.charts         Chart specs (one per chart);
 *                                            each must have `type` of
 *                                            'doughnut' | 'bar' and the
 *                                            type-specific fields documented
 *                                            on the builders above. All
 *                                            specs additionally need
 *                                            `anchor: { fromCol, fromRow,
 *                                            widthCols, heightRows }`.
 * @returns {Promise<Buffer>} new xlsx buffer with charts injected
 */
const injectChartsIntoXlsx = async (xlsxBuffer, opts) => {
  const { targetSheetName, targetSheetFile, charts, diagnostics } = opts;
  // PR-NX24: `diagnostics` is an optional mutable object the caller can
  // pass to capture per-run injection state without changing the return
  // shape. After the call returns (or throws), it will contain:
  //   { requestedCount, builtCount, failureCount, failures: [{chartIndex,type,title,error}] }
  // Used by buildWorkbook to emit a [CHARTS-FAILED] tagged log line that
  // operators can grep in Vercel function logs.
  if (!Array.isArray(charts) || charts.length === 0) {
    if (diagnostics) {
      diagnostics.requestedCount = 0;
      diagnostics.builtCount = 0;
      diagnostics.failureCount = 0;
      diagnostics.failures = [];
    }
    return xlsxBuffer;
  }

  const zip = await JSZip.loadAsync(xlsxBuffer);

  // PR-NX24 (2026-05-16) — per-chart fault tolerance.
  // Pre-NX24: if ANY chart spec failed XML build (bad anchor, unsupported
  // type, special-character escape bug), the whole injection threw and the
  // outer catch swallowed it. Result: prod had zero charts even when only
  // one of three was broken.
  // Post-NX24: each chart is built in its own try/catch. Bad specs are
  // skipped with a logged warning; the good ones still ship. The injection
  // only fails wholesale if ZERO charts survive.
  const builtCharts = []; // [{ xml, spec, index }]
  const failures = [];
  for (let i = 0; i < charts.length; i += 1) {
    const spec = { ...charts[i], sheetName: charts[i].sheetName || targetSheetName };
    try {
      let xml;
      if (spec.type === 'doughnut') xml = buildDoughnutChartXml(spec);
      else if (spec.type === 'bar') xml = buildBarChartXml(spec);
      else if (spec.type === 'combo') xml = buildComboChartXml(spec);
      else if (spec.type === 'tornado') xml = buildTornadoChartXml(spec);
      else throw new Error(`unsupported chart type "${spec.type}"`);
      builtCharts.push({ xml, spec, index: builtCharts.length + 1 });
    } catch (err) {
      failures.push({ chartIndex: i, type: spec.type, title: spec.title, error: err.message });
      if (process.env.NODE_ENV !== 'test') {
        // eslint-disable-next-line no-console
        console.warn(`[chartInjector] chart ${i} (${spec.type} "${spec.title}") FAILED: ${err.message}`);
      }
    }
  }

  // PR-NX24: populate diagnostics BEFORE the wholesale-failure check so
  // the caller's diagnostics object reflects state even when we throw.
  if (diagnostics) {
    diagnostics.requestedCount = charts.length;
    diagnostics.builtCount = builtCharts.length;
    diagnostics.failureCount = failures.length;
    diagnostics.failures = failures;
  }

  // If every chart failed, we have nothing to inject. Throw so the caller's
  // catch fires and the workbook ships un-charted (better than an empty zip
  // entry or half-injected state).
  if (builtCharts.length === 0) {
    const reasons = failures.map((f) => `${f.type}:${f.error}`).join('; ');
    throw new Error(`chartInjector: all ${charts.length} charts failed (${reasons})`);
  }

  // 1. Write chart XML files (only the ones that built successfully)
  builtCharts.forEach((c) => {
    zip.file(`xl/charts/chart${c.index}.xml`, c.xml);
  });

  // 2. Drawing XML — one anchor per successfully-built chart
  const drawingXml = buildDrawingXml(builtCharts.map((c) => c.spec.anchor));
  zip.file('xl/drawings/drawing1.xml', drawingXml);

  // 3. Drawing → chart rels (count matches built charts, not original)
  zip.file('xl/drawings/_rels/drawing1.xml.rels', buildDrawingRels(builtCharts.length));

  // 4. Worksheet → drawing rel + worksheet body patch
  const sheetXmlPath = `xl/worksheets/${targetSheetFile}`;
  const sheetRelsPath = `xl/worksheets/_rels/${targetSheetFile}.rels`;
  const sheetXmlFile = zip.file(sheetXmlPath);
  if (!sheetXmlFile) throw new Error(`chartInjector: ${sheetXmlPath} not found in workbook`);
  let sheetXml = await sheetXmlFile.async('string');
  const existingRelsFile = zip.file(sheetRelsPath);
  const existingRelsXml = existingRelsFile ? await existingRelsFile.async('string') : null;

  // Pick the rId we'll use for the drawing
  let drawingRelId = 'rId1';
  if (existingRelsXml) {
    const existingIds = [...existingRelsXml.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1]));
    drawingRelId = `rId${(existingIds.length ? Math.max(...existingIds) : 0) + 1}`;
  }

  sheetXml = patchWorksheetXmlForDrawing(sheetXml, drawingRelId);
  zip.file(sheetXmlPath, sheetXml);

  const updatedRels = ensureWorksheetRels(existingRelsXml, drawingRelId);
  zip.file(sheetRelsPath, updatedRels);

  // 5. Content_Types.xml — register only the chart parts we actually wrote
  const ctXml = await zip.file('[Content_Types].xml').async('string');
  zip.file('[Content_Types].xml', ensureContentTypes(ctXml, builtCharts.length));

  return zip.generateAsync({ type: 'nodebuffer' });
};

const injectSparklinesIntoXlsx = async (xlsxBuffer, opts) => {
  const { targetSheetName, targetSheetFile, sparklines } = opts;
  if (!Array.isArray(sparklines) || sparklines.length === 0) return xlsxBuffer;

  const zip = await JSZip.loadAsync(xlsxBuffer);
  const sheetXmlPath = `xl/worksheets/${targetSheetFile}`;
  const sheetXmlFile = zip.file(sheetXmlPath);
  if (!sheetXmlFile) throw new Error(`chartInjector: ${sheetXmlPath} not found in workbook`);

  const sheetXml = await sheetXmlFile.async('string');
  const patched = patchWorksheetXmlForSparklines(sheetXml, targetSheetName, sparklines);
  if (patched === sheetXml) return xlsxBuffer;
  zip.file(sheetXmlPath, patched);
  return zip.generateAsync({ type: 'nodebuffer' });
};

module.exports = {
  injectChartsIntoXlsx,
  injectSparklinesIntoXlsx,
  __internal: {
    buildDoughnutChartXml,
    buildBarChartXml,
    buildComboChartXml,
    buildTornadoChartXml,
    buildSparklineExtXml,
    buildDrawingXml,
    buildDrawingRels,
    ensureContentTypes,
    patchWorksheetXmlForDrawing,
    patchWorksheetXmlForSparklines,
  },
};
