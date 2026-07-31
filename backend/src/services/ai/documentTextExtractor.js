'use strict';

/**
 * Deterministic parse-to-text stage for 'parseable'-tier documents.
 *
 * WHY: the extraction pipeline could only ever read PDFs and images, because
 * it base64s raw bytes straight to Gemini's inline-data API. A rent roll in
 * .xlsx, a term sheet in .docx, a boundary in .kml, or a broker's .csv were
 * all unreadable — and `inferMimeType` silently labelled anything unknown as
 * application/pdf, so those uploads failed at the provider with a confusing
 * error. This module converts such files to faithful plain text FIRST; the
 * text then flows through the SAME prompt → model → validate → human-review
 * path as a PDF.
 *
 * RULES:
 *  • Deterministic only. This module transcribes; it never interprets,
 *    summarises, or infers. What the file says is what the model sees.
 *  • Structure is preserved where it carries meaning — spreadsheet cells and
 *    Word/PowerPoint tables become TSV-ish rows, because a rent roll whose
 *    cell boundaries are lost is worse than no extraction at all.
 *  • Formula-injection safe: spreadsheet cells are read as VALUES, never
 *    formula text (same posture as rentRollImport.service).
 *  • Hostile-archive safe: every zip-backed format (KMZ/DOCX/PPTX) is bounded
 *    by entry count and decompressed bytes, so a zip bomb can't exhaust the
 *    serverless function.
 *  • Bounded output: text is capped so an enormous workbook can't blow the
 *    provider's context or the token budget. Truncation is ANNOUNCED in the
 *    text itself — the model (and the reviewer) must know the tail is missing
 *    rather than silently treating a partial read as complete.
 */

// Heavy parsers (exceljs ~1.5s, cheerio ~0.6s, mammoth ~0.2s, jszip to load)
// are required at POINT OF USE, not at module top-level, to keep them off the
// serverless cold-start path — an auth or deal-workspace request must never pay
// to load the document-extraction stack. cheerio is used across several format
// handlers, so it gets a lazy wrapper that preserves every call site; the others
// are required inside the single handler that needs them.
let _cheerioLoad;
const loadHtml = (...args) => (_cheerioLoad || (_cheerioLoad = require('cheerio').load))(...args);
const { normalizeExtension, formatFor } = require('../../constants/documentFormats');

// Caps. Generous enough for real deal documents (a 2,000-row rent roll is
// ~400 KB of text), tight enough to bound cost and latency.
const MAX_TEXT_CHARS = 400_000;
const MAX_ZIP_ENTRIES = 512;
const MAX_UNCOMPRESSED_BYTES = 80 * 1024 * 1024;
const MAX_SHEET_ROWS = 5_000;
const MAX_SHEET_COLS = 200;
const MAX_JSON_DEPTH_CHARS = MAX_TEXT_CHARS;

const TRUNCATION_NOTICE = (what) =>
  `\n\n[Acureal: output truncated — this document is larger than the ${MAX_TEXT_CHARS.toLocaleString('en-IN')}-character read limit. ${what} beyond this point were NOT read. Treat any "total" or "count" as covering only the rows shown above.]`;

const capText = (text, what = 'Rows') =>
  (text.length <= MAX_TEXT_CHARS ? text : text.slice(0, MAX_TEXT_CHARS) + TRUNCATION_NOTICE(what));

/**
 * Assemble a parser's output: Acureal's explanatory preamble + the document's
 * own content, capped.
 *
 * Returns '' when the document contributed NOTHING, which is what makes the
 * empty-document guard in parseDocumentToText work. Composing the preamble
 * unconditionally would make every result non-empty, so a blank .docx / .csv
 * / .txt would sail through as a "successful" extraction whose entire content
 * was Acureal's own header — and the model would answer from nothing.
 */
const compose = (preamble, body, what = 'Rows') => {
  const trimmed = String(body || '').trim();
  if (!trimmed) return '';
  return capText(`${preamble}\n\n${trimmed}`, what);
};

/** Cell → flat string. Handles every ExcelJS value shape without interpreting. */
const cellToText = (value) => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    // ExcelJS yields `new Date(NaN)` for an out-of-range or malformed serial
    // date (Excel's 1900 leap-year quirk, a negative serial, a corrupt cell).
    // `instanceof Date` still passes, and toISOString() then throws
    // RangeError('Invalid time value') — which aborted the whole workbook
    // parse, and with it the entire extraction, before classification ever ran.
    // One unreadable cell must not cost the document: treat it as empty.
    if (Number.isNaN(value.getTime())) return '';
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'object') {
    // Formula cells: take the CACHED RESULT, never the formula source — the
    // same formula-injection posture as the deterministic template importer.
    if ('result' in value) return cellToText(value.result);
    if ('text' in value) return String(value.text);
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((r) => r?.text ?? '').join('');
    }
    if ('hyperlink' in value) return String(value.text || value.hyperlink || '');
    if ('error' in value) return String(value.error);
    return '';
  }
  return String(value);
};

/**
 * XLSX / XLSM → one TSV block per worksheet. Sheet names are kept: on an
 * Indian rent-roll pack the tab name ("Retail — Phase 1") is often the only
 * place the asset or phase is stated.
 */
