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
// Three properties keep a waiver from rotting into a silent hole:
//   1. It is keyed on the exact GHSA id, so a DIFFERENT advisory on the same
//      package still fails the build.
//   2. It carries an `expires` date and fails the build once past it, forcing a
//      re-check rather than a permanent exemption.
//   3. It reports when it no longer matches any live advisory, so dead waivers
//      get deleted instead of accumulating.
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
        'THE VULNERABLE CODE CANNOT EXECUTE. image-size reaches production solely as a '
        + 'declared dependency of pptxgenjs@4.0.1, which never requires it: the only '
        + "reference to it in pptxgenjs's shipped bundles is inside a commented-out "
        + "`getSizeFromImage()` block annotated `FIXME: TODO: currently unused`, which "
        + "even names a non-existent package (`require('sizeof')`). Verified empirically "
        + 'by hooking Module.prototype.require and generating a full PPTX WITH an '
        + 'embedded image: image-size is never loaded. Independently, every image byte '
        + 'the backend hands to pptxgenjs is server-generated (an SVG score gauge it '
        + 'composes itself, and a PNG from a hardcoded Google Static Maps host with '
        + 'clamped lat/lng) — no uploaded document, photo or user-supplied URL reaches it.',
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
        found.set(ghsa, { ghsa, package: via.name || pkgName, severity: via.severity, title: via.title, via: pkgName });
      }
    }
  }
  return found;
};

const today = () => new Date().toISOString().slice(0, 10);

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

main();
