'use strict';

/**
 * Deal-document format registry — the SINGLE source of truth for
 *   (a) which file types can be uploaded to a deal,
 *   (b) the server-derived MIME for each, and
 *   (c) whether REDIP can actually read the file with AI.
 *
 * Before this module the allow-list was duplicated in three places
 * (frontend DocumentsTab MIME list, multer middleware, document.service) which
 * drifted: the UI offered types the presign step rejected. Everything now
 * reads from here; `frontend/src/utils/documentFormats.js` is a mechanical
 * ESM mirror locked by a parity test.
 *
 * ── Extraction tiers ────────────────────────────────────────────────────────
 * The tier is a claim about what REDIP can HONESTLY do with the bytes
 * (CLAUDE.md: never ship UI that looks production-ready over an unsupported
 * workflow):
 *
 *   'native'      — the provider reads the file directly (PDF + the image
 *                   formats Gemini documents support). Sent as inline base64.
 *   'parseable'   — REDIP deterministically parses the file to text/structure
 *                   server-side FIRST, then sends that text to the model
 *                   (spreadsheets, CSV/TSV, JSON/GeoJSON, KML/KMZ, DOCX,
 *                   PPTX, plain text, XML).
 *   'stored_only' — the file is accepted, stored, versioned, and available to
 *                   download, but REDIP cannot read it. The UI says exactly
 *                   that and the extract endpoint refuses with the same copy.
 *                   Covers CAD (DWG/DXF), SketchUp, BIM/IFC, Primavera/MS
 *                   Project, shapefiles, legacy binary Office formats, and
 *                   image formats no supported provider decodes.
 *
 * Adding a format: add ONE entry here, mirror it in the frontend twin (the
 * parity test fails otherwise), and — for a new 'parseable' entry — teach
 * `services/ai/documentTextExtractor.js` how to read it.
 */

// Extension → { mime, tier, label }. `label` is the human name shown in the
// upload UI and in the honest "can't read this" copy.
const DOCUMENT_FORMATS = Object.freeze({
  // ── Native: provider reads the bytes directly ─────────────────────────────
  // Gemini's documented inline-data support: PDF + PNG/JPEG/WEBP/HEIC/HEIF.
  // Nothing else belongs in this tier — an undocumented type would fail at
  // the provider and surface to the user as a mystery extraction error.
  '.pdf':     { mime: 'application/pdf',  tier: 'native', label: 'PDF' },
  '.png':     { mime: 'image/png',        tier: 'native', label: 'PNG image' },
  '.jpg':     { mime: 'image/jpeg',       tier: 'native', label: 'JPEG image' },
  '.jpeg':    { mime: 'image/jpeg',       tier: 'native', label: 'JPEG image' },
  '.webp':    { mime: 'image/webp',       tier: 'native', label: 'WebP image' },
  '.heic':    { mime: 'image/heic',       tier: 'native', label: 'HEIC image' },
  '.heif':    { mime: 'image/heif',       tier: 'native', label: 'HEIF image' },

  // ── Parseable: REDIP parses to text, then the model reads the text ────────
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

  // ── Stored only: accepted + stored, honestly NOT AI-readable ──────────────
  // CAD / BIM / scheduling / GIS binaries need specialist toolchains REDIP
  // does not run. They upload, store, download, and version normally.
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
  // Legacy binary Office formats: the modern OOXML twins are parseable, these
  // are not (exceljs cannot read BIFF .xls; mammoth cannot read .doc).
  '.doc':     { mime: 'application/msword',           tier: 'stored_only', label: 'Word 97-2003 document' },
  '.xls':     { mime: 'application/vnd.ms-excel',     tier: 'stored_only', label: 'Excel 97-2003 workbook' },
  '.ppt':     { mime: 'application/vnd.ms-powerpoint', tier: 'stored_only', label: 'PowerPoint 97-2003 deck' },
  '.rtf':     { mime: 'application/rtf',              tier: 'stored_only', label: 'Rich Text document' },
  '.odt':     { mime: 'application/vnd.oasis.opendocument.text',         tier: 'stored_only', label: 'OpenDocument text' },
  '.ods':     { mime: 'application/vnd.oasis.opendocument.spreadsheet',  tier: 'stored_only', label: 'OpenDocument spreadsheet' },
  '.odp':     { mime: 'application/vnd.oasis.opendocument.presentation', tier: 'stored_only', label: 'OpenDocument presentation' },
  // Image formats no supported provider decodes. Stored, never silently
  // shipped to a model that would reject them.
  '.tif':     { mime: 'image/tiff',                   tier: 'stored_only', label: 'TIFF image' },
  '.tiff':    { mime: 'image/tiff',                   tier: 'stored_only', label: 'TIFF image' },
  '.gif':     { mime: 'image/gif',                    tier: 'stored_only', label: 'GIF image' },
  '.bmp':     { mime: 'image/bmp',                    tier: 'stored_only', label: 'BMP image' },
});

