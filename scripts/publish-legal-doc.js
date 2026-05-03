#!/usr/bin/env node
/**
 * Publish (or re-publish) a legal document version.
 *
 *   node scripts/publish-legal-doc.js <kind> <version> <path-to-md> [effectiveAt]
 *
 *   kind         one of terms_of_service | privacy_policy | cookie_policy |
 *                data_processing_addendum | acceptable_use
 *   version      arbitrary version string (e.g. v1, 2026-05-04, etc.)
 *   path-to-md   relative path to the markdown body
 *   effectiveAt  optional ISO-8601; defaults to "now"
 *
 * The script:
 *   1. Reads the markdown body from disk.
 *   2. Computes the SHA-256 hex digest of the body.
 *   3. In a single transaction:
 *        a. Unsets is_current=true on any prior current row of the same kind.
 *        b. Upserts the (kind, version) row with is_current=true.
 *
 * Pre-requisite: backend/.env DATABASE_URL is set OR DATABASE_URL exported
 * in the shell. Migration 20260504_legal_documents_and_acceptances.sql must
 * be applied first.
 *
 * Idempotent — re-running with the same args is a no-op (the body is
 * upserted, the SHA + is_current are restored to current values).
 */

'use strict';

const path = require('path');
const fs = require('fs');

// `dotenv` lives in backend/node_modules (it is a backend-only dependency),
// so requiring by bare name fails when this script is run from the repo
// root. Resolve through the absolute path inside backend/node_modules.
const backendNodeModules = path.resolve(__dirname, '..', 'backend', 'node_modules');
const dotenv = require(path.join(backendNodeModules, 'dotenv'));
dotenv.config({ path: path.resolve(__dirname, '..', 'backend', '.env') });
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const legalService = require(path.resolve(__dirname, '..', 'backend', 'src', 'services', 'legal.service'));

const usage = () => {
  process.stderr.write(
    'Usage: node scripts/publish-legal-doc.js <kind> <version> <path-to-md> [effectiveAt]\n'
  );
  process.exit(2);
};

const [, , kindArg, versionArg, mdPathArg, effectiveAtArg] = process.argv;
if (!kindArg || !versionArg || !mdPathArg) {
  usage();
}

if (!legalService.SUPPORTED_KINDS.includes(kindArg)) {
  process.stderr.write(
    `Unsupported kind "${kindArg}". Allowed: ${legalService.SUPPORTED_KINDS.join(', ')}\n`
  );
  process.exit(2);
}

const mdPath = path.resolve(mdPathArg);
if (!fs.existsSync(mdPath)) {
  process.stderr.write(`Markdown file not found: ${mdPath}\n`);
  process.exit(2);
}

const bodyMd = fs.readFileSync(mdPath, 'utf8');
const effectiveAt = effectiveAtArg ? new Date(effectiveAtArg) : new Date();
if (Number.isNaN(effectiveAt.valueOf())) {
  process.stderr.write(`Invalid effectiveAt: ${effectiveAtArg}\n`);
  process.exit(2);
}

(async () => {
  try {
    const doc = await legalService.publishLegalDocument({
      kind: kindArg,
      version: versionArg,
      effectiveAt,
      bodyMd,
    });
    process.stdout.write(
      JSON.stringify(
        {
          success: true,
          published: {
            id: doc.id,
            kind: doc.kind,
            version: doc.version,
            effective_at: doc.effective_at,
            content_sha256: doc.content_sha256,
            is_current: doc.is_current,
          },
        },
        null,
        2
      ) + '\n'
    );
    process.exit(0);
  } catch (err) {
    process.stderr.write(`Publish failed: ${err.message}\n`);
    if (err.stack) process.stderr.write(err.stack + '\n');
    process.exit(1);
  }
})();
