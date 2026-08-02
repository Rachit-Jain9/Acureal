#!/usr/bin/env node
'use strict';

// CI contract for environment variables.
//
// WHY THIS EXISTS. Acureal reads 90+ environment variables and nothing recorded
// what they were for, who may see them, or whether they were still used. The
// gap has already produced real defects — a rebrand sweep renamed a kill switch
// from REDIP_SKIP_* to Acureal_SKIP_*, and because environment names are
// case-sensitive an operator with the old switch set was silently left holding
// a dead one. A naming rule would have caught it in review.
//
// WHAT IT CHECKS. Everything provable from source alone:
//
//   1. REGISTERED   — a variable referenced in code must appear in the manifest,
//                     so nobody adds a nameless knob nobody can audit.
//   2. NAMING       — SCREAMING_SNAKE_CASE. This is the rule that catches the
//                     mixed-case rebrand class before it ships.
//   3. EXPOSURE     — a `client` variable must carry the VITE_ prefix, and a
//                     `server` one must not. Vite inlines every VITE_* value
//                     into the browser bundle, so the prefix IS the boundary.
//   4. SECRETS      — nothing marked `secret` may be browser-readable. This is
//                     the check that would stop a service-role key ever being
//                     renamed into the bundle.
//   5. DEAD ENTRIES — a registered variable referenced nowhere is reported (as
//                     a note, not a failure — some are read only by tooling or
//                     kept deliberately as legacy aliases).
//
// WHAT IT CANNOT CHECK. It has no access to the hosting dashboard, so it cannot
// prove a variable is SET. `backend/src/config/validateEnv.js` owns that at
// boot, and derives its required/recommended lists from the same manifest so
// the two can never drift apart.
//
// Exit code 0 = clean, 1 = contract violations (details printed).

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const {
  ENV_MANIFEST,
  SCOPE,
  SENSITIVITY,
  VITE_BUILTINS,
} = require(path.join(ROOT, 'backend', 'src', 'config', 'envManifest'));

const SCAN_ROOTS = [
  { dir: path.join(ROOT, 'backend', 'src'), exts: ['.js'], pattern: /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g },
  { dir: path.join(ROOT, 'frontend', 'src'), exts: ['.js', '.jsx'], pattern: /import\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)/g },
];

const NAME_RE = /^[A-Z][A-Z0-9_]*$/;

// Strip comments before scanning. Without this, a documentation line like
// "process.env.AI_PROVIDER_<TASK>" registers as a variable named
// "AI_PROVIDER_" — a phantom the manifest could never legitimately contain.
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, '$1');

const walk = (dir, exts) => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full, exts);
    return exts.includes(path.extname(entry.name)) ? [full] : [];
  });
};

/** @returns {Map<string, Set<string>>} variable name -> repo-relative files */
function collectReferences() {
  const refs = new Map();
  for (const { dir, exts, pattern } of SCAN_ROOTS) {
    for (const file of walk(dir, exts)) {
      const code = stripComments(fs.readFileSync(file, 'utf8'));
      for (const match of code.matchAll(pattern)) {
        const name = match[1];
        if (VITE_BUILTINS.has(name)) continue;
        if (!refs.has(name)) refs.set(name, new Set());
        refs.get(name).add(path.relative(ROOT, file).replace(/\\/g, '/'));
      }
    }
  }
  return refs;
}

/**
 * Every registered name that appears ANYWHERE in scanned source — including as
 * a quoted string, a destructured property, or inside a comment. Deliberately
 * loose: it exists only to keep the "looks dead" note honest, never to satisfy
 * the registration requirement.
 *
 * @returns {Set<string>}
 */
function mentionedAnywhere() {
  const names = ENV_MANIFEST.map((e) => e.name);
  const found = new Set();
  for (const { dir, exts } of SCAN_ROOTS) {
    for (const file of walk(dir, exts)) {
      const src = fs.readFileSync(file, 'utf8');
      for (const name of names) {
        if (!found.has(name) && src.includes(name)) found.add(name);
      }
    }
  }
  return found;
}

