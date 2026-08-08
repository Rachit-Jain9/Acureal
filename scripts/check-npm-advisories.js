'use strict';

// Dependency-advisory gate.
//
// Replaces three raw `npm audit --audit-level=high` steps in CI with one check
// that can hold a SMALL, DOCUMENTED, EXPIRING waiver.
//
// WHY THIS EXISTS. `npm audit` queries the live advisory database, so the gate
// can turn red on a branch that changed no dependency — it has happened twice:
//
//   2026-07-27  GHSA-mh99-v99m-4gvg (brace-expansion) reddened every branch.
//               Fixable: 5.0.8 was published, so an `overrides` pin closed it.
//   2026-08-08  GHSA-w3rx-r6r6-pgpr + GHSA-5p2g-fcmc-qvqq (image-size).
//               NOT fixable: the advisories cover `<=2.0.2` and 2.0.2 IS the
//               latest published image-size. No patched version exists to pin.
//
// When a patched version exists, pin it — `overrides` + `overridesRationale` in
// the workspace package.json remains the first resort, and this script must
// never become the easy way around doing that. A waiver here is only for an
// advisory with NO upstream fix, and it must carry proof that the vulnerable
// code cannot execute.
//
// Four properties keep a waiver from rotting into a silent hole:
//   1. It is keyed on the exact GHSA id, so a DIFFERENT advisory on the same
//      package still fails the build.
//   2. It carries an `expires` date and fails the build once past it, forcing a
//      re-check rather than a permanent exemption.
//   3. It reports when it no longer matches any live advisory, so dead waivers
//      get deleted instead of accumulating.
//   4. It records the REMEDIATION STATE that justified it (`noFixState`) and
//      re-checks that state on every run. The whole premise of a waiver is
//      "no fix exists"; the moment npm offers a real one the waiver has become
//      a false statement, and the build fails saying so.
//
// Why (4) matters more than the expiry date. An expiry is a calendar reminder:
// it does nothing for the months between now and then, and its natural failure
// mode is someone pushing the date out to get green. `noFixState` is a
// continuous check on the actual claim, costing no extra network call —
// `fixAvailable` is already in the audit report the gate reads. A fix that
// lands in September is caught in September, not in November.
//
// Exit code 0 = clean, exit code 1 = failures (with details printed).

