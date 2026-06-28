// Maps a buildability programme output to the financial-model input shape
// per asset class. Only fills fields that the deterministic buildability
// engine has high-confidence values for — nothing is invented.
//
// Consumed by ZoningTab's "Apply to underwriting" button and by
// FinancialsPage via sessionStorage on first mount.

const PREFILL_KEY_PREFIX = 'redip:prefill:';

// Build a prefill object keyed by the InputForm field names.
export function mapProgrammeToInputs({ assetClass, programme, buildability }) {
  if (!programme || !buildability) return null;
  const out = {};
  const realizedBua = buildability.realized_built_up_sqft;
  const landSqft = buildability.land_sqft;
  const fsi = buildability.effective_fsi;

  // Area/FSI apply to almost every class
  if (landSqft != null) {
    out.plotAreaSqft = String(Math.round(landSqft));
    out.totalLandSqft = String(Math.round(landSqft));
  }
  if (fsi != null) out.fsi = String(Number(fsi.toFixed(2)));

  // Branches mirror the site-yield engine's programme families
  // (backend/src/utils/siteYield.js → FAMILY_BY_ASSET_CLASS). Asset-class
  // keys are the canonical deal vocabulary from constants/assetClasses.js —
  // anything else falls through to the build-cost-only default.
  switch (assetClass) {
    case 'residential_apartments':
    case 'mixed_use':
    case 'redevelopment': {
      // Average carpet per unit from the residential unit mix
      const mix = Array.isArray(programme.unit_mix) ? programme.unit_mix : [];
      const totalUnits = mix.reduce((s, m) => s + (m.count || 0), 0);
      const weightedCarpet = mix.reduce((s, m) => s + (m.carpet_total_sqft || 0), 0);
      const avgCarpet = totalUnits > 0 ? Math.round(weightedCarpet / totalUnits) : null;
      if (avgCarpet) out.avgUnitSizeSqft = String(avgCarpet);
      if (programme.build_cost_per_sqft) {
        out.constructionCostPerSqft = String(Math.round(programme.build_cost_per_sqft));
      }
      break;
    }

    case 'villas':
      // Plotted-form yield, but the financial model treats villas as
      // residential — carry the per-sqft build cost across.
      if (programme.build_cost_per_sqft) {
        out.constructionCostPerSqft = String(Math.round(programme.build_cost_per_sqft));
      }
      break;

    case 'plotted_development':
    case 'raw_land':
      if (programme.build_cost_per_sqft_infra) {
        out.devCostPerSqft = String(Math.round(programme.build_cost_per_sqft_infra));
      }
      break;

    case 'commercial_office':
    case 'retail': {
      if (programme.leasable_sqft) out.leasableSqft = String(Math.round(programme.leasable_sqft));
      if (programme.build_cost_per_sqft) {
        out.hardCostPerSqft = String(Math.round(programme.build_cost_per_sqft));
      }
      if (programme.rent_per_sqft_pm) {
        out.rentPerSqftPerMonth = String(programme.rent_per_sqft_pm);
      }
      break;
    }

    case 'industrial_warehousing':
      if (programme.leasable_sqft) out.leasableSqft = String(Math.round(programme.leasable_sqft));
      if (programme.build_cost_per_sqft) {
        out.hardCostPerSqft = String(Math.round(programme.build_cost_per_sqft));
      }
      break;

    case 'hospitality': {
      if (programme.keys) out.keys = String(programme.keys);
      if (programme.build_cost_per_sqft && realizedBua && programme.keys) {
        // per-key hard cost: total build cost / keys — let the Financial tab
        // layer soft costs / FF&E on top.
        const hardPerKey = Math.round((programme.build_cost_per_sqft * realizedBua) / programme.keys);
        out.constructionCostPerKey = String(hardPerKey);
      }
      if (programme.adr_inr) out.adr = String(programme.adr_inr);
      if (programme.occupancy) out.stabilizedOccPct = String(Math.round(programme.occupancy * 100));
      break;
    }

    default:
      if (programme.build_cost_per_sqft) {
        out.hardCostPerSqft = String(Math.round(programme.build_cost_per_sqft));
      }
      break;
  }

  // Provenance marker — lets the Financials page show a toast
  out.__prefilledFrom = 'buildability';
  out.__prefilledAt = new Date().toISOString();
  out.__prefilledAssetClass = assetClass;

  return out;
}

export function stashPrefill(dealId, payload) {
  if (!dealId || !payload) return;
  try {
    window.sessionStorage.setItem(PREFILL_KEY_PREFIX + dealId, JSON.stringify(payload));
  } catch { /* private mode / storage full — silently skip */ }
}

export function readPrefill(dealId) {
  if (!dealId) return null;
  try {
    const raw = window.sessionStorage.getItem(PREFILL_KEY_PREFIX + dealId);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function clearPrefill(dealId) {
  if (!dealId) return;
  try { window.sessionStorage.removeItem(PREFILL_KEY_PREFIX + dealId); } catch {}
}
