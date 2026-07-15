const { query, transaction } = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const {
  computeFullFinancials,
  computeScenarios,
} = require('../engines/kernel.service');
const { buildVisibleDealCondition } = require('../utils/dealVisibility');
const {
  resolveFinancialModelClass,
  FINANCIAL_MODEL_LABEL_BY_ASSET_CLASS,
} = require('../constants/assetClasses');
const auditService = require('./audit.service');
const dealAuditLog = require('./dealAuditLog.service');
const { reconcileRentRollProvenance } = require('../utils/rentRollPrefill');

// ─── SCENARIO PERSISTENCE ────────────────────────────────────────────────────

const SCENARIO_MULTIPLIERS = {
  base: { revenue: 1.00, cost: 1.00, duration: 1.00 },
  bull: { revenue: 1.10, cost: 0.95, duration: 0.90 },
  bear: { revenue: 0.88, cost: 1.10, duration: 1.20 },
};

const persistScenarios = async (dealId, scenarios, exec = query) => {
  if (!scenarios || typeof scenarios !== 'object') return;

  // Collect every scenario row, then write them in ONE multi-row upsert instead
  // of a serial INSERT per scenario. On a high-latency serverless→Supabase hop,
  // this turns N round-trips into 1 (latency = one round-trip, not the sum).
  const rows = [];
  for (const key of Object.keys(SCENARIO_MULTIPLIERS)) {
    const s = scenarios[key];
    if (!s) continue;
    const kpis = s.kpis || {};
    const rev  = s.revenue || {};
    const m    = SCENARIO_MULTIPLIERS[key];
    rows.push([
      key,
      s.label || null,
      m.revenue,
      m.cost,
      m.duration,
      kpis.irr ?? null,
      kpis.npv ?? null,
      kpis.equityMultiple ?? null,
      kpis.grossMarginPct ?? rev.grossMarginPct ?? null,
      rev.totalRevenueCr ?? null,
      rev.totalCostCr ?? null,
      JSON.stringify(kpis),
      JSON.stringify(s.adjustments || {}),
    ]);
  }
  if (rows.length === 0) return;

  // $1 is the shared dealId (also drives the org subquery); each scenario then
  // contributes 13 positional params. Scenarios are keyed distinctly, so no two
  // rows collide on (deal_id, scenario) within the batch.
  const params = [dealId];
  const valueGroups = rows.map((row) => {
    const start = params.length;
    params.push(...row);
    const ph = row.map((_, j) => `$${start + 1 + j}`).join(', ');
    return `($1, (SELECT organization_id FROM deals WHERE id = $1), ${ph})`;
  });

  await exec(
    `INSERT INTO financial_scenarios (
       deal_id, organization_id, scenario, label,
       revenue_multiplier, cost_multiplier, duration_multiplier,
       irr_pct, npv_cr, equity_multiple, gross_margin_pct,
       total_revenue_cr, total_cost_cr,
       kpis, inputs
     ) VALUES ${valueGroups.join(', ')}
     ON CONFLICT (deal_id, scenario) DO UPDATE SET
       label = EXCLUDED.label,
       revenue_multiplier = EXCLUDED.revenue_multiplier,
       cost_multiplier = EXCLUDED.cost_multiplier,
       duration_multiplier = EXCLUDED.duration_multiplier,
       irr_pct = EXCLUDED.irr_pct,
       npv_cr = EXCLUDED.npv_cr,
       equity_multiple = EXCLUDED.equity_multiple,
       gross_margin_pct = EXCLUDED.gross_margin_pct,
       total_revenue_cr = EXCLUDED.total_revenue_cr,
       total_cost_cr = EXCLUDED.total_cost_cr,
       kpis = EXCLUDED.kpis,
       inputs = EXCLUDED.inputs,
       updated_at = NOW()`,
    params,
  );
};

// ─── CALCULATE AND SAVE ───────────────────────────────────────────────────────

