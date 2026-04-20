'use strict';

/**
 * Adapter over the financial-kernel's pure HTTP handler
 * `handleInvestorPackage`. Loaded lazily so a missing dist/ directory
 * never breaks existing routes.
 *
 * The Express layer passes the validated body through unchanged. Any
 * monitoring / snapshot persistence happens inside the route handler
 * so this shim stays thin and infra-agnostic.
 */

let _cached = null;

const loadHandler = () => {
  if (_cached) return _cached;
  try {
    const mod = require('../../../packages/financial-kernel/dist/api');
    if (!mod || typeof mod.handleInvestorPackage !== 'function') {
      throw new Error('handleInvestorPackage export missing from kernel/dist/api');
    }
    _cached = mod.handleInvestorPackage;
  } catch (err) {
    const msg = 'packages/financial-kernel/dist is not built or missing /api export. ' +
                'Run `npx tsc -p packages/financial-kernel/tsconfig.build.json` and redeploy.';
    throw new Error(`${msg} (underlying: ${err.message})`);
  }
  return _cached;
};

const computeInvestorPackage = async (input, env = process.env) => {
  const handle = loadHandler();
  return handle(input, env);
};

module.exports = { computeInvestorPackage };
