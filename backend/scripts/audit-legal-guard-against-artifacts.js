'use strict';

/**
 * Run the legal-four prose guard against REAL production text.
 *
 * WHY THIS SCRIPT EXISTS. Twice now the guard has shipped with a hole its own
 * test suite could not see:
 *
 *   #1100 (2026-08-07) — the adjective `required` in INSTRUCTION_LEAD waved
 *   "All required approvals have been received" through into four live IC
 *   memos on deals with ZERO approval rows.
 *
 *   2026-08-08 — the rules matched "Title is clear" and missed "Title in this
 *   belt is generally clean", "Titles in this micro-market are typically
 *   clean", and "The land has a clear title".
 *
 * Both were found by reading real output, not by adding tests. A guard's own
 * tests are written from the same mental model as the guard, so they inherit
 * its blind spots by construction. The only external check available is the
 * corpus the product has actually produced.
 *
 * WHAT IT DOES.
 *   - Pulls every `ai_artifacts` row (content_md + every string leaf of
 *     content_jsonb — the market-context sections land in jsonb).
 *   - Splits it the same way `aiLegalProseGuard` does and reports each sentence
 *     the CURRENT working-tree vocabulary would redact, with rule id and lane.
 *   - With `--baseline <git-ref>`, loads the vocabulary as committed at that
 *     ref and diffs: NEWLY REDACTED (candidate false positives — read every
 *     one) and NO LONGER REDACTED (candidate regressions).
 *
 * READ-ONLY. One SELECT, no writes, no DDL.
 *
 * THE `ai_artifacts` CORPUS ALONE IS NOT ENOUGH, and it is important to say so
 * rather than read a clean diff as a clean bill of health. Stored artifacts are
 * sanitised on write AND on read, so by construction they contain almost no
 * statutory verdicts — a widening that over-redacts would barely register.
 * `--corpus` therefore sweeps the repo's own UNGUARDED domain prose instead
 * (docs, TODO_LEGAL, DD/approval seed text, prompt templates, product-guide
 * copy). That text is exactly the diligence register the guard must never
 * touch, so a hit there is a false positive worth reading closely.
 *
 * Usage:
 *   node scripts/audit-legal-guard-against-artifacts.js
 *   node scripts/audit-legal-guard-against-artifacts.js --baseline origin/master
 *   node scripts/audit-legal-guard-against-artifacts.js --baseline HEAD --limit 200
 *   node scripts/audit-legal-guard-against-artifacts.js --corpus --baseline HEAD
 */

require('../src/config/loadEnv');

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Client } = require('pg');
const { normalizeDatabaseUrl } = require('../src/config/databaseUrl');

const VOCAB_REL_PATH = 'backend/src/utils/legalVerdictVocabulary.js';

const argOf = (flag, fallback = null) => {
  const i = process.argv.indexOf(flag);
  return i === -1 || i === process.argv.length - 1 ? fallback : process.argv[i + 1];
};

const baselineRef = argOf('--baseline');
const rowLimit = Number(argOf('--limit', '500')) || 500;

// Same split as aiLegalProseGuard.splitSentences — the guard scrubs per
// sentence, so the audit must attribute per sentence or the diff is unreadable.
const splitSentences = (text) => text.match(/[^.!?\n]*(?:[.!?]+|\n+|$)/g)?.filter((s) => s.length) || [text];

/** Load the vocabulary module as committed at `ref` (null → working tree). */
const loadVocabulary = (ref) => {
  if (!ref) return require('../src/utils/legalVerdictVocabulary');
  const repoRoot = path.resolve(__dirname, '..', '..');
  const source = execFileSync('git', ['show', `${ref}:${VOCAB_REL_PATH}`], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  // The module is deliberately dependency-free, so a bare temp file is enough.
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'legalvocab-')), 'baseline.js');
  fs.writeFileSync(tmp, source);
  // eslint-disable-next-line global-require, import/no-dynamic-require
  return require(tmp);
};

/** Every string leaf of a jsonb value, so nested section prose is not missed. */
const stringLeaves = (value, out = []) => {
  if (typeof value === 'string') {
    if (value.trim().length > 0) out.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((v) => stringLeaves(v, out));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((v) => stringLeaves(v, out));
  }
  return out;
};

const scan = (vocab, blocks) => {
  const hits = new Map(); // sentence → { id, lane, matched, source }
  for (const { source, text } of blocks) {
    for (const raw of splitSentences(text)) {
      const sentence = raw.trim();
      if (!sentence) continue;
      const found = vocab.findLegalAssertion(sentence);
      if (found && !hits.has(sentence)) hits.set(sentence, { ...found, source });
    }
  }
  return hits;
};