const calculateAndSave = async (dealId, inputData, options = {}) => {
  const { actorId = null } = options;
  const dealResult = await query(
    'SELECT id, is_archived, stage FROM deals WHERE id = $1 AND organization_id = current_organization_id()',
    [dealId]
  );
  if (dealResult.rows.length === 0) throw createError('Deal not found.', 404);
  const dealRow = dealResult.rows[0];
  if (dealRow.is_archived) throw createError('Restore this deal before recalculating financials.', 409);
  if (dealRow.stage === 'dead') throw createError('Financial models cannot be saved to a dead deal.', 409);

  // Register-seeding provenance rides ALONGSIDE the inputs, never through the
  // kernel: strip it before normalization so no metadata reaches the math,
  // persist it in model_params so exports and staleness checks can cite which
  // rent-roll snapshot seeded the assumptions.
  const { rentRollProvenance = null, ...kernelInputData } = inputData;

  const selectedAssetClass = kernelInputData.assetClass || 'residential_apartments';
  const modelAssetClass = resolveFinancialModelClass(selectedAssetClass);
  const normalizedInput = {
    ...kernelInputData,
    assetClass: modelAssetClass,
  };

  const computed   = computeFullFinancials(normalizedInput);
  const scenarios  = computeScenarios(normalizedInput);
  const assetClass = selectedAssetClass;
  const leg        = computed._legacy || {};
  const kpis       = computed.kpis    || {};
  const costs      = computed.costs   || {};
  const areas      = computed.areas   || {};

  // Provenance reconciliation: a seeded Calculate cites its snapshot; a
  // manual recalculate carries the prior citation forward ONLY while every
  // accepted field still holds its accepted value (hand-editing a seeded
  // assumption breaks traceability — the citation is dropped, never left
  // dangling on a model it no longer describes). The lookup is FAIL-OPEN:
  // a citation is WARN-grade metadata and must never block a model save —
  // on any read failure the carry-forward is simply skipped.
  let previousProvenance = null;
  try {
    const prevProvenanceRes = await query(
      `SELECT model_params FROM financials
        WHERE deal_id = $1 AND organization_id = current_organization_id()`,
      [dealId],
    );
    previousProvenance = prevProvenanceRes?.rows?.[0]?.model_params?.rentRollProvenance || null;
  } catch {
    previousProvenance = null;
  }
  const resolvedProvenance = reconcileRentRollProvenance(
    previousProvenance, rentRollProvenance, computed.inputs || {},
  );

  // Store everything including scenarios in model_params (no separate column needed)
  const modelParams = JSON.stringify({
    inputs:       computed.inputs,
    selectedAssetClass,
    financialModelClass: modelAssetClass,
    financialModelLabel: FINANCIAL_MODEL_LABEL_BY_ASSET_CLASS[selectedAssetClass] || 'Residential Apartments',
    kpis,
    areas,
    costs,
    revenue:      computed.revenue,
    capitalStack: computed.capitalStack,
    proforma:     computed.proforma,   // quarter × category sources/uses waterfall
    scenarios,    // embedded — no scenarios_data column needed
    // Audit trail: engine version + computation timestamp. Investor-grade
    // reports can cite this alongside the deal's commit hash to prove which
    // kernel + input set produced the saved numbers.
    engineVersion: computed.engineVersion || 'kernel-v2',
    computedAt: new Date().toISOString(),
    // Which rent-roll snapshot (if any) seeded the income assumptions —
    // {snapshotId, dataHash, metricsVersion, contractedLeases, asOfDate,
    // acceptedFields}. Null for models not seeded from a register (or whose
    // seeded assumptions have since been hand-edited — see reconciliation).
    rentRollProvenance: resolvedProvenance,
  });

  const params = [
    assetClass,
    modelParams,
    leg.land_cost_cr                   ?? null,
    leg.plot_area_sqft                 ?? null,
    leg.fsi                            ?? null,
    leg.loading_factor                 ?? null,
    leg.construction_cost_per_sqft     ?? null,
    leg.selling_rate_per_sqft          ?? null,
    leg.approval_cost_cr               ?? null,
    leg.marketing_cost_pct             ?? null,
    leg.finance_cost_pct               ?? null,
    leg.developer_margin_pct           ?? null,
    leg.project_duration_months        ?? null,
    areas.grossBuiltUp                 ?? null,
    areas.saleable                     ?? null,
    areas.carpet                       ?? null,
    areas.superBuiltUp                 ?? null,
    costs.construction                 ?? null,
    costs.gst                          ?? null,
    costs.stampDuty                    ?? null,
    costs.marketing                    ?? null,
    costs.finance                      ?? null,
    costs.total                        ?? null,
    leg.total_revenue_cr               ?? null,
    leg.gross_profit_cr                ?? null,
    leg.gross_margin_pct               ?? null,
    leg.developer_profit_cr            ?? null,
    kpis.npv                           ?? null,
    kpis.irr                           ?? null,
    kpis.rlv                           ?? null,
    kpis.equityMultiple                ?? null,
    kpis.noi                           ?? null,
    kpis.yieldOnCost                   ?? null,
    kpis.exitValue                     ?? null,
    kpis.entryValue                    ?? null,
    kpis.dscr                          ?? null,
    kpis.noi                           ?? null,   // stabilized_noi_cr
    JSON.stringify(computed.cashFlows),
    JSON.stringify(computed.sensitivityMatrix),
    leg.discount_rate_pct              ?? null,
  ];

  // Persist scenarios + the financials row + the immutable HMAC-signed audit
  // record in ONE transaction (correctness audit #13/#14). All three writes run
  // on the SAME pooled connection (exec → client.query) so they commit or roll
  // back together: a financial calc that cannot produce its signed audit record
  // must NOT silently persist (fail-CLOSED, #13), and a mid-save failure must
  // not leave financial_scenarios and financials inconsistent (#14). The
  // CPU-heavy compute above stays OUTSIDE the txn, so the held-connection window
  // is just the three fast writes (respects the serverless pool budget).
  const result = await transaction(async (client) => {
    const exec = (text, p) => client.query(text, p);

    await persistScenarios(dealId, scenarios, exec);

    const existing = await exec('SELECT id FROM financials WHERE deal_id = $1', [dealId]);

    let upserted;
    if (existing.rows.length > 0) {
      upserted = await exec(
      `UPDATE financials SET
        asset_class = $1, model_params = $2,
        land_cost_cr = $3, plot_area_sqft = $4, fsi = $5,
        loading_factor = $6, construction_cost_per_sqft = $7, selling_rate_per_sqft = $8,
        approval_cost_cr = $9, marketing_cost_pct = $10, finance_cost_pct = $11,
        developer_margin_pct = $12, project_duration_months = $13,
        gross_area_sqft = $14, saleable_area_sqft = $15, carpet_area_sqft = $16,
        super_builtup_area_sqft = $17, total_construction_cost_cr = $18,
        gst_cost_cr = $19, stamp_duty_cr = $20, marketing_cost_cr = $21,
        finance_cost_cr = $22, total_cost_cr = $23, total_revenue_cr = $24,
        gross_profit_cr = $25, gross_margin_pct = $26, developer_profit_cr = $27,
        npv_cr = $28, irr_pct = $29, residual_land_value_cr = $30, equity_multiple = $31,
        noi_cr = $32, yield_on_cost_pct = $33, exit_value_cr = $34, entry_value_cr = $35,
        dscr = $36, stabilized_noi_cr = $37,
        cash_flows = $38, sensitivity_matrix = $39, discount_rate_pct = $40,
        updated_at = NOW()
       WHERE deal_id = $41
       RETURNING *`,
      [...params, dealId]
      );
    } else {
      upserted = await exec(
      `INSERT INTO financials (
        asset_class, model_params,
        land_cost_cr, plot_area_sqft, fsi, loading_factor,
        construction_cost_per_sqft, selling_rate_per_sqft,
        approval_cost_cr, marketing_cost_pct, finance_cost_pct,
        developer_margin_pct, project_duration_months,
        gross_area_sqft, saleable_area_sqft, carpet_area_sqft,
        super_builtup_area_sqft, total_construction_cost_cr,
        gst_cost_cr, stamp_duty_cr, marketing_cost_cr,
        finance_cost_cr, total_cost_cr, total_revenue_cr,
        gross_profit_cr, gross_margin_pct, developer_profit_cr,
        npv_cr, irr_pct, residual_land_value_cr, equity_multiple,
        noi_cr, yield_on_cost_pct, exit_value_cr, entry_value_cr,
        dscr, stabilized_noi_cr,
        cash_flows, sensitivity_matrix, discount_rate_pct,
        deal_id
       ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
        $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,
        $29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41
       ) RETURNING *`,
      [...params, dealId]
      );
    }

    // Immutable, HMAC-signed record of (inputs → outputs @ engine version) — the
    // single artifact an investor / IC / auditor replays to prove the numbers
    // came from the exact kernel version + input set. recordEvent throws on a
    // signing failure (e.g. missing HMAC key); inside this txn that throw now
    // rolls the whole save back — fail-CLOSED (#13), no orphaned unaudited calc.
    await auditService.recordEvent({
      dealId,
      eventType: 'calculate_and_save',
      engineVersion: computed.engineVersion || 'kernel-v2',
      assetClass: selectedAssetClass,
      inputs: computed.inputs || normalizedInput,
      outputs: auditService.flattenOutputsForAudit(computed),
      actorId,
      metadata: {
        computedAt: new Date().toISOString(),
        hasSensitivity: !!computed.sensitivityMatrix,
        hasScenarios: !!scenarios,
      },
    }, exec);

    return upserted;
  });

  return { ...result.rows[0], computed };
};

