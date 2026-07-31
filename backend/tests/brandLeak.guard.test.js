'use strict';

/**
 * Brand-leak guard (2026-08-01).
 *
 * The REDIP→Acureal rebrand took SIX passes to actually finish, because the
 * retired brand kept surviving in places a casual grep missed: backend runtime
 * strings (API errors, coverage receipts, the TOTP issuer), client-side
 * download filenames, XLSX internal sheet names, AI system prompts. Each was
 * found by a different targeted sweep. This guard makes the seventh leak
 * impossible to MERGE rather than something a future sweep has to find.
 *
 * Two rules over the live source trees (frontend/src, backend/src, and each
 * packages/<name>/src):
 *
 *   1. `REDIP` (case-sensitive) may not appear. Uppercase was the brand;
 *      lowercase `redip` is deliberately untouched — it is the namespace of
 *      the load-bearing identifiers (redip_app, redip.access/refresh cookies,
 *      redip-* CSS classes, redip.* localStorage keys, the redip-documents
 *      bucket) that must never be renamed casually.
 *   2. `redip.vercel.app` may not appear. The old hostname lives on in
 *      exactly one place — the host-matched 308 in vercel.json, which is
 *      config, not source, and is not scanned.
 *
 * ALLOWLIST: every permitted occurrence must be listed here with a path, the
 * exact pattern, and a reason. It is EMPTY today — both trees are clean — and
 * additions should survive review only when they name a genuine legacy
 * identifier, never prose.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

const SCAN_ROOTS = [
  'frontend/src',
  'backend/src',
  'packages/financial-kernel/src',
  'packages/real-estate-ontology/src',
];

// { file: 'backend/src/example.js', pattern: 'REDIP', reason: '...' }
const ALLOWLIST = [];

const SCAN_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.cjs', '.mjs', '.json', '.css', '.html', '.md', '.sql',
]);

const FORBIDDEN = [
  { pattern: 'REDIP', why: 'retired brand (uppercase = user-facing; lowercase identifiers are exempt by design)' },
  { pattern: 'redip.vercel.app', why: 'retired hostname (only vercel.json\'s redirect may reference it)' },
];

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SCAN_EXTENSIONS.has(path.extname(entry.name))) out.push(full);
  }
  return out;
};

const isAllowlisted = (relFile, pattern) =>
  ALLOWLIST.some((a) => a.file === relFile && a.pattern === pattern);

describe('brand-leak guard — the retired brand cannot re-enter the source', () => {
  const files = SCAN_ROOTS.flatMap((root) => {
    const abs = path.join(REPO_ROOT, root);
    return fs.existsSync(abs) ? walk(abs) : [];
  });

  test('scans a sane number of files (the walker is not silently broken)', () => {
    // A refactor that moved src/ without updating SCAN_ROOTS would make this
    // guard pass vacuously. Pin a floor well below reality (~2k files).
    expect(files.length).toBeGreaterThan(500);
  });

  test.each(FORBIDDEN.map((f) => [f.pattern, f.why]))(
    'no non-allowlisted "%s" in the live source trees',
    (pattern) => {
      const hits = [];
      for (const file of files) {
        const text = fs.readFileSync(file, 'utf8');
        if (!text.includes(pattern)) continue;
        const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
        if (isAllowlisted(rel, pattern)) continue;
        const line = text.split('\n').findIndex((l) => l.includes(pattern)) + 1;
        hits.push(`${rel}:${line}`);
      }
      expect(hits).toEqual([]);
    },
  );
});
