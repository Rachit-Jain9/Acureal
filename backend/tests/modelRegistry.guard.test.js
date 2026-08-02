'use strict';

/**
 * Guard: no model-name literal may select a model outside providerRegistry.
 *
 * The failure this prevents actually happened. `aiRouter.resolveDefaultModel`
 * carried its own copy of the Gemini default; the registry moved to a newer
 * model on 2026-05-15 and the duplicate kept shipping 'gemini-3-flash-preview'.
 * Google retired that preview around 2026-07-01 and every routed Gemini call
 * 404'd for roughly a week — ~1,500 error rows — while the registry looked
 * correct to anyone reading it. The comment above that function has said
 * "never duplicate model names outside the registry again" ever since; this
 * test is what makes that sentence true instead of aspirational.
 *
 * SCOPE — deliberately the live selection path, not every occurrence.
 * A literal is dangerous when it DECIDES which model an API call uses, because
 * a retired name there is a 404 in production. The same string in a comment, in
 * the cost table (which must enumerate historical models to price them), or in
 * an inert display label carries no such risk, and failing the build on those
 * would push future authors toward risky refactors for no safety gain.
 */

const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'src');

// Any provider's model-name shape, as a single-quoted JS string literal.
const MODEL_LITERAL = /'(gemini-[a-z0-9.\-]+|gpt-[a-z0-9.\-]+|claude-[a-z0-9.\-]+|text-embedding-[a-z0-9.\-]+)'/g;

// The one file allowed to name models: the single source of truth.
const REGISTRY = path.join('services', 'ai', 'providerRegistry.js');

// The cost table must enumerate every model Acureal has ever billed, including
// retired ones — an unpriced model silently escapes the daily spend cap.
const COST_TABLE_FILE = path.join('services', 'ai', 'aiRouter.js');

// Inert display labels. Verified 2026-08-02: the sole consumer of
// `insights.provider` is `exports/pptx/slides.js`, which passes it to
// `renderAiDisclosureBanner` — a no-op, because operator policy forbids naming
// AI providers anywhere in a deck. These strings are never sent to a provider
// SDK, so a retired name here cannot 404. They are allowlisted rather than
// "fixed" so nobody refactors a live AI call path to satisfy a linter. Removing
// the dead plumbing outright is worth doing, separately.
const INERT_LABEL_FILES = new Set([
  path.join('services', 'export.insights.service.js'),
  path.join('services', 'exports', 'xlsx', 'v2', 'dealBriefing.service.js'),
]);

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const full = path.join(dir, e.name);
  if (e.isDirectory()) return walk(full);
  return e.isFile() && e.name.endsWith('.js') ? [full] : [];
});

// Strip comments so an incident note naming the retired model does not trip the
// guard that exists because of that incident.
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('model names live only in providerRegistry', () => {
  const offenders = [];

  for (const file of walk(SRC)) {
    const rel = path.relative(SRC, file);
    if (rel === REGISTRY || rel === COST_TABLE_FILE || INERT_LABEL_FILES.has(rel)) continue;

    const code = stripComments(fs.readFileSync(file, 'utf8'));
    for (const m of code.matchAll(MODEL_LITERAL)) {
      offenders.push(`${rel}: ${m[0]}`);
    }
  }

  test('no service selects a model with its own literal', () => {
    expect(offenders).toEqual([]);
  });

  // A guard that cannot fail is decoration. These pin the detector itself, so
  // an over-eager regex tweak that quietly stops matching gets caught here
  // rather than the next time a model is retired.
  test.each([
    "const m = 'gemini-3-flash-preview';",
    "model: 'gpt-4o',",
    "model = 'claude-sonnet-4-6'",
    "'text-embedding-3-small'",
  ])('detects a planted literal: %s', (planted) => {
    expect([...stripComments(planted).matchAll(MODEL_LITERAL)]).toHaveLength(1);
  });

  test('does not fire on a model name inside a comment', () => {
    const commented = "// we used to ship 'gemini-3-flash-preview' here\nconst x = 1;";
    expect([...stripComments(commented).matchAll(MODEL_LITERAL)]).toHaveLength(0);
  });

  test('does not fire on unrelated hyphenated strings', () => {
    const benign = "const a = 'gpt-like'; const b = 'claude'; const c = 'text-embedding';";
    // Bare provider words and truncated prefixes are not model identifiers.
    expect([...stripComments(benign).matchAll(MODEL_LITERAL)].map((m) => m[0])).toEqual(["'gpt-like'"]);
  });
});