// ─── GET FINANCIALS ───────────────────────────────────────────────────────────

const getFinancials = async (dealId) => {
  const result = await query(
    `SELECT f.*
     FROM financials f
     INNER JOIN deals d ON d.id = f.deal_id
     WHERE f.deal_id = $1
       AND ${buildVisibleDealCondition('d')}`,
    [dealId]
  );
  if (result.rows.length === 0) throw createError('Financials not found for this deal.', 404);
  return result.rows[0];
};

/**
 * Resolve the financials row a workspace slice needs, reusing a row the caller
 * already fetched when possible.
 *
 * The deal-workspace composer loads the financials row once (via getDealById,
 * which already proved deal visibility) and threads it into getScenarios /
 * getFinancialGraph / listDealEvents so those slices skip a redundant
 * `INNER JOIN deals` re-check + re-fetch of the very same row — collapsing
 * ~4 reads of one row per deal-page load down to one. RLS still protects the
 * financials table at the DB layer, so skipping the app-layer re-check for the
 * trusted composer opens no visibility hole.
 *
 * Semantics, preserving getFinancials' contract exactly:
 *   • `preloaded === undefined` → standalone caller; fetch + gate as before.
 *   • `preloaded` is a row       → reuse it (visibility already proven).
 *   • `preloaded` is null        → caller proved the deal is visible but it has
 *                                  no financials row → same 404 getFinancials
 *                                  would raise.
 */
