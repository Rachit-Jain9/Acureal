/**
 * Small helpers shared by the Intelligence-page table components.
 *
 * Extracted from IntelligencePage.jsx (2026-05-25, Task #6) so the
 * decomposed table files (`components/intelligence/*BenchmarksTable.jsx`)
 * can import them without re-pulling the entire page.
 */

/**
 * Build the option list for a cluster-filter pill row by tallying the
 * distinct `cluster` values in a row set. Each option carries `count`
 * so the UI can render the chip with its frequency, and they sort by
 * frequency descending so the most-populated cluster is leftmost.
 */
export const buildClusterOptions = (rows) => {
  const counts = {};
  for (const r of rows) {
    const c = r.cluster || 'Other';
    counts[c] = (counts[c] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([value, count]) => ({ value, label: value, count }))
    .sort((a, b) => b.count - a.count);
};

/**
 * Case-insensitive substring search across an explicit list of keys on a
 * row. Returns true for an empty / whitespace-only term so the caller
 * can use it as a permissive default predicate.
 */
export const matchesSearch = (row, term, keys) => {
  if (!term) return true;
  const t = term.toLowerCase();
  return keys.some((k) => String(row[k] ?? '').toLowerCase().includes(t));
};
