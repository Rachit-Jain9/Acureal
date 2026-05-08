// Tiny utility: download an in-memory markdown string as a .md file.
// Used by the IC Memo and Risk Brief panels so analysts can paste into
// emails / decks without copy-paste loss of formatting.
//
// Browser-only — never call from server-side code paths.

/**
 * Trigger a browser download of the supplied markdown string.
 *
 * @param {string} content      — the markdown body
 * @param {string} filename     — suggested filename (extension auto-added if missing)
 * @returns {boolean}           — true on success, false if browser doesn't support it
 */
export function downloadMarkdown(content, filename = 'document.md') {
  if (!content || typeof window === 'undefined') return false;
  const safe = filename.endsWith('.md') ? filename : `${filename}.md`;
  // Indian-investor-friendly default: BOM-less UTF-8 (₹ renders correctly
  // in Word, Google Docs, and macOS TextEdit).
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safe;
  // Required for Firefox — element must be in the DOM before click().
  document.body.appendChild(a);
  a.click();
  // Cleanup — strip the synthetic node + revoke the blob URL on the next
  // tick so the download has time to start before the URL is freed.
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

/**
 * Copy markdown to the clipboard.
 *
 * @param {string} content
 * @returns {Promise<boolean>}  — true on success, false on permission denial / unsupported browser
 */
export async function copyMarkdownToClipboard(content) {
  if (!content || typeof navigator === 'undefined' || !navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(content);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build a sensible filename for an AI artifact download given the deal
 * context. Falls back to "document" when the deal name is missing.
 *
 *   buildArtifactFilename('Whitefield Plot 22', 'ic-memo')
 *     → 'whitefield-plot-22-ic-memo-2026-05-09.md'
 */
export function buildArtifactFilename(dealName, kind = 'memo') {
  const slug = String(dealName || 'document')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'document';
  const today = new Date().toISOString().slice(0, 10);
  return `${slug}-${kind}-${today}.md`;
}