const resolveFinancialsRow = async (dealId, preloaded) => {
  if (preloaded === undefined) return getFinancials(dealId);
  if (!preloaded) throw createError('Financials not found for this deal.', 404);
  return preloaded;
};

const updateFinancials = async (dealId, inputData, options = {}) =>
  calculateAndSave(dealId, inputData, options);

// ─── SENSITIVITY ─────────────────────────────────────────────────────────────

const runSensitivity = async (dealId, params, options = {}) => {
  const { actorId = null } = options;
  const fin        = await getFinancials(dealId);
  const assetClass = fin.asset_class || 'residential_apartments';
  const stored     = fin.model_params?.inputs || {};
  const baseParams = {
    assetClass: resolveFinancialModelClass(assetClass),
    plotAreaSqft:            params.plotAreaSqft            || stored.plotAreaSqft            || fin.plot_area_sqft,
    fsi:                     params.fsi                     || stored.fsi                     || fin.fsi,
    loadingFactor:           params.loadingFactor           || stored.loadingFactor           || fin.loading_factor,
    constructionCostPerSqft: params.constructionCostPerSqft || stored.constructionCostPerSqft || fin.construction_cost_per_sqft,
    sellingRatePerSqft:      params.sellingRatePerSqft      || stored.sellingRatePerSqft      || fin.selling_rate_per_sqft,
    landCostCr:              params.landCostCr              ?? stored.landCostCr              ?? fin.land_cost_cr   ?? 0,
    approvalCostCr:          params.approvalCostCr          ?? stored.approvalCostCr          ?? fin.approval_cost_cr ?? 0,
    marketingCostPct:        params.marketingCostPct        || stored.marketingCostPct        || fin.marketing_cost_pct || 5,
    financeCostPct:          params.financeCostPct          || stored.financeCostPct          || fin.finance_cost_pct  || 12,
    discountRatePct:         params.discountRatePct         || stored.discountRatePct         || fin.discount_rate_pct || 14,
    projectDurationMonths:   params.projectDurationMonths   || stored.projectDurationMonths   || fin.project_duration_months || 36,
    developerMarginPct:      params.developerMarginPct      || stored.developerMarginPct      || fin.developer_margin_pct || 20,
    ...stored,
    ...params,
  };
  const result = computeFullFinancials(baseParams);
  const matrix = result.sensitivityMatrix;
  await query(
    'UPDATE financials SET sensitivity_matrix = $1, updated_at = NOW() WHERE deal_id = $2',
    [JSON.stringify(matrix), dealId]
  );

  // Sign the sensitivity run so operators can prove "this matrix came from
  // this exact input perturbation at this engine version". Non-fatal on
  // failure — the user already has the matrix back.
  try {
    await auditService.recordEvent({
      dealId,
      eventType: 'sensitivity_run',
      engineVersion: result.engineVersion || 'kernel-v2',
      assetClass,
      inputs: result.inputs || baseParams,
      outputs: {
        ...auditService.flattenOutputsForAudit(result),
        sensitivityMatrix: matrix,
      },
      actorId,
      metadata: { perturbations: Object.keys(params || {}) },
    });
  } catch (err) {
    console.warn('[financial.service] audit recordEvent (sensitivity) failed:', err.message);
  }

  return matrix;
};