const parseSpreadsheet = async (buffer) => {
  const ExcelJS = require('exceljs'); // lazy — off the cold-start path
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const blocks = [];
  let truncated = false;
  workbook.eachSheet((sheet) => {
    const lines = [];
    let rowCount = 0;
    sheet.eachRow({ includeEmpty: false }, (row) => {
      if (rowCount >= MAX_SHEET_ROWS) { truncated = true; return; }
      const cells = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        if (colNumber <= MAX_SHEET_COLS) cells[colNumber - 1] = cellToText(cell.value);
      });
      // Drop trailing empties so a sheet with 16k blank columns stays sane.
      while (cells.length && !cells[cells.length - 1]) cells.pop();
      if (cells.some((c) => c && c.trim())) {
        lines.push(cells.map((c) => (c || '').replace(/\s+/g, ' ').trim()).join('\t'));
        rowCount += 1;
      }
    });
    if (lines.length) {
      blocks.push(`### Sheet: ${sheet.name}\n${lines.join('\n')}`);
    }
  });

  const body = blocks.join('\n\n')
    + (truncated && blocks.length ? `\n\n[Acureal: some sheets exceeded ${MAX_SHEET_ROWS.toLocaleString('en-IN')} rows and were cut off.]` : '');
  return {
    text: compose(
      'Spreadsheet transcribed by Acureal. Each sheet below is tab-separated; the first row of a block is usually its header.',
      body,
      'Rows',
    ),
    kind: 'spreadsheet',
    meta: { sheets: blocks.length, rowLimited: truncated },
  };
};

/** CSV / TSV → passed through verbatim: already the text the model wants. */
const parseDelimitedText = (buffer, ext) => {
  const text = buffer.toString('utf8');
  const label = ext === '.tsv' ? 'tab-separated' : 'comma-separated';
  return {
    text: compose(`Delimited data file (${label}), transcribed verbatim by Acureal.`, text, 'Rows'),
    kind: 'delimited',
    meta: { bytes: buffer.length },
  };
};

/** JSON / GeoJSON → pretty-printed so the model can see the structure. */
const parseJsonDocument = (buffer, ext) => {
  const raw = buffer.toString('utf8');
  let text;
  let valid = true;
  try {
    text = JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    // Malformed JSON is still worth reading — say so rather than failing.
    valid = false;
    text = raw;
  }
  const label = ext === '.geojson' ? 'GeoJSON' : 'JSON';
  const preamble = valid
    ? `${label} document, transcribed by Acureal.`
    : `${label} document that does NOT parse as valid ${label} — transcribed as raw text. Do not assume any structure.`;
  return {
    text: compose(preamble, text.slice(0, MAX_JSON_DEPTH_CHARS), 'Elements'),
    kind: 'json',
    meta: { valid },
  };
};

/**
 * KML / GPX / XML → text with the element tree flattened to readable lines.
 * KML placemark names + coordinates matter for parcel work, so tag names are
 * kept alongside their text.
 */
const parseXmlLike = (buffer, ext, label) => {
  const raw = buffer.toString('utf8');
  const $ = loadHtml(raw, { xmlMode: true });
  const lines = [];
  $('*').each((_, el) => {
    const tag = el.tagName || el.name;
    if (!tag) return;
    // Only leaf-ish text nodes — an ancestor would repeat its whole subtree.
    const own = $(el).children().length === 0 ? $(el).text().trim() : '';
    if (own) lines.push(`${tag}: ${own.replace(/\s+/g, ' ')}`);
  });
  const flattened = lines.length ? lines.join('\n') : raw;
  return {
    text: compose(`${label} document, transcribed by Acureal (element: value, one per line).`, flattened, 'Elements'),
    kind: 'xml',
    meta: { elements: lines.length, extension: ext },
  };
};

const readZipSafely = async (buffer) => {
  const JSZip = require('jszip'); // lazy — off the cold-start path
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files).filter((f) => !f.dir);
  if (entries.length > MAX_ZIP_ENTRIES) {
    throw new Error(`Archive has ${entries.length} entries, above the ${MAX_ZIP_ENTRIES} Acureal reads.`);
  }
  return { zip, entries };
};

/** KMZ = zipped KML. Read the first .kml entry, bounded. */
const parseKmz = async (buffer) => {
  const { entries } = await readZipSafely(buffer);
  const kmlEntry = entries.find((f) => f.name.toLowerCase().endsWith('.kml'));
  if (!kmlEntry) throw new Error('KMZ archive contains no .kml document.');
  const kml = await kmlEntry.async('nodebuffer');
  if (kml.length > MAX_UNCOMPRESSED_BYTES) throw new Error('KMZ contents exceed the read limit.');
  const parsed = parseXmlLike(kml, '.kml', 'KML (from KMZ archive)');
  return { ...parsed, meta: { ...parsed.meta, archiveEntry: kmlEntry.name } };
};

