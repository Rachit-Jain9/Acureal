/**
 * Deal stage playbook — Workstream D1 (the adaptive face).
 *
 * Turns the deal workspace's static per-stage hint list into a *live*
 * checklist: for the deal's current stage, every step is evaluated
 * done / pending against the deal's actual state, so the workspace
 * genuinely guides the operator rather than just listing generic advice.
 *
 * Deterministic — pure rule logic, no AI (CLAUDE.md). Every check reads
 * data that is already synthesised onto the deal record:
 *   - plain deal fields (ask price, area, asset class, parcel link, …)
 *   - `readiness_summary` — the server-side DD / approvals / risk / document
 *     rollup that already powers the Deal Pulse ribbon.
 * The playbook is a stage-aware *presentation* over that grounded data,
 * exactly as `DealPulseRibbon` derives its tone/label from `readiness`.
 */

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const present = (v) =>
  v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0);
const positive = (v) => num(v) > 0;
const readiness = (deal) => (deal && deal.readiness_summary) || {};
const hasActivityType = (deal, type) =>
  Array.isArray(deal && deal.recent_activities) &&
  deal.recent_activities.some((a) => (a.activity_type || a.type) === type);

const done = (detail) => ({ status: 'done', detail: detail || null });
const pending = (detail) => ({ status: 'pending', detail: detail || null });

// A DD / approvals percentage at or above this counts as "complete" — the
// margin absorbs not-applicable items the rollup still scores.
const COMPLETE_PCT = 90;

/**
 * Per-stage checklist. Steps are ordered as the work naturally sequences.
 * Each `evaluate(deal)` returns { status, detail } purely from deal state.
 */