// ─── SCENARIOS ────────────────────────────────────────────────────────────────

const getScenarios = async (dealId, { financialsRow } = {}) => {
  const fin = await resolveFinancialsRow(dealId, financialsRow);

  // Check if scenarios already stored in model_params
  if (fin.model_params?.scenarios) return fin.model_params.scenarios;

  // Recompute from stored inputs
  const assetClass = fin.asset_class || 'residential_apartments';
  const stored     = fin.model_params?.inputs || {};
  const baseParams = {
    assetClass: resolveFinancialModelClass(assetClass),
    ...stored,
    plotAreaSqft:            stored.plotAreaSqft            ?? fin.plot_area_sqft,
    fsi:                     stored.fsi                     ?? fin.fsi,
    loadingFactor:           stored.loadingFactor           ?? fin.loading_factor,
    constructionCostPerSqft: stored.constructionCostPerSqft ?? fin.construction_cost_per_sqft,
    sellingRatePerSqft:      stored.sellingRatePerSqft      ?? fin.selling_rate_per_sqft,
    landCostCr:              stored.landCostCr              ?? fin.land_cost_cr   ?? 0,
    approvalCostCr:          stored.approvalCostCr          ?? fin.approval_cost_cr ?? 0,
    marketingCostPct:        stored.marketingCostPct        ?? fin.marketing_cost_pct ?? 5,
    financeCostPct:          stored.financeCostPct          ?? fin.finance_cost_pct  ?? 12,
    discountRatePct:         stored.discountRatePct         ?? fin.discount_rate_pct ?? 14,
    projectDurationMonths:   stored.projectDurationMonths   ?? fin.project_duration_months ?? 36,
    developerMarginPct:      stored.developerMarginPct      ?? fin.developer_margin_pct ?? 20,
  };
  return computeScenarios(baseParams);
};

// ─── PROVENANCE GRAPH ─────────────────────────────────────────────────────────

/**
 * Return the dependency DAG for a saved deal's financial model.
 *
 * Every KPI, cost bucket, and revenue line traces back through computations
 * to the user-supplied inputs. The UI (MethodologyExplorer DAG view, IC
 * deck derivation hovers) consumes this snapshot so investors can answer
 * "how was this number produced" without re-running the kernel.
 *
 * Recomputed from persisted inputs on each read — cheap (<200 nodes), and
 * guarantees the graph structure tracks the current kernel version rather
 * than whatever shape was saved. Matches `getScenarios` cadence.
 */