describe('the registry exports every default it owns', () => {
  const registry = require('../src/services/ai/providerRegistry');

  test.each([
    'DEFAULT_GEMINI_MODEL',
    'DEFAULT_CLAUDE_MODEL',
    'DEFAULT_OPENAI_MODEL',
    'DEFAULT_OPENAI_EMBEDDING_MODEL',
    'ROUTED_OPENAI_MODEL',
  ])('%s is exported and non-empty', (name) => {
    expect(typeof registry[name]).toBe('string');
    expect(registry[name].length).toBeGreaterThan(0);
  });

  test('the routed OpenAI default is deliberately distinct from the direct default', () => {
    // Not a typo: routed calls stay on the prod-proven model until the operator
    // ratifies the newer one on the live path. If these ever converge it must be
    // an explicit decision — this assertion is here so that decision is visible
    // in a diff rather than absorbed silently.
    expect(registry.ROUTED_OPENAI_MODEL).not.toBe(registry.DEFAULT_OPENAI_MODEL);
  });
});

describe('the router delegates instead of duplicating', () => {
  const registry = require('../src/services/ai/providerRegistry');
  const { resolveDefaultModel } = require('../src/services/ai/aiRouter');

  const withEnv = (vars, fn) => {
    const saved = {};
    for (const [k, v] of Object.entries(vars)) { saved[k] = process.env[k]; delete process.env[k]; if (v !== undefined) process.env[k] = v; }
    try { return fn(); } finally {
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  };

  test.each([
    ['gemini', 'DEFAULT_GEMINI_MODEL'],
    ['claude', 'DEFAULT_CLAUDE_MODEL'],
    ['openai', 'ROUTED_OPENAI_MODEL'],
  ])('%s resolves to the registry constant', (provider, constant) => {
    const resolved = withEnv(
      { GEMINI_MODEL: undefined, CLAUDE_MODEL: undefined, OPENAI_MODEL: undefined },
      () => resolveDefaultModel(provider),
    );
    expect(resolved).toBe(registry[constant]);
  });

  test('an operator env override still wins for every provider', () => {
    expect(withEnv({ GEMINI_MODEL: 'gemini-x' }, () => resolveDefaultModel('gemini'))).toBe('gemini-x');
    expect(withEnv({ CLAUDE_MODEL: 'claude-x' }, () => resolveDefaultModel('claude'))).toBe('claude-x');
    expect(withEnv({ OPENAI_MODEL: 'gpt-x' }, () => resolveDefaultModel('openai'))).toBe('gpt-x');
  });

  test('an unknown provider never invents a model name', () => {
    expect(resolveDefaultModel('nope')).toBe('unknown');
  });
});

describe('every registry default is priced', () => {
  // An unpriced provider:model is estimated at the most expensive known rate,
  // which keeps the daily cap honest but distorts per-feature cost reporting.
  const registry = require('../src/services/ai/providerRegistry');
  const source = fs.readFileSync(path.join(SRC, COST_TABLE_FILE), 'utf8');

  test.each([
    ['gemini', 'DEFAULT_GEMINI_MODEL'],
    ['claude', 'DEFAULT_CLAUDE_MODEL'],
    ['openai', 'DEFAULT_OPENAI_MODEL'],
    ['openai', 'ROUTED_OPENAI_MODEL'],
    ['openai', 'DEFAULT_OPENAI_EMBEDDING_MODEL'],
  ])('%s:%s has a row in the cost table', (provider, constant) => {
    expect(source).toContain(`'${provider}:${registry[constant]}'`);
  });
});
