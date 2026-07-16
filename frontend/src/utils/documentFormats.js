/**
 * Deal-document format registry — ESM MIRROR of
 * `backend/src/constants/documentFormats.js`.
 *
 * Locked by `backend/tests/documentFormats.parity.test.js`: the two files are
 * read by different runtimes (CommonJS on the server, ESM in the SPA) so they
 * cannot share an import, but they MUST stay identical. Any divergence fails
 * the build. Edit BOTH, never one. (Same pattern as rentRollMetrics.js.)
 *
 * Never add a CommonJS artifact here (`module.exports`, `require`, `process`):
 * this file is evaluated as a live ES module by the browser and a stray
 * CommonJS reference throws at module-eval time. See PR #981.
 *
 * ── Extraction tiers ────────────────────────────────────────────────────────
 *   'native'      — the provider reads the file directly (PDF + supported images).
 *   'parseable'   — REDIP transcribes the file to text server-side first.
 *   'stored_only' — stored + downloadable, honestly NOT AI-readable.
 */

// Extension → { mime, tier, label }.
export const DOCUMENT_FORMATS = Object.freeze({
  // ── Native ────────────────────────────────────────────────────────────────
  '.pdf':     { mime: 'application/pdf',  tier: 'native', label: 'PDF' },
  '.png':     { mime: 'image/png',        tier: 'native', label: 'PNG image' },
  '.jpg':     { mime: 'image/jpeg',       tier: 'native', label: 'JPEG image' },
  '.jpeg':    { mime: 'image/jpeg',       tier: 'native', label: 'JPEG image' },
  '.webp':    { mime: 'image/webp',       tier: 'native', label: 'WebP image' },
  '.heic':    { mime: 'image/heic',       tier: 'native', label: 'HEIC image' },
  '.heif':    { mime: 'image/heif',       tier: 'native', label: 'HEIF image' },

  // ── Parseable ─────────────────────────────────────────────────────────────
  '.xlsx':    { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', tier: 'parseable', label: 'Excel workbook' },
  '.xlsm':    { mime: 'application/vnd.ms-excel.sheet.macroEnabled.12',                    tier: 'parseable', label: 'Excel workbook (macro-enabled)' },
  '.docx':    { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', tier: 'parseable', label: 'Word document' },
  '.pptx':    { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', tier: 'parseable', label: 'PowerPoint deck' },
  '.csv':     { mime: 'text/csv',                     tier: 'parseable', label: 'CSV' },
  '.tsv':     { mime: 'text/tab-separated-values',    tier: 'parseable', label: 'TSV' },
  '.json':    { mime: 'application/json',             tier: 'parseable', label: 'JSON' },
  '.geojson': { mime: 'application/geo+json',         tier: 'parseable', label: 'GeoJSON' },
  '.kml':     { mime: 'application/vnd.google-earth.kml+xml', tier: 'parseable', label: 'KML (Google Earth)' },
  '.kmz':     { mime: 'application/vnd.google-earth.kmz',     tier: 'parseable', label: 'KMZ (Google Earth)' },
  '.gpx':     { mime: 'application/gpx+xml',          tier: 'parseable', label: 'GPX track' },
  '.xml':     { mime: 'application/xml',              tier: 'parseable', label: 'XML' },
  '.txt':     { mime: 'text/plain',                   tier: 'parseable', label: 'Text file' },
  '.md':      { mime: 'text/markdown',                tier: 'parseable', label: 'Markdown' },

  // ── Stored only ───────────────────────────────────────────────────────────
  '.dwg':     { mime: 'image/vnd.dwg',                tier: 'stored_only', label: 'AutoCAD drawing' },
  '.dxf':     { mime: 'image/vnd.dxf',                tier: 'stored_only', label: 'AutoCAD exchange drawing' },
  '.skp':     { mime: 'application/vnd.sketchup.skp', tier: 'stored_only', label: 'SketchUp model' },
  '.rvt':     { mime: 'application/octet-stream',     tier: 'stored_only', label: 'Revit model' },
  '.ifc':     { mime: 'application/x-step',           tier: 'stored_only', label: 'IFC / BIM model' },
  '.xer':     { mime: 'application/octet-stream',     tier: 'stored_only', label: 'Primavera schedule' },
  '.mpp':     { mime: 'application/vnd.ms-project',   tier: 'stored_only', label: 'MS Project schedule' },
  '.shp':     { mime: 'application/octet-stream',     tier: 'stored_only', label: 'Shapefile geometry' },
  '.shx':     { mime: 'application/octet-stream',     tier: 'stored_only', label: 'Shapefile index' },
  '.dbf':     { mime: 'application/x-dbf',            tier: 'stored_only', label: 'Shapefile attributes' },
  '.prj':     { mime: 'text/plain',                   tier: 'stored_only', label: 'Shapefile projection' },
  '.zip':     { mime: 'application/zip',              tier: 'stored_only', label: 'ZIP archive' },
  '.doc':     { mime: 'application/msword',           tier: 'stored_only', label: 'Word 97-2003 document' },
  '.xls':     { mime: 'application/vnd.ms-excel',     tier: 'stored_only', label: 'Excel 97-2003 workbook' },
  '.ppt':     { mime: 'application/vnd.ms-powerpoint', tier: 'stored_only', label: 'PowerPoint 97-2003 deck' },
  '.rtf':     { mime: 'application/rtf',              tier: 'stored_only', label: 'Rich Text document' },
  '.odt':     { mime: 'application/vnd.oasis.opendocument.text',         tier: 'stored_only', label: 'OpenDocument text' },
  '.ods':     { mime: 'application/vnd.oasis.opendocument.spreadsheet',  tier: 'stored_only', label: 'OpenDocument spreadsheet' },
  '.odp':     { mime: 'application/vnd.oasis.opendocument.presentation', tier: 'stored_only', label: 'OpenDocument presentation' },
  '.tif':     { mime: 'image/tiff',                   tier: 'stored_only', label: 'TIFF image' },
  '.tiff':    { mime: 'image/tiff',                   tier: 'stored_only', label: 'TIFF image' },
  '.gif':     { mime: 'image/gif',                    tier: 'stored_only', label: 'GIF image' },
  '.bmp':     { mime: 'image/bmp',                    tier: 'stored_only', label: 'BMP image' },
});

export const FALLBACK_MIME = 'application/octet-stream';

export const ALLOWED_EXTENSIONS = Object.freeze(Object.keys(DOCUMENT_FORMATS));

// `accept` attribute for the upload input. Extensions only — browsers match
// these case-insensitively and it avoids the OS's unreliable MIME sniffing
// (Windows reports an empty type for .csv, .kml, .geojson and friends).
export const ACCEPT_ATTRIBUTE = ALLOWED_EXTENSIONS.join(',');

export const normalizeExtension = (fileNameOrExt) => {
  if (!fileNameOrExt) return '';
  const raw = String(fileNameOrExt).trim().toLowerCase();
  const lastDot = raw.lastIndexOf('.');
  if (lastDot === -1) return '';
  return raw.slice(lastDot);
};

export const isAllowedExtension = (fileNameOrExt) =>
  Object.prototype.hasOwnProperty.call(DOCUMENT_FORMATS, normalizeExtension(fileNameOrExt));

export const formatFor = (fileNameOrExt) => DOCUMENT_FORMATS[normalizeExtension(fileNameOrExt)] || null;

export const mimeForFile = (fileNameOrExt) => formatFor(fileNameOrExt)?.mime || FALLBACK_MIME;

export const extractionTierFor = ({ fileName = '', fileType = '' } = {}) => {
  const byExt = formatFor(fileName);
  if (byExt) return byExt.tier;
  const mime = String(fileType || '').split(';')[0].trim().toLowerCase();
  if (mime) {
    const match = Object.values(DOCUMENT_FORMATS).find((f) => f.mime === mime);
    if (match) return match.tier;
  }
  return 'stored_only';
};

export const isExtractable = (doc) => extractionTierFor(doc) !== 'stored_only';

export const labelFor = (fileNameOrExt) => formatFor(fileNameOrExt)?.label || 'this file type';

export const unsupportedExtractionMessage = (fileNameOrExt) =>
  `${labelFor(fileNameOrExt)} files are stored and downloadable, but REDIP cannot read them with AI yet. Export the content to PDF, Excel, or an image and upload that to extract fields.`;

export const EXTENSIONS_BY_TIER = Object.freeze({
  native: Object.freeze(ALLOWED_EXTENSIONS.filter((e) => DOCUMENT_FORMATS[e].tier === 'native')),
  parseable: Object.freeze(ALLOWED_EXTENSIONS.filter((e) => DOCUMENT_FORMATS[e].tier === 'parseable')),
  stored_only: Object.freeze(ALLOWED_EXTENSIONS.filter((e) => DOCUMENT_FORMATS[e].tier === 'stored_only')),
});