const getFinancialGraph = async (dealId, { financialsRow } = {}) => {
  const fin = await resolveFinancialsRow(dealId, financialsRow);
  const assetClass = fin.asset_class || 'residential_apartments';
  const stored = fin.model_params?.inputs || {};
  const baseParams = {
    assetClass: resolveFinancialModelClass(assetClass),
    ...stored,
    plotAreaSqft:            stored.plotAreaSqft            ?? fin.plot_area_sqft,
    fsi:                     stored.fsi                     ?? fin.fsi,
    loadingFactor:           stored.loadingFactor           ?? fin.loading_factor,
    constructionCostPerSqft: stored.constructionCostPerSqft ?? fin.construction_cost_per_sqft,
    sellingRatePerSqft:      stored.sellingRatePerSqft      ?? fin.selling_rate_per_sqft,
    landCostCr:              stored.landCostCr              ?? fin.land_cost_cr   ?? 0,
    approvalCostCr:          stored.approvalCostCr          ?? fin.approval_cost_cr ?? 0,
    marketingCostPct:        stored.marketingCostPct        ?? fin.marketing_cost_pct ?? 5,
    financeCostPct:          stored.financeCostPct          ?? fin.finance_cost_pct  ?? 12,
    discountRatePct:         stored.discountRatePct         ?? fin.discount_rate_pct ?? 14,
    projectDurationMonths:   stored.projectDurationMonths   ?? fin.project_duration_months ?? 36,
    developerMarginPct:      stored.developerMarginPct      ?? fin.developer_margin_pct ?? 20,
    skipSensitivity: true, // graph endpoint doesn't need sensitivity matrix
  };
  const result = computeFullFinancials(baseParams);
  return result.financialGraph;
};

// ─── AUDIT EVENTS ─────────────────────────────────────────────────────────────

/**
 * Return the signed audit trail for a deal. Verifies each row in-memory so
 * the UI can render a pass/fail indicator per event without a second round
 * trip. `getFinancials` is called first to enforce the deal visibility
 * policy — if the caller can't read the deal, they can't read its events.
 *
 * When `includeOutputsSummary` is true (default for the Audit tab on the
 * deal page), each row includes a `outputs_summary` projection of
 * common KPIs so the UI can compute deltas between consecutive events
 * without N round-trips. The actor's display name is hydrated via a
 * single bulk users lookup.
 */
const listDealEvents = async (dealId, { limit = 50, includeOutputsSummary = false, financialsRow } = {}) => {
  // Visibility gate. The composer threads the already-fetched (already-
  // authorized) financials row to skip a redundant deal re-check; standalone
  // callers omit it and we fetch + gate exactly as before. A null row when one
  // was supplied means the deal has no financials → same 404 as getFinancials.
  if (financialsRow === undefined) {
    await getFinancials(dealId);
  } else if (!financialsRow) {
    throw createError('Financials not found for this deal.', 404);
  }

  // Pull both feeds in parallel — financial computations (HMAC-signed)
  // and mutation log (stage transitions / archive / reassign / bulk).
  // The two are merged + sorted client-side here so the AuditTab
  // renders one chronological timeline.
  const [financialRows, mutationRows] = await Promise.all([
    auditService.listEvents(dealId, {
      limit,
      includeOutputs: !!includeOutputsSummary,
    }),
    dealAuditLog.listForDeal(dealId, { limit }),
  ]);

  // Bulk-resolve actor display names across BOTH feeds so the timeline
  // can show "Rachit Jain" instead of an opaque UUID. One round-trip
  // regardless of event count.
  let actorMap = new Map();
  const actorIds = [
    ...new Set(
      [
        ...financialRows.map((r) => r.actor_id),
        ...mutationRows.map((r) => r.actor_id),
      ].filter(Boolean),
    ),
  ];
  if (actorIds.length > 0) {
    try {
      const actorsResult = await query(
        `SELECT id, name, email FROM users WHERE id = ANY($1::uuid[])`,
        [actorIds],
      );
      actorMap = new Map(actorsResult.rows.map((u) => [u.id, u]));
    } catch {
      // Fail open — UI will fall back to actor_id display.
    }
  }

  const hydrateActor = (actorId) => {
    if (!actorId) return null;
    const u = actorMap.get(actorId);
    return u ? { id: u.id, name: u.name, email: u.email } : null;
  };

  // Financial rows: keep the existing shape (verification note, hashes,
  // optional outputs_summary). Tag with kind: 'financial' so the UI
  // discriminator renders the existing KPI delta block.
  const financial = financialRows.map((row) => {
    const summary = includeOutputsSummary
      ? auditService.summarizeEventOutputs(row.outputs_json)
      : null;
    const { outputs_json: _drop, ...restRow } = row;
    return {
      ...restRow,
      kind: 'financial',
      actor: hydrateActor(row.actor_id),
      outputs_summary: summary,
      verification: {
        note: 'Call GET /financials/:dealId/events/:eventId/verify for full hash + HMAC check.',
      },
    };
  });

  // Mutation rows: shape them so the UI renders a before/after diff
  // pill block instead of KPI deltas. Hashes / signature are absent
  // by design — these aren't replay-verifiable.
  const mutation = mutationRows.map((row) => ({
    id: row.id,
    deal_id: row.deal_id,
    organization_id: row.organization_id,
    actor_id: row.actor_id,
    actor: hydrateActor(row.actor_id),
    event_type: row.event_type,
    before: row.before_json || {},
    after: row.after_json || {},
    metadata: row.metadata || {},
    created_at: row.created_at,
    kind: 'mutation',
  }));

  // Merge + sort newest-first by created_at. Tie-break by kind so
  // mutation events render below financial events of the same
  // millisecond (rarely happens in practice, but stable ordering
  // keeps snapshot tests happy).
  const merged = [...financial, ...mutation].sort((a, b) => {
    const at = new Date(a.created_at).getTime();
    const bt = new Date(b.created_at).getTime();
    if (bt !== at) return bt - at;
    return a.kind === 'financial' ? -1 : 1;
  });

  // Cap the merged feed at the requested limit (default 50). The two
  // upstream queries each fetch up to `limit` rows so the merged
  // result can be up to 2*limit before truncation.
  return merged.slice(0, Math.max(1, Math.min(Number(limit) || 50, 500)));
};