function lintManifestShape() {
  const issues = [];
  const seen = new Set();

  for (const entry of ENV_MANIFEST) {
    const { name, scope, sensitivity } = entry;

    if (seen.has(name)) issues.push(`${name}: registered more than once.`);
    seen.add(name);

    if (!NAME_RE.test(name)) {
      issues.push(
        `${name}: not SCREAMING_SNAKE_CASE. Environment names are case-sensitive — `
        + 'a renamed variable silently stops resolving, which is how the Acureal_SKIP_* '
        + 'kill switches were broken by the rebrand.',
      );
    }

    if (scope === SCOPE.CLIENT && !name.startsWith('VITE_')) {
      issues.push(`${name}: scope is "client" but the name lacks the VITE_ prefix, so Vite will not expose it.`);
    }
    if (scope === SCOPE.SERVER && name.startsWith('VITE_')) {
      issues.push(
        `${name}: scope is "server" but the VITE_ prefix means Vite INLINES it into the browser bundle. `
        + 'Rename it or reclassify it — the prefix is the boundary, not the label in a dashboard.',
      );
    }
    if (sensitivity === SENSITIVITY.SECRET && scope === SCOPE.CLIENT) {
      issues.push(
        `${name}: marked "secret" AND browser-readable. Anything in the bundle is public to every visitor.`,
      );
    }
  }
  return issues;
}

function runCheck() {
  const refs = collectReferences();
  const registered = new Set(ENV_MANIFEST.map((e) => e.name));
  const issues = lintManifestShape();

  const unregistered = [...refs.keys()].filter((n) => !registered.has(n)).sort();
  for (const name of unregistered) {
    const where = [...refs.get(name)].slice(0, 3).join(', ');
    issues.push(
      `${name}: read in code but not registered in backend/src/config/envManifest.js (${where}). `
      + 'Add it with a scope, a sensitivity and one line on why it exists.',
    );
  }

  // Reported, never fatal. A direct `process.env.X` is not the only way to read
  // a variable: `readApiKey('GEMINI_API_KEY')` passes the name as a string,
  // `resolveSslConfig(env)` destructures a passed-in object, and the injection
  // switches build their names with a template literal. So before calling
  // anything dead, look for the name mentioned anywhere in source — otherwise
  // this note cries wolf and stops being read.
  const mentioned = mentionedAnywhere();
  const unreferenced = ENV_MANIFEST
    .filter((e) => e.scope !== SCOPE.PLATFORM && !refs.has(e.name) && !mentioned.has(e.name))
    .map((e) => e.name);

  if (issues.length === 0) {
    const clientCount = ENV_MANIFEST.filter((e) => e.scope === SCOPE.CLIENT).length;
    const secretCount = ENV_MANIFEST.filter((e) => e.sensitivity === SENSITIVITY.SECRET).length;
    console.log(
      `[check-env-manifest] ${ENV_MANIFEST.length} variables registered · `
      + `${refs.size} referenced in code · ${secretCount} secret · ${clientCount} browser-exposed · contract clean.`,
    );
    if (unreferenced.length) {
      console.log(
        `[check-env-manifest] note: registered but not referenced in scanned source — ${unreferenced.join(', ')}. `
        + 'Expected for legacy aliases and tooling-only variables; delete anything genuinely dead.',
      );
    }
    return { failures: 0, registered: ENV_MANIFEST.length, referenced: refs.size };
  }

  console.error('✗ environment contract violations\n');
  for (const issue of issues) console.error(`    - ${issue}`);
  console.error(`\n[check-env-manifest] ${issues.length} issue${issues.length === 1 ? '' : 's'}.`);
  return { failures: issues.length, registered: ENV_MANIFEST.length, referenced: refs.size };
}

module.exports = { collectReferences, lintManifestShape, stripComments, runCheck };

if (require.main === module) {
  process.exit(runCheck().failures === 0 ? 0 : 1);
}
