/**
 * Adapter for the Phase 2 debt engine (@redip/financial-kernel/debt-engine).
 *
 * Gated by `DEBT_ENGINE_V2`. Off by default; legacy debt/DSCR math in
 * `financial.engine.js` stays authoritative until reconciliation on
 * representative deals clears the flag for production use.
 *
 * This adapter never mutates legacy outputs directly — the consuming
 * service chooses whether to overlay or merge the returned facility
 * schedule and covenant results.
 */

'use strict';

let _kernel = null;

const loadKernel = () => {
  if (_kernel) return _kernel;
  try {
    _kernel = require('../../../packages/financial-kernel/dist');
  } catch (err) {
    throw new Error(
      'DEBT_ENGINE_V2 is enabled but packages/financial-kernel/dist is not built. ' +
      `Run the kernel build and redeploy. (underlying: ${err.message})`,
    );
  }
  return _kernel;
};

/**
 * Off by default. Turn on by setting DEBT_ENGINE_V2=true in the
 * environment. Any truthy form ('1', 'on', 'true') enables the engine.
 */
const isDebtV2Enabled = () => {
  const v = String(process.env.DEBT_ENGINE_V2 || '').toLowerCase();
  return v === 'true' || v === '1' || v === 'on' || v === 'yes';
};

/**
 * Run the debt engine for a spec set. Returns `null` when disabled or
 * when the kernel cannot be loaded (so callers fall through to legacy).
 */
const runDebtEngine = (specs, options) => {
  if (!isDebtV2Enabled()) return null;
  if (!Array.isArray(specs) || specs.length === 0) return null;
  try {
    const { DebtEngine } = loadKernel();
    return DebtEngine.rollForwardFacilities(specs, options);
  } catch (err) {
    console.warn(`[debt.adapter] rollForwardFacilities failed, falling back to legacy: ${err.message}`);
    return null;
  }
};

module.exports = {
  isDebtV2Enabled,
  runDebtEngine,
};
