'use strict';

/**
 * Lazy accessor for pdf-lib — keeps a ~365ms require() off the serverless
 * cold-start path.
 *
 * pdf-lib was previously required at module top-level by four boot-reachable
 * files (export routes, both tear-sheet builders, the AI PDF preflight), so
 * EVERY cold start paid to load it — even auth pings that never touch a PDF.
 * This shim defers the cost to the first actual PDF build:
 *
 *   pdfLib()          — the real module, cached after the first call.
 *   rgb(r, g, b)      — call-time wrapper for function-scope color literals.
 *   lazyByFactory(f)  — Proxy that materializes an object on FIRST property
 *                       access. Built for the module-scope COLORS palettes:
 *                       `const COLORS = lazyByFactory(({ rgb }) => ({...}))`
 *                       keeps every `COLORS.navy` call site unchanged while
 *                       eliminating the boot-time rgb() evaluation.
 *   A4_PORTRAIT / A4_LANDSCAPE — ISO 216 A4 in PDF points; physical constants
 *                       identical to pdf-lib's PageSizes.A4 (595.28 × 841.89),
 *                       exported so page geometry can be declared without
 *                       touching the library at module scope.
 */

const A4_PORTRAIT = Object.freeze([595.28, 841.89]);
const A4_LANDSCAPE = Object.freeze([841.89, 595.28]);

let _mod = null;
const pdfLib = () => _mod || (_mod = require('pdf-lib'));

const rgb = (r, g, b) => pdfLib().rgb(r, g, b);

const lazyByFactory = (factory) => {
  let real = null;
  const materialize = () => {
    if (real === null) real = factory(pdfLib());
    return real;
  };
  return new Proxy({}, {
    get: (_t, prop) => materialize()[prop],
    has: (_t, prop) => prop in materialize(),
    ownKeys: () => Reflect.ownKeys(materialize()),
    getOwnPropertyDescriptor: (_t, prop) =>
      Object.getOwnPropertyDescriptor(materialize(), prop),
  });
};

module.exports = { pdfLib, rgb, lazyByFactory, A4_PORTRAIT, A4_LANDSCAPE };