/**
 * DOCX → text via mammoth's HTML conversion, then HTML → text preserving
 * table-cell boundaries. Raw <w:t> concatenation would smear a rent-roll
 * table into one unreadable line; mammoth keeps <table>/<tr>/<td>, which we
 * flatten to tab-separated rows.
 */
const parseDocx = async (buffer) => {
  const mammoth = require('mammoth'); // lazy — off the cold-start path
  const { value: html, messages } = await mammoth.convertToHtml({ buffer });
  const $ = loadHtml(html || '');
  const out = [];

  $('body').children().each((_, el) => {
    const $el = $(el);
    if (el.tagName === 'table') {
      $el.find('tr').each((__, tr) => {
        const cells = $(tr).find('th,td').map((___, td) => $(td).text().replace(/\s+/g, ' ').trim()).get();
        if (cells.some(Boolean)) out.push(cells.join('\t'));
      });
      out.push('');
      return;
    }
    const text = $el.text().replace(/\s+/g, ' ').trim();
    if (text) out.push(text);
  });

  const body = out.length ? out.join('\n') : $.text().trim();
  return {
    text: compose(
      'Word document transcribed by Acureal. Tables appear as tab-separated rows.',
      body,
      'Paragraphs and rows',
    ),
    kind: 'docx',
    meta: { conversionWarnings: (messages || []).length },
  };
};

/**
 * PPTX → per-slide text. Slide XML holds runs in <a:t>; a deck's tables and
 * bullets both live there, so slide-scoped concatenation is the honest read.
 */
const parsePptx = async (buffer) => {
  const { zip, entries } = await readZipSafely(buffer);
  const slideNames = entries
    .map((f) => f.name)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
    // Numeric order — lexicographic would put slide10 before slide2.
    .sort((a, b) => {
      const num = (s) => parseInt(s.match(/slide(\d+)\.xml/i)?.[1] || '0', 10);
      return num(a) - num(b);
    });

  if (!slideNames.length) throw new Error('Presentation contains no readable slides.');

  const blocks = [];
  let bytes = 0;
  for (const name of slideNames) {
    const xml = await zip.file(name).async('string');
    bytes += xml.length;
    if (bytes > MAX_UNCOMPRESSED_BYTES) break;
    const $ = loadHtml(xml, { xmlMode: true });
    const runs = $('a\\:t').map((_, el) => $(el).text()).get().filter((t) => t.trim());
    if (runs.length) {
      const index = name.match(/slide(\d+)\.xml/i)?.[1] || '?';
      blocks.push(`### Slide ${index}\n${runs.join('\n')}`);
    }
  }

  return {
    text: compose('PowerPoint deck transcribed by Acureal, one block per slide.', blocks.join('\n\n'), 'Slides'),
    kind: 'pptx',
    meta: { slides: blocks.length },
  };
};

// Plain text needs no preamble — it IS the document.
const parsePlainText = (buffer, ext) => ({
  text: capText(buffer.toString('utf8').trim(), 'Lines'),
  kind: 'text',
  meta: { extension: ext },
});

/**
 * Parse a 'parseable'-tier document to text.
 *
 * @param {Buffer} buffer  raw file bytes
 * @param {string} fileName  used only to resolve the extension
 * @returns {Promise<{text: string, kind: string, meta: object}>}
 * @throws  when the format is not parseable, or the file is corrupt/hostile.
 *          Callers surface the message to the reviewer verbatim — every throw
 *          site here is written to be read by a human.
 */
const parseDocumentToText = async (buffer, fileName) => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('File is empty.');
  }
  const ext = normalizeExtension(fileName);
  const format = formatFor(fileName);
  if (!format || format.tier !== 'parseable') {
    throw new Error(`${ext || 'This file type'} is not a parseable document format.`);
  }

  let result;
  switch (ext) {
    case '.xlsx':
    case '.xlsm':
      result = await parseSpreadsheet(buffer); break;
    case '.csv':
    case '.tsv':
      result = parseDelimitedText(buffer, ext); break;
    case '.json':
    case '.geojson':
      result = parseJsonDocument(buffer, ext); break;
    case '.kml':
      result = parseXmlLike(buffer, ext, 'KML'); break;
    case '.gpx':
      result = parseXmlLike(buffer, ext, 'GPX'); break;
    case '.xml':
      result = parseXmlLike(buffer, ext, 'XML'); break;
    case '.kmz':
      result = await parseKmz(buffer); break;
    case '.docx':
      result = await parseDocx(buffer); break;
    case '.pptx':
      result = await parsePptx(buffer); break;
    case '.txt':
    case '.md':
      result = parsePlainText(buffer, ext); break;
    default:
      throw new Error(`No parser is wired for ${ext}.`);
  }

  if (!result.text || !result.text.trim()) {
    throw new Error(
      `No readable text found in this ${format.label}. If it is a scan, upload it as a PDF or image instead so Acureal can read it visually.`,
    );
  }
  return result;
};

module.exports = {
  parseDocumentToText,
  MAX_TEXT_CHARS,
  // Exported for tests
  __internal: { cellToText, capText, compose, parseSpreadsheet, parseDocx, parsePptx, parseKmz, parseXmlLike, parseJsonDocument, parseDelimitedText },
};