const verifyDealEvent = async (dealId, eventId) => {
  await getFinancials(dealId); // visibility gate
  const event = await auditService.getEvent(eventId);
  if (event.deal_id !== dealId) throw createError('Audit event does not belong to this deal.', 404);
  const verification = auditService.verifyEvent(event);
  return { event, verification };
};

const replayDealEvent = async (dealId, eventId) => {
  await getFinancials(dealId); // visibility gate
  const event = await auditService.getEvent(eventId);
  if (event.deal_id !== dealId) throw createError('Audit event does not belong to this deal.', 404);
  const verification = auditService.verifyEvent(event);
  const replay = auditService.replayEvent(event);
  return { event, verification, replay };
};

// ─── CSV EXPORT ───────────────────────────────────────────────────────────────

const exportFinancialCSV = async (dealId) => {
  const fin  = await getFinancials(dealId);
  const mp   = fin.model_params || {};
  const kpis = mp.kpis   || {};
  const costs= mp.costs  || {};
  const areas= mp.areas  || {};
  const rev  = mp.revenue|| {};

  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const row = (...cols) => cols.map(esc).join(',');

  return [
    row('REDIP Financial Model Export'),
    row('Deal ID', dealId),
    row('Asset Class', fin.asset_class),
    row('Generated', new Date().toISOString()),
    row(''),
    row('=== KEY PERFORMANCE INDICATORS ==='),
    row('Metric', 'Value'),
    row('IRR (%)',            kpis.irr           ?? fin.irr_pct),
    row('NPV (₹ Cr)',        kpis.npv           ?? fin.npv_cr),
    row('Equity Multiple',   kpis.equityMultiple ?? fin.equity_multiple),
    row('RLV (₹ Cr)',        kpis.rlv           ?? fin.residual_land_value_cr),
    row('Gross Margin (%)',  kpis.grossMarginPct ?? fin.gross_margin_pct),
    row('Levered IRR (%)',   kpis.leveredIrr),
    row('NOI (₹ Cr/yr)',     kpis.noi           ?? fin.noi_cr),
    row('Yield on Cost (%)', kpis.yieldOnCost    ?? fin.yield_on_cost_pct),
    row('Exit Value (₹ Cr)', kpis.exitValue     ?? fin.exit_value_cr),
    row('DSCR',              kpis.dscr          ?? fin.dscr),
    row(''),
    row('=== AREA BREAKDOWN (sqft) ==='),
    row('Area', 'sqft'),
    row('Gross Built-Up',   areas.grossBuiltUp  ?? fin.gross_area_sqft),
    row('Saleable',         areas.saleable      ?? fin.saleable_area_sqft),
    row('Carpet',           areas.carpet        ?? fin.carpet_area_sqft),
    row('Super Built-Up',   areas.superBuiltUp  ?? fin.super_builtup_area_sqft),
    row('Leasable',         areas.leasable),
    row(''),
    row('=== COST BREAKDOWN (₹ Cr) ==='),
    row('Line Item', 'Amount'),
    row('Land Cost',                 costs.land         ?? fin.land_cost_cr),
    row('Construction Cost',         costs.construction ?? fin.total_construction_cost_cr),
    row('GST',                       costs.gst          ?? fin.gst_cost_cr),
    row('Contingency',               costs.contingency),
    row('Stamp Duty',                costs.stampDuty    ?? fin.stamp_duty_cr),
    row('Approval / Statutory',      costs.approval     ?? fin.approval_cost_cr),
    row('Architecture Fees',         costs.architecture),
    row('PMC Fees',                  costs.pmc),
    row('Marketing',                 costs.marketing    ?? fin.marketing_cost_cr),
    row('Finance Cost',              costs.finance      ?? fin.finance_cost_cr),
    row('Tenant Improvements',       costs.tenantImprovements),
    row('Leasing Commissions',       costs.leasingCommissions),
    row('TOTAL COST',                costs.total        ?? fin.total_cost_cr),
    row(''),
    row('=== REVENUE SUMMARY (₹ Cr) ==='),
    row('Total Revenue',   rev.totalRevenueCr ?? fin.total_revenue_cr),
    row('Gross Profit',    rev.grossProfitCr  ?? fin.gross_profit_cr),
    row('Gross Margin %',  rev.grossMarginPct ?? fin.gross_margin_pct),
    row('Stabilized NOI',  rev.stabilizedNOI  ?? fin.stabilized_noi_cr),
    row('Exit Value',      rev.exitValue      ?? fin.exit_value_cr),
    row(''),
    row('=== QUARTERLY CASH FLOWS (₹ Cr) ==='),
    row('Quarter', 'Net Cash Flow'),
    ...(fin.cash_flows?.quarterly || []).map((cf) => row(`Q${cf.quarter}`, cf.net)),
    row(''),
    row('=== YEARLY CASH FLOWS (₹ Cr) ==='),
    row('Period', 'Net Cash Flow'),
    ...(fin.cash_flows?.yearly || []).map((cf) => row(cf.label, cf.net)),
  ].join('\n');
};