const report = (title, entries) => {
  console.log(`\n${title} — ${entries.length}`);
  if (entries.length === 0) {
    console.log('  (none)');
    return;
  }
  for (const [sentence, meta] of entries) {
    console.log(`  [${meta.lane}/${meta.id}] ${meta.source}`);
    console.log(`      ${sentence}`);
    console.log(`      matched: "${meta.matched}"`);
  }
};

// Repo prose that is written by humans, never passes through the guard, and
// sits squarely in the diligence register the guard must leave alone.
const CORPUS_GLOBS = [
  'docs',
  'backend/src/services/exports/narrative',
  'backend/src/constants',
  'backend/src/services/ai',
  'frontend/src/utils',
  'TODO_LEGAL.md',
  'TODO_MANUAL.md',
  'TODO_DATA.md',
  'CLAUDE.md',
];

const CORPUS_EXTENSIONS = new Set(['.md', '.js', '.jsx', '.txt']);

const walk = (target, out = []) => {
  if (!fs.existsSync(target)) return out;
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    if (CORPUS_EXTENSIONS.has(path.extname(target))) out.push(target);
    return out;
  }
  for (const entry of fs.readdirSync(target)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    walk(path.join(target, entry), out);
  }
  return out;
};

const readCorpusBlocks = () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const blocks = [];
  for (const rel of CORPUS_GLOBS) {
    for (const file of walk(path.join(repoRoot, rel))) {
      blocks.push({
        source: path.relative(repoRoot, file).replace(/\\/g, '/'),
        text: fs.readFileSync(file, 'utf8'),
      });
    }
  }
  return blocks;
};

async function run() {
  if (process.argv.includes('--corpus')) {
    const blocks = readCorpusBlocks();
    const words = blocks.reduce((n, b) => n + b.text.split(/\s+/).length, 0);
    console.log(`Scanning ${blocks.length} repo prose file(s), ~${words} words (unguarded human text).`);

    const current = scan(loadVocabulary(null), blocks);
    console.log(`\nCurrent working tree redacts ${current.size} distinct sentence(s).`);
    if (!baselineRef) {
      report('REDACTED', [...current.entries()]);
      return;
    }
    const baseline = scan(loadVocabulary(baselineRef), blocks);
    console.log(`Baseline (${baselineRef}) redacts ${baseline.size} distinct sentence(s).`);
    report(
      'NEWLY REDACTED (read every one — a legitimate sentence here is a false positive to fix)',
      [...current.entries()].filter(([s]) => !baseline.has(s)),
    );
    report(
      'NO LONGER REDACTED (a real verdict here is a regression)',
      [...baseline.entries()].filter(([s]) => !current.has(s)),
    );
    return;
  }

  const databaseUrl = normalizeDatabaseUrl(process.env.DATABASE_URL);
  if (!databaseUrl) {
    console.error('[REDIP] DATABASE_URL is not set. Configure backend/.env before running this audit.');
    process.exit(1);
  }

  const client = new Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  let blocks = [];
  try {
    await client.connect();
    const { rows } = await client.query(
      `SELECT id, deal_id, artifact_type, status, content_md, content_jsonb, generated_at
         FROM public.ai_artifacts
        ORDER BY generated_at DESC
        LIMIT $1`,
      [rowLimit],
    );
    console.log(`Read ${rows.length} ai_artifacts row(s).`);
    for (const row of rows) {
      const label = `${row.artifact_type}/${String(row.id).slice(0, 8)} (${row.status})`;
      if (typeof row.content_md === 'string' && row.content_md.trim()) {
        blocks.push({ source: `${label} content_md`, text: row.content_md });
      }
      for (const [i, leaf] of stringLeaves(row.content_jsonb).entries()) {
        blocks.push({ source: `${label} jsonb[${i}]`, text: leaf });
      }
    }
  } catch (error) {
    console.error('Failed to read ai_artifacts.');
    console.error(error.message || error.code || error);
    process.exitCode = 1;
    return;
  } finally {
    await client.end().catch(() => {});
  }

  const words = blocks.reduce((n, b) => n + b.text.split(/\s+/).length, 0);
  console.log(`Scanning ${blocks.length} prose block(s), ~${words} words.`);

  const current = scan(loadVocabulary(null), blocks);
  console.log(`\nCurrent working tree redacts ${current.size} distinct sentence(s).`);

  if (!baselineRef) {
    report('REDACTED', [...current.entries()]);
    return;
  }

  const baseline = scan(loadVocabulary(baselineRef), blocks);
  console.log(`Baseline (${baselineRef}) redacts ${baseline.size} distinct sentence(s).`);

  const added = [...current.entries()].filter(([s]) => !baseline.has(s));
  const dropped = [...baseline.entries()].filter(([s]) => !current.has(s));

  report('NEWLY REDACTED (read every one — a legitimate sentence here is a false positive to fix)', added);
  report('NO LONGER REDACTED (a real verdict here is a regression)', dropped);
}

run();
