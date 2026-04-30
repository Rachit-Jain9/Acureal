#!/usr/bin/env node
'use strict';

// CI-safe lint for database/migrations/*.sql files.
//
// Catches mistakes that would otherwise only surface when the operator runs
// the migration:
//   - Filenames must follow YYYYMMDD_*.sql so chronological ordering matches
//     filesystem ordering and Supabase migration history.
//   - No two files may share the same YYYYMMDD prefix without distinct
//     descriptors — duplicate prefixes create ambiguous apply order.
//   - CREATE INDEX CONCURRENTLY is forbidden because Supabase SQL editor
//     auto-wraps every paste in a transaction (see PR #80 for the incident).
//   - Files must not be empty.
//
// Exit code 0 = clean, exit code 1 = lint failures (with details printed).

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'database', 'migrations');
const FILENAME_RE = /^\d{8}_[a-z0-9_]+\.sql$/;

function lintFile(name, contents) {
  const issues = [];

  if (!FILENAME_RE.test(name)) {
    issues.push(`filename does not match YYYYMMDD_<snake_case>.sql convention`);
  }

  if (!contents.trim()) {
    issues.push(`file is empty`);
  }

  if (/CREATE\s+INDEX\s+CONCURRENTLY/i.test(contents)) {
    issues.push(
      `uses CREATE INDEX CONCURRENTLY — fails inside Supabase SQL editor's auto-transaction. Use plain CREATE INDEX wrapped in BEGIN/COMMIT instead.`,
    );
  }

  return issues;
}

function main() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.log('[lint-migrations] no database/migrations/ directory — nothing to lint.');
    return 0;
  }

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('[lint-migrations] no migration files found.');
    return 0;
  }

  let failures = 0;
  const dateBuckets = new Map();

  for (const name of files) {
    const fullPath = path.join(MIGRATIONS_DIR, name);
    const contents = fs.readFileSync(fullPath, 'utf8');
    const issues = lintFile(name, contents);

    const datePrefix = name.slice(0, 8);
    if (FILENAME_RE.test(name)) {
      const bucket = dateBuckets.get(datePrefix) || [];
      bucket.push(name);
      dateBuckets.set(datePrefix, bucket);
    }

    if (issues.length > 0) {
      failures += issues.length;
      console.error(`✗ ${name}`);
      for (const issue of issues) {
        console.error(`    - ${issue}`);
      }
    }
  }

  for (const [prefix, names] of dateBuckets) {
    if (names.length > 1) {
      const distinctSuffixes = new Set(names.map((n) => n.slice(8)));
      if (distinctSuffixes.size !== names.length) {
        failures += 1;
        console.error(`✗ duplicate filenames at date ${prefix}: ${names.join(', ')}`);
      }
    }
  }

  if (failures === 0) {
    console.log(`[lint-migrations] ${files.length} migration${files.length === 1 ? '' : 's'} clean.`);
    return 0;
  }

  console.error(`\n[lint-migrations] ${failures} issue${failures === 1 ? '' : 's'} across ${files.length} migrations.`);
  return 1;
}

process.exit(main());
