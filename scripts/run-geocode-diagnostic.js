#!/usr/bin/env node
// scripts/run-geocode-diagnostic.js
//
// Operator-side diagnostic: runs the same `geocodeDiagnostic()` helper
// that powers GET /api/properties/geocode-diagnostic, locally, against
// whatever address you pass on the CLI. Useful when you can't (or
// don't want to) generate a Bearer token for the HTTP endpoint —
// the diagnostic logic itself only needs `GOOGLE_MAPS_API_KEY` in
// env, which loads from backend/.env.local automatically.
//
// Usage:
//   node scripts/run-geocode-diagnostic.js "Thyme Park Apartments Jigani"
//   node scripts/run-geocode-diagnostic.js "100 Brigade Road Bengaluru"
//   node scripts/run-geocode-diagnostic.js "address" "City" "State" "pincode"

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

// Load env from backend/.env.local + backend/.env (BOM-safe).
const loadEnv = (file) => {
  const p = path.join(__dirname, '..', 'backend', file);
  if (!fs.existsSync(p)) return;
  const raw = fs.readFileSync(p, 'utf-8').replace(/^﻿/, '');
  for (const [k, v] of Object.entries(dotenv.parse(raw))) {
    if (!(k in process.env)) process.env[k] = v;
  }
};
loadEnv('.env.local');
loadEnv('.env');

const { geocodeDiagnostic } = require('../backend/src/utils/geocode');

const [address, city = 'Bengaluru', state = 'Karnataka', pincode = null] = process.argv.slice(2);
if (!address) {
  console.error('Usage: node scripts/run-geocode-diagnostic.js "<address>" [city] [state] [pincode]');
  process.exit(1);
}

(async () => {
  const diag = await geocodeDiagnostic(address, city, state, pincode);
  console.log(JSON.stringify(diag, null, 2));
})().catch((err) => {
  console.error('Diagnostic failed:', err);
  process.exit(1);
});
