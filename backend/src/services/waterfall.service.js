'use strict';

const { query } = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { calculateJDA, calculateJV, buildDebtSchedule } = require('../engines/waterfall.engine');
const { buildVisibleDealCondition } = require('../utils/dealVisibility');

async function assertDealWritable(dealId) {
  const dealResult = await query(
    'SELECT id, is_archived, stage FROM deals WHERE id = $1 AND organization_id = current_organization_id()',
    [dealId]
  );
  if (dealResult.rows.length === 0) throw createError('Deal not found.', 404);
  const row = dealResult.rows[0];
  if (row.is_archived) throw createError('Restore this deal before editing waterfall.', 409);
  if (row.stage === 'dead') throw createError('Waterfall cannot be saved to a dead deal.', 409);
  return row;
}

async function assertDealReadable(dealId) {
  const result = await query(
    `SELECT d.id FROM deals d WHERE d.id = $1 AND ${buildVisibleDealCondition('d')}`,
    [dealId]
  );
  if (result.rows.length === 0) throw createError('Deal not found.', 404);
}

// ── JDA ────────────────────────────────────────────────────────────────────────

async function calculateAndSaveJDA(dealId, inputParams) {
  await assertDealWritable(dealId);
  const result = calculateJDA(inputParams);
  if (!result) throw createError('Invalid JDA inputs: totalRevenueCr and landownerSharePct are required.', 422);

  await query(
    `INSERT INTO waterfall_distributions (deal_id, kind, inputs, result)
     VALUES ($1, 'jda', $2, $3)
     ON CONFLICT (deal_id, kind)
     DO UPDATE SET inputs = EXCLUDED.inputs, result = EXCLUDED.result, updated_at = NOW()`,
    [dealId, JSON.stringify(inputParams || {}), JSON.stringify(result)]
  );
  return result;
}

// ── JV ─────────────────────────────────────────────────────────────────────────

async function calculateAndSaveJV(dealId, inputParams) {
  await assertDealWritable(dealId);
  const result = calculateJV(inputParams);
  if (!result) throw createError('Invalid JV inputs: totalRevenueCr, totalCostCr, and equity contributions are required.', 422);

  await query(
    `INSERT INTO waterfall_distributions (deal_id, kind, inputs, result)
     VALUES ($1, 'jv', $2, $3)
     ON CONFLICT (deal_id, kind)
     DO UPDATE SET inputs = EXCLUDED.inputs, result = EXCLUDED.result, updated_at = NOW()`,
    [dealId, JSON.stringify(inputParams || {}), JSON.stringify(result)]
  );
  return result;
}

// ── Debt Schedule ──────────────────────────────────────────────────────────────

function calculateDebtSchedule(inputParams) {
  const result = buildDebtSchedule(inputParams);
  if (!result) throw createError('Invalid debt schedule inputs: debtDrawnCr, debtRatePct, and projectDurationMonths are required.', 422);
  return result;
}

// ── Read ───────────────────────────────────────────────────────────────────────

async function getWaterfall(dealId, kind) {
  await assertDealReadable(dealId);
  if (kind && !['jda', 'jv'].includes(kind)) {
    throw createError('kind must be either "jda" or "jv".', 400);
  }
  const sql = kind
    ? 'SELECT kind, inputs, result, created_at, updated_at FROM waterfall_distributions WHERE deal_id = $1 AND kind = $2'
    : 'SELECT kind, inputs, result, created_at, updated_at FROM waterfall_distributions WHERE deal_id = $1';
  const args = kind ? [dealId, kind] : [dealId];
  const result = await query(sql, args);
  return result.rows;
}

module.exports = {
  calculateAndSaveJDA,
  calculateAndSaveJV,
  calculateDebtSchedule,
  getWaterfall,
};