const STAGE_PLAYBOOK = {
  sourced: [
    {
      id: 'ask_price',
      label: 'Capture the asking price',
      evaluate: (d) => (positive(d.land_ask_price_cr) ? done() : pending()),
    },
    {
      id: 'land_area',
      label: 'Record the land area',
      evaluate: (d) => (positive(d.land_area_sqft) ? done() : pending()),
    },
    {
      id: 'classify',
      label: 'Set the asset class and deal structure',
      evaluate: (d) =>
        present(d.asset_class) && present(d.deal_structure) ? done() : pending(),
    },
    {
      id: 'parcel',
      label: 'Link the parcel',
      evaluate: (d) => (present(d.property_id) ? done() : pending()),
    },
    {
      id: 'first_docs',
      label: 'Upload the first documents',
      evaluate: (d) => {
        const n = num(readiness(d).document_count);
        return n > 0 ? done(`${n} on file`) : pending();
      },
    },
  ],
  screening: [
    {
      id: 'parcel',
      label: 'Link the parcel',
      evaluate: (d) => (present(d.property_id) ? done() : pending()),
    },
    {
      id: 'title_docs',
      label: 'Upload the title documents',
      evaluate: (d) => {
        const n = num(readiness(d).document_count);
        return n > 0 ? done(`${n} on file`) : pending();
      },
    },
    {
      id: 'screen_activity',
      label: 'Log a screening review',
      evaluate: (d) =>
        Array.isArray(d.recent_activities) && d.recent_activities.length > 0
          ? done()
          : pending(),
    },
    {
      id: 'ask_price',
      label: 'Confirm the asking price',
      evaluate: (d) => (positive(d.land_ask_price_cr) ? done() : pending()),
    },
  ],
  site_visit: [
    {
      id: 'visit_logged',
      label: 'Log the site visit',
      evaluate: (d) => (hasActivityType(d, 'site_visit') ? done() : pending()),
    },
    {
      id: 'parcel_facts',
      label: 'Capture the parcel facts — area and access',
      evaluate: (d) =>
        positive(d.land_area_sqft) && present(d.property_id) ? done() : pending(),
    },
    {
      id: 'docs',
      label: 'Upload supporting documents',
      evaluate: (d) => (positive(readiness(d).document_count) ? done() : pending()),
    },
  ],
  loi: [
    {
      id: 'price',
      label: 'Confirm the agreed price',
      evaluate: (d) =>
        positive(d.negotiated_price_cr) || positive(d.land_ask_price_cr)
          ? done()
          : pending(),
    },
    {
      id: 'docs',
      label: 'Attach the LOI and title documents',
      evaluate: (d) => (positive(readiness(d).document_count) ? done() : pending()),
    },
    {
      id: 'dd_started',
      label: 'Open the due-diligence checklist',
      evaluate: (d) => {
        const pct = num(readiness(d).dd_completion_pct);
        return pct > 0 ? done(`${pct}% complete`) : pending();
      },
    },
  ],
  due_diligence: [
    {
      id: 'dd_progress',
      label: 'Work the due-diligence checklist',
      evaluate: (d) => {
        const pct = num(readiness(d).dd_completion_pct);
        return pct >= COMPLETE_PCT
          ? done(`${pct}% complete`)
          : pending(pct > 0 ? `${pct}% complete` : null);
      },
    },
    {
      id: 'deal_breakers',
      label: 'Resolve deal-breaker DD items',
      evaluate: (d) => {
        const db = num(readiness(d).pending_deal_breakers);
        return db === 0 ? done() : pending(`${db} unresolved`);
      },
    },
    {
      id: 'approvals',
      label: 'Verify the statutory approvals',
      evaluate: (d) => {
        const pct = num(readiness(d).approval_completion_pct);
        return pct >= COMPLETE_PCT
          ? done(`${pct}% validated`)
          : pending(pct > 0 ? `${pct}% validated` : null);
      },
    },
    {
      id: 'docs',
      label: 'Upload the supporting evidence',
      evaluate: (d) => {
        const n = num(readiness(d).document_count);
        return n > 0 ? done(`${n} on file`) : pending();
      },
    },
  ],
  underwriting: [
    {
      id: 'model',
      label: 'Build the financial model',
      evaluate: (d) => (present(d.financials) ? done() : pending()),
    },
    {
      id: 'dd_complete',
      label: 'Complete due diligence',
      evaluate: (d) => {
        const pct = num(readiness(d).dd_completion_pct);
        return pct >= COMPLETE_PCT ? done(`${pct}% complete`) : pending(`${pct}% complete`);
      },
    },
    {
      id: 'deal_breakers',
      label: 'Clear all deal-breaker items',
      evaluate: (d) => {
        const db = num(readiness(d).pending_deal_breakers);
        return db === 0 ? done() : pending(`${db} unresolved`);
      },
    },
  ],
  ic_review: [
    {
      id: 'model',
      label: 'Finalise the financial model',
      evaluate: (d) => (present(d.financials) ? done() : pending()),
    },
    {
      id: 'dd_complete',
      label: 'Complete due diligence',
      evaluate: (d) => {
        const pct = num(readiness(d).dd_completion_pct);
        return pct >= COMPLETE_PCT ? done(`${pct}% complete`) : pending(`${pct}% complete`);
      },
    },
    {
      id: 'deal_breakers',
      label: 'Clear all deal-breaker risks',
      evaluate: (d) => {
        const db = num(readiness(d).pending_deal_breakers);
        return db === 0 ? done() : pending(`${db} unresolved`);
      },
    },
    {
      id: 'ic_ready',
      label: 'Reach Investor-Grade readiness',
      evaluate: (d) => {
        const r = readiness(d);
        if (r.status === 'ic_ready') return done();
        return pending(r.readiness_pct != null ? `${num(r.readiness_pct)}% ready` : null);
      },
    },
  ],
  negotiation: [
    {
      id: 'neg_price',
      label: 'Record the negotiated price',
      evaluate: (d) => (positive(d.negotiated_price_cr) ? done() : pending()),
    },
    {
      id: 'structure',
      label: 'Confirm the final deal structure',
      evaluate: (d) => (present(d.deal_structure) ? done() : pending()),
    },
  ],
  active: [
    {
      id: 'activity',
      label: 'Track execution activity',
      evaluate: (d) =>
        Array.isArray(d.recent_activities) && d.recent_activities.length > 0
          ? done()
          : pending(),
    },
  ],
  closed: [
    { id: 'archive', label: 'Archive the closing documents', evaluate: () => pending() },
    { id: 'portfolio', label: 'Update the portfolio tracker', evaluate: () => pending() },
  ],
  dead: [
    {
      id: 'reason',
      label: 'Document why this deal was dropped',
      evaluate: (d) => (present(d.notes) ? done() : pending()),
    },
  ],
};

/**
 * Build the live playbook for a deal's current stage.
 *
 * @param {object} deal  the composed deal record (deal fields +
 *                       `readiness_summary` + `recent_activities`).
 * @returns {{ stage, steps:[{id,label,status,detail}], done, total, pct,
 *             terminal } | null}  null when the deal has no stage or the
 *           stage has no playbook.
 */
export function buildPlaybook(deal) {
  if (!deal || !deal.stage) return null;
  const steps = STAGE_PLAYBOOK[deal.stage];
  if (!Array.isArray(steps) || steps.length === 0) return null;

  const evaluated = steps.map((step) => {
    let result;
    try {
      result = step.evaluate(deal) || pending();
    } catch {
      // A malformed deal field must never break the workspace render.
      result = pending();
    }
    return {
      id: step.id,
      label: step.label,
      status: result.status === 'done' ? 'done' : 'pending',
      detail: result.detail || null,
    };
  });

  const total = evaluated.length;
  const doneCount = evaluated.filter((s) => s.status === 'done').length;

  return {
    stage: deal.stage,
    steps: evaluated,
    done: doneCount,
    total,
    pct: total > 0 ? Math.round((doneCount / total) * 100) : 0,
    terminal: deal.stage === 'closed' || deal.stage === 'dead',
  };
}

export { STAGE_PLAYBOOK };