// ─── BULK-BATCH PIVOT ─────────────────────────────────────────────────────────
//
// Given a bulk_id (UUID stamped on every per-deal audit row that came
// from a bulk operation), return the list of deals that batch
// touched. Lets the UI render a "this was 1 of 12 deals moved at the
// same time" peek. Org-scoped via RLS on deal_audit_log.
const listDealsForBulkBatch = async (bulkId) => {
  if (!bulkId) return [];
  let result;
  try {
    result = await query(
      `SELECT dal.deal_id,
              dal.event_type,
              dal.before_json,
              dal.after_json,
              dal.created_at,
              d.name AS deal_name,
              d.stage AS deal_stage,
              d.is_archived AS deal_is_archived
         FROM deal_audit_log dal
         LEFT JOIN deals d ON d.id = dal.deal_id
        WHERE dal.metadata->>'bulk_id' = $1
        ORDER BY dal.created_at ASC`,
      [bulkId],
    );
  } catch (err) {
    // Migration not applied yet — return empty list rather than
    // surface a 500 to the AuditTab.
    if (err && err.code === '42P01') return [];
    throw err;
  }
  return result.rows;
};

module.exports = {
  calculateAndSave,
  getFinancials,
  updateFinancials,
  runSensitivity,
  getScenarios,
  getFinancialGraph,
  exportFinancialCSV,
  listDealEvents,
  verifyDealEvent,
  replayDealEvent,
  listDealsForBulkBatch,
};
