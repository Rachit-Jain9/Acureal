/**
 * Adapter for the canonical debt engine (@redip/financial-kernel/debt-engine).
 *
 * The debt engine is always on. A single operator kill-switch
 * (`DEBT_ENGINE_KILL=1`, legacy `DEBT_ENGINE_V2_KILL=1` still honored)
 * short-circuits every call to a null overlay so deal pages survive an
 * incident without crashing.
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
      'debt.adapter: packages/financial-kernel/dist is not built. ' +
      'Run `npx tsc -p packages/financial-kernel/tsconfig.build.json` and redeploy. ' +
      `(underlying: ${err.message})`,
    );
  }
  return _kernel;
};

/**
 * True only when an operator has explicitly engaged the kill-switch.
 * Accepts both the current name and the legacy `_V2_` name so operators
 * with stale env vars don't lose their escape hatch on upgrade.
 */
const isKillSwitchOn = () => {
  const raw = String(
    process.env.DEBT_ENGINE_KILL ?? process.env.DEBT_ENGINE_V2_KILL ?? '',
  ).trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'on' || raw === 'yes' || raw === 'enabled';
};

/**
 * Run the debt engine for a spec set. Returns `null` when the
 * kill-switch is engaged, when there are no specs to roll forward, or
 * when the kernel errors (so callers degrade gracefully without
 * breaking the save path).
 */
const runDebtEngine = (specs, options) => {
  if (isKillSwitchOn()) return null;
  if (!Array.isArray(specs) || specs.length === 0) return null;
  try {
    const { DebtEngine } = loadKernel();
    return DebtEngine.rollForwardFacilities(specs, options);
  } catch (err) {
    console.warn(`[debt.adapter] rollForwardFacilities failed, degrading to null overlay: ${err.message}`);
    return null;
  }
};

module.exports = {
  isKillSwitchOn,
  runDebtEngine,
};
