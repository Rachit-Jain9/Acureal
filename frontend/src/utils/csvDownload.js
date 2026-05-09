// Tiny CSV utility for client-side downloads. Used by surfaces that
// derive their tables in-memory (e.g. ReportsPage tabs over the deals
// dataset) and don't need a separate backend endpoint.
//
// Format: RFC 4180 — quote any field containing commas, quotes, or
// newlines; double-up embedded quotes. Stays compatible with Excel,
// Google Sheets, Numbers, and `csv` module readers.

const escapeCsvField = (value) => {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

/**
 * Build a CSV string from a header row + array of data rows.
 *
 *   rows: any[] — each entry is an array of cell values, parallel to headers
 *   headers: string[]
 *
 * Returns the CSV text (LF line endings — Sheets / Excel handle this).
 */
export function buildCsv({ headers, rows }) {
  if (!Array.isArray(headers) || headers.length === 0) {
    throw new Error('buildCsv: headers required');
  }
  const lines = [headers.map(escapeCsvField).join(',')];
  for (const row of rows || []) {
    if (!Array.isArray(row)) continue;
    lines.push(row.map(escapeCsvField).join(','));
  }
  return lines.join('\n');
}

/**
 * Trigger a browser download of a CSV blob with the supplied filename.
 * Uses a transient anchor + `URL.createObjectURL` so it works across
 * Chromium/WebKit/Firefox without permissions dialogs.
 */
export function downloadCsv({ filename, headers, rows }) {
  const csv = buildCsv({ headers, rows });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || `download-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Defer revoke so the browser has a tick to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Exported for tests.
export { escapeCsvField };