const FALLBACK_MIME = 'application/octet-stream';

const ALLOWED_EXTENSIONS = Object.freeze(Object.keys(DOCUMENT_FORMATS));

// `accept` attribute for the upload input. Extensions only — browsers match
// these case-insensitively and it avoids the OS's unreliable MIME sniffing
// (Windows reports an empty type for .csv, .kml, .geojson and friends).
const ACCEPT_ATTRIBUTE = ALLOWED_EXTENSIONS.join(',');

const normalizeExtension = (fileNameOrExt) => {
  if (!fileNameOrExt) return '';
  const raw = String(fileNameOrExt).trim().toLowerCase();
  const lastDot = raw.lastIndexOf('.');
  if (lastDot === -1) return '';
  return raw.slice(lastDot);
};

const isAllowedExtension = (fileNameOrExt) =>
  Object.prototype.hasOwnProperty.call(DOCUMENT_FORMATS, normalizeExtension(fileNameOrExt));

const formatFor = (fileNameOrExt) => DOCUMENT_FORMATS[normalizeExtension(fileNameOrExt)] || null;

/**
 * Server-derived MIME for a file name. NEVER trust a client-sent type: the
 * browser PUTs directly to storage and can claim anything.
 */
const mimeForFile = (fileNameOrExt) => formatFor(fileNameOrExt)?.mime || FALLBACK_MIME;

/**
 * Extraction tier for a stored document. Resolves by extension first (the
 * authoritative signal, since we derive the stored MIME from it); falls back
 * to the recorded MIME so a file stored without an extension still routes.
 * Unknown → 'stored_only': fail CLOSED, never guess a type at the provider.
 */
const extractionTierFor = ({ fileName = '', fileType = '' } = {}) => {
  const byExt = formatFor(fileName);
  if (byExt) return byExt.tier;
  const mime = String(fileType || '').split(';')[0].trim().toLowerCase();
  if (mime) {
    const match = Object.values(DOCUMENT_FORMATS).find((f) => f.mime === mime);
    if (match) return match.tier;
  }
  return 'stored_only';
};

const isExtractable = (doc) => extractionTierFor(doc) !== 'stored_only';

const labelFor = (fileNameOrExt) => formatFor(fileNameOrExt)?.label || 'this file type';

/**
 * The one sentence shown wherever a stored-only file meets an extraction
 * affordance — UI chip, tooltip, and the extract endpoint's 422 body. Same
 * words everywhere so the product never implies a capability it lacks.
 */
const unsupportedExtractionMessage = (fileNameOrExt) =>
  `${labelFor(fileNameOrExt)} files are stored and downloadable, but REDIP cannot read them with AI yet. Export the content to PDF, Excel, or an image and upload that to extract fields.`;

const EXTENSIONS_BY_TIER = Object.freeze({
  native: Object.freeze(ALLOWED_EXTENSIONS.filter((e) => DOCUMENT_FORMATS[e].tier === 'native')),
  parseable: Object.freeze(ALLOWED_EXTENSIONS.filter((e) => DOCUMENT_FORMATS[e].tier === 'parseable')),
  stored_only: Object.freeze(ALLOWED_EXTENSIONS.filter((e) => DOCUMENT_FORMATS[e].tier === 'stored_only')),
});

module.exports = {
  DOCUMENT_FORMATS,
  ALLOWED_EXTENSIONS,
  EXTENSIONS_BY_TIER,
  ACCEPT_ATTRIBUTE,
  FALLBACK_MIME,
  normalizeExtension,
  isAllowedExtension,
  formatFor,
  mimeForFile,
  extractionTierFor,
  isExtractable,
  labelFor,
  unsupportedExtractionMessage,
};