const path = require('path');
const { execSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// The three gated workspaces, with the exact scope each is audited at.
//
// `--omit=dev` on backend and frontend is deliberate and predates this script:
// the gate is for vulnerabilities in what SHIPS to users, not in build/test
// tooling (vite, esbuild, vitest, jest) that never reaches a browser or a
// serverless function. The kernel is audited in full because its devDeps are
// part of what it publishes.
const WORKSPACES = [
  { name: 'backend', prefix: 'backend', omitDev: true },
  { name: 'frontend', prefix: 'frontend', omitDev: true },
  { name: 'kernel', prefix: 'packages/financial-kernel', omitDev: false },
];

const BLOCKING_SEVERITIES = new Set(['high', 'critical']);

// ── Waivers ─────────────────────────────────────────────────────────────────
// Keyed `<workspace>:<GHSA id>`. Adding an entry here must be a deliberate,
// reviewed decision with reproducible evidence — never a reflex to get a build
// green. If a patched version exists, pin it instead.
const WAIVERS = new Map([
  [
    'backend:GHSA-w3rx-r6r6-pgpr',
    {
      package: 'image-size',
      expires: '2026-11-06',
      reason:
        'DoS in the ICNS parser. No patched version exists — the advisory covers <=2.0.2 '
        + 'and 2.0.2 is the latest published image-size, so there is nothing to pin to. '
        + "npm's only offered remedy is downgrading pptxgenjs 4.0.1 -> 1.1.5, four major "
        + 'versions back, which would destroy PPTX export.',
      evidence:
        'THE VULNERABLE CODE CANNOT EXECUTE. Four independent checks, any one sufficient:\n'
        + '  (1) NOTHING IN THE INSTALLED TREE LOADS IT. Ripgrepping backend/node_modules '
        + "for require('image-size') / from 'image-size' / import('image-size') matches "
        + "exactly one file — image-size's own README. pptxgenjs@4.0.1 is the sole "
        + "declarant, and its own package.json `browser` map stubs it to false.\n"
        + '  (2) THE CALL SITE IS COMMENTED OUT. The only `sizeOf` reference in pptxgenjs\'s '
        + 'shipped CJS/ESM bundles sits inside a `getSizeFromImage()` block annotated '
        + "`FIXME: TODO: currently unused`, which even names a package that does not exist "
        + "(`require('sizeof')`, not `image-size`). The minified bundles strip it entirely.\n"
        + '  (3) VERIFIED EMPIRICALLY, NOT BY READING. Hooking Module.prototype.require and '
        + 'generating a full PPTX WITH an embedded image loads 90+ modules; image-size is '
        + 'not among them.\n'
        + '  (4) THE I/O BRANCHES ARE NEVER TAKEN ANYWAY. Every image the backend passes is '
        + "a `data:` base64 URI, never a `path:`; pptxgenjs's candidate filter excludes any "
        + 'rel carrying `data` before its fs.readFileSync and https.get branches. And every '
        + 'byte is server-generated — an SVG score gauge the server composes itself, and a '
        + 'PNG from a hardcoded Google Static Maps host with clamped lat/lng. No uploaded '
        + 'document, photo or user-supplied URL reaches the deck builder at all.',
      // The remediation state as of 2026-08-08, re-verified against the live
      // registry that day: image-size's latest published version is 2.0.2
      // (unchanged since 2025-04-02) and the advisory covers <=2.0.2, so there
      // is nothing to pin. pptxgenjs 4.0.1 is also latest. npm's only offer is
      // a four-major downgrade of the parent, which would destroy PPTX export.
      // If this stops matching, a real fix may exist — see assessFixState.
      noFixState: { name: 'pptxgenjs', version: '1.1.5', isSemVerMajor: true },
    },
  ],
  [
    'backend:GHSA-5p2g-fcmc-qvqq',
    {
      package: 'image-size',
      expires: '2026-11-06',
      reason:
        'DoS in the JXL and HEIF parsers. Same package, same unfixable position as '
        + 'GHSA-w3rx-r6r6-pgpr above.',
      evidence: 'See GHSA-w3rx-r6r6-pgpr — identical reachability proof.',
      noFixState: { name: 'pptxgenjs', version: '1.1.5', isSemVerMajor: true },
    },
  ],
]);

/** Run `npm audit --json` for one workspace and return the parsed report. */
const auditWorkspace = ({ prefix, omitDev }) => {
  const args = ['audit', '--json', '--prefix', prefix];
  if (omitDev) args.push('--omit=dev');
  let stdout;
  // Run through the shell as a single command string. Windows needs it (since
  // Node 20 a .cmd shim cannot be spawned directly — EINVAL), and passing one
  // string avoids the DEP0190 warning that `shell: true` + an args array
  // raises. Safe: every token is a fixed literal from WORKSPACES above, never
  // user input.
  const command = [NPM, ...args.map((a) => (/[^\w=./-]/.test(a) ? JSON.stringify(a) : a))].join(' ');
  try {
    stdout = execSync(command, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    // `npm audit` exits non-zero whenever it finds anything at all. The report
    // is still on stdout, so a non-zero exit is expected, not an error.
    stdout = err.stdout;
    if (!stdout) {
      throw new Error(`npm audit failed for ${prefix}: ${err.stderr || err.message}`);
    }
  }
  return JSON.parse(stdout);
};

/** GHSA id out of an advisory URL, e.g. .../advisories/GHSA-xxxx-yyyy-zzzz */
const ghsaFromUrl = (url) => (typeof url === 'string' ? (url.match(/GHSA-[0-9a-z-]+/i) || [null])[0] : null);

/**
 * Every distinct high/critical advisory in one report, flattened out of npm's
 * nested `via` graph. One package can carry several advisories, and the same
 * advisory can surface under several packages, so key on the GHSA id.
 */
const blockingAdvisories = (report) => {
  const found = new Map();
  for (const [pkgName, vuln] of Object.entries(report.vulnerabilities || {})) {
    if (!BLOCKING_SEVERITIES.has(vuln.severity)) continue;
    for (const via of vuln.via || []) {
      if (typeof via !== 'object') continue;
      if (!BLOCKING_SEVERITIES.has(via.severity)) continue;
      const ghsa = ghsaFromUrl(via.url);
      if (!ghsa) continue;
      if (!found.has(ghsa)) {
        found.set(ghsa, {
          ghsa,
          package: via.name || pkgName,
          severity: via.severity,
          title: via.title,
          via: pkgName,
          // Carried so a waiver can re-check its own "no fix exists" premise
          // without a second audit run or any registry call.
          fixAvailable: vuln.fixAvailable,
        });
      }
    }
  }
  return found;
};

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Has a REAL upstream fix appeared since this waiver was written?
 *
 * A waiver asserts "no patched version exists". `npm audit` already reports
 * what remediation it can see, per advisory, in `fixAvailable` — so the claim
 * can be re-checked continuously and for free, instead of waiting for an
 * expiry date and trusting someone to look.
 *
 * `fixAvailable` takes three shapes:
 *   false                         → npm knows of no remediation at all.
 *   true                          → an in-place fix exists. Pin it.
 *   { name, version, isSemVerMajor } → the fix is to move some package. That is
 *                                   only a REAL fix if it does not require a
 *                                   destructive major move of a parent; npm's
 *                                   offer for image-size is pptxgenjs@1.1.5,
 *                                   four majors back, which would delete PPTX
 *                                   export rather than fix anything.
 *
 * Returns one of:
 *   'none'      — still no fix; the waiver's premise holds.
 *   'available' — a real fix exists. The waiver is now a FALSE statement and
 *                 must fail the build: pin the fix and delete the waiver.
 *   'changed'   — the offer moved but is still destructive. Not fatal, but
 *                 reported, because it usually means upstream is in motion.
 */
const assessFixState = (waiver, fixAvailable) => {
  const recorded = waiver.noFixState;

  // An in-place fix — unambiguous.
  if (fixAvailable === true) return 'available';
  if (!fixAvailable) return recorded ? 'none' : 'none';

  if (typeof fixAvailable === 'object') {
    // A fix that lands ON the waived package itself is real by definition:
    // the package we could not pin now has something to pin to.
    if (fixAvailable.name === waiver.package) return 'available';
    // A non-major move of a parent is a real, non-destructive fix.
    if (fixAvailable.isSemVerMajor === false) return 'available';
    // Still a major parent move. Real only in the sense that upstream changed.
    if (!recorded) return 'changed';
    const same = recorded.name === fixAvailable.name
      && recorded.version === fixAvailable.version
      && recorded.isSemVerMajor === fixAvailable.isSemVerMajor;
    return same ? 'none' : 'changed';
  }

  return 'none';
};

function main() {
  let failures = 0;
  const matchedWaivers = new Set();
  const runDate = today();

  for (const workspace of WORKSPACES) {
    const report = auditWorkspace(workspace);
    const advisories = blockingAdvisories(report);

    const blocked = [];
    const waived = [];
    const failuresBefore = failures;

    for (const [ghsa, advisory] of advisories) {
      const key = `${workspace.name}:${ghsa}`;
      const waiver = WAIVERS.get(key);
      if (!waiver) {
        blocked.push(advisory);
        continue;
      }
      matchedWaivers.add(key);
      if (waiver.expires < runDate) {
        failures += 1;
        console.error(
          `✗ ${workspace.name}: waiver for ${ghsa} (${waiver.package}) EXPIRED on ${waiver.expires}.\n`
            + '  Re-check whether an upstream fix now exists. If it does, pin it and delete the waiver.\n'
            + '  If it still does not, re-verify the evidence and extend the date deliberately.',
        );
        continue;
      }

      // The waiver claims no fix exists. Verify that claim is still true —
      // every run, not once a quarter.
      const fixState = assessFixState(waiver, advisory.fixAvailable);
      if (fixState === 'available') {
        failures += 1;
        console.error(
          `✗ ${workspace.name}: waiver for ${ghsa} (${waiver.package}) is NO LONGER TRUE — `
            + 'npm now reports a fix.\n'
            + `  npm offers: ${JSON.stringify(advisory.fixAvailable)}\n`
            + '  The waiver exists only because no patched version existed. Pin the fix via\n'
            + '  `overrides` + `overridesRationale` in the workspace package.json, then DELETE\n'
            + '  the waiver. Do not extend the expiry.',
        );
        continue;
      }
      if (fixState === 'changed') {
        console.log(
          `[check-npm-advisories] note: ${workspace.name}: the remediation npm offers for ${ghsa} `
            + `has changed since the waiver was written.\n`
            + `  recorded: ${JSON.stringify(waiver.noFixState)}\n`
            + `  current:  ${JSON.stringify(advisory.fixAvailable)}\n`
            + '  Still a destructive major move, so not fatal — but upstream is moving; re-check.',
        );
      }

      waived.push({ advisory, waiver });
    }

    for (const advisory of blocked) {
      failures += 1;
      console.error(
        `✗ ${workspace.name}: ${advisory.severity} advisory ${advisory.ghsa} in ${advisory.package}`
          + `${advisory.via && advisory.via !== advisory.package ? ` (via ${advisory.via})` : ''}\n`
          + `  ${advisory.title}\n`
          + '  Fix it — pin a patched version via `overrides` + `overridesRationale` in the\n'
          + '  workspace package.json. Only waive it in scripts/check-npm-advisories.js if NO\n'
          + '  patched version exists AND you can prove the vulnerable code cannot execute.',
      );
    }

    for (const { advisory, waiver } of waived) {
      console.log(
        `• ${workspace.name}: ${advisory.ghsa} (${waiver.package}) waived until ${waiver.expires} — ${waiver.reason}`,
      );
    }

    // "clean" must account for expired waivers too, not just unwaived
    // advisories — otherwise the workspace reports clean in the same breath as
    // it fails, which is exactly the kind of reassuring-but-wrong output a
    // security gate must never produce.
    if (failures === failuresBefore) {
      console.log(
        `[check-npm-advisories] ${workspace.name}: clean`
          + `${waived.length ? ` (${waived.length} documented waiver${waived.length === 1 ? '' : 's'})` : ''}.`,
      );
    }
  }

  // A waiver that no longer matches anything live is dead weight — and dead
  // weight in an exception list is how the next real advisory gets waved
  // through. Reported loudly, but not fatal: an advisory being withdrawn
  // upstream should not break every build until someone tidies up.
  for (const key of WAIVERS.keys()) {
    if (!matchedWaivers.has(key)) {
      console.log(
        `[check-npm-advisories] note: waiver ${key} no longer matches any live advisory — delete it.`,
      );
    }
  }

  if (failures > 0) {
    console.error(`\n[check-npm-advisories] ${failures} blocking advisory issue(s).`);
    process.exit(1);
  }
  console.log('[check-npm-advisories] all workspaces clean at high/critical.');
}

// Only run when invoked as a script, so the pure helpers above can be unit
// tested. A security gate whose logic has never been exercised by a test is
// itself a risk — the waiver path in particular has to be proven to FAIL when
// it should, and that cannot be proven by watching it pass in CI.
if (require.main === module) {
  main();
}

module.exports = { assessFixState, blockingAdvisories, ghsaFromUrl, WAIVERS };
