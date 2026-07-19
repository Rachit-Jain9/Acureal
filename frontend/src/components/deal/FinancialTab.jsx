import { Link } from 'react-router-dom';
import EmptyState from '../common/EmptyState';
import { ArrowRight, TrendingUp, BarChart3 } from 'lucide-react';
import { clsx } from 'clsx';
import { formatCrores, formatPct, formatArea } from '../../utils/format';
// P1-PR3 — scroll-on-mount when an evidence-ref click lands here.
import { useScrollOnMount } from '../../hooks/useEvidenceNavigate';
import ProvenanceGraphView from '../financials/ProvenanceGraphView';
import AuditTrailChip from '../financials/AuditTrailChip';
import ProvenanceLedgerChip from '../financials/ProvenanceLedgerChip';
// Workstream A (Provenance Spine) — the model-trust verdict, carried from
// the DCF page to the deal workspace so it travels with the numbers.
import ModelTrustSummary from '../financials/ModelTrustSummary';
import { SectionHeader } from '../../design-system';
import { useDealRecord } from '../../hooks/useDealContext';
import { useCanEdit } from '../../hooks/useCanEdit';

function MetricCard({ label, value, sub, highlight }) {
  return (
    <div className="bg-bg-secondary rounded-lg p-4">
      <p className="text-xs text-content-muted mb-1">{label}</p>
      <p
        className={clsx(
          'text-lg font-bold',
          highlight === 'green' && 'text-data-positive',
          highlight === 'amber' && 'text-premium',
          highlight === 'red' && 'text-data-negative',
          !highlight && 'text-content-primary'
        )}
      >
        {value}
      </p>
      {sub && <p className="text-xs text-content-muted mt-0.5">{sub}</p>}
    </div>
  );
}

function irrHighlight(pct) {
  if (pct == null) return null;
  if (pct >= 20) return 'green';
  if (pct >= 15) return 'amber';
  return 'red';
}

function marginHighlight(pct) {
  if (pct == null) return null;
  if (pct >= 25) return 'green';
  if (pct >= 15) return 'amber';
  return 'red';
}

const INCOME_CLASSES = new Set(['commercial_office', 'retail', 'industrial_warehousing']);
const HOSPITALITY_CLASSES = new Set(['hospitality']);

function formatINRPerSqft(val) {
  if (val == null) return '-';
  return `₹${Number(val).toLocaleString('en-IN', { maximumFractionDigits: 0 })}/sqft`;
}

function formatINRPerUnit(val, unit) {
  if (val == null) return '-';
  const formatted = val >= 1e7
    ? `₹${(val / 1e7).toFixed(2)} Cr`
    : val >= 1e5
      ? `₹${(val / 1e5).toFixed(2)} L`
      : `₹${Number(val).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  return unit ? `${formatted}/${unit}` : formatted;
}

export default function FinancialTab() {
  const deal = useDealRecord();
  const financials = deal?.financials;
  const dealId = deal?.id;
  const canEdit = useCanEdit();
  useScrollOnMount();

  if (!financials) {
    return (
      <div className="card-editorial">
        <EmptyState
          size="md"
          icon={BarChart3}
          title="No financial model yet"
          description={canEdit
            ? 'Build a full financial model to track IRR, NPV, equity multiple, costs, and revenue projections for this deal.'
            : 'An editor or admin needs to build the financial model for this deal. Once it is saved, IRR, NPV, equity multiple, costs, and revenue projections will appear here.'}
          action={canEdit ? (
            <Link
              to={`/dashboard/financials/${dealId}`}
              className="btn btn-primary inline-flex items-center gap-2"
            >
              Build Financial Model <ArrowRight size={15} />
            </Link>
          ) : null}
        />
      </div>
    );
  }

  const f = financials;
  const mp = f.model_params || {};
  const kpis = mp.kpis || {};
  const assetClass = f.asset_class || 'residential_apartments';
  const isIncome = INCOME_CLASSES.has(assetClass);
  const isHospitality = HOSPITALITY_CLASSES.has(assetClass);

  return (
    <div className="space-y-6">
      <SectionHeader
        helpTopic="deal.financial-model"
        size="sm"
        icon={TrendingUp}
        title="Financial Model Summary"
        action={
          <Link
            to={`/dashboard/financials/${dealId}`}
            className="btn btn-primary flex items-center gap-1.5 text-sm"
          >
            Open Full Model <ArrowRight size={14} />
          </Link>
        }
        className="mb-0"
      />

      {/* Workstream A — how grounded these numbers are, and the range the
          unverified assumptions imply. Hides itself when uncatalogued. */}
      <ModelTrustSummary dealId={dealId} />

      {/* Returns */}
      <div className="card-editorial">
        <h4 className="text-sm font-semibold text-content-secondary uppercase tracking-wider mb-3">
          Returns
        </h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetricCard
            label="IRR"
            value={formatPct(f.irr_pct)}
            highlight={irrHighlight(f.irr_pct)}
          />
          <MetricCard
            label={isIncome || isHospitality ? 'Yield on Cost' : 'Gross Margin'}
            value={formatPct(isIncome || isHospitality ? f.yield_on_cost_pct : f.gross_margin_pct)}
            highlight={marginHighlight(isIncome || isHospitality ? f.yield_on_cost_pct : f.gross_margin_pct)}
          />
          <MetricCard
            label="Equity Multiple"
            value={
              f.equity_multiple != null ? `${Number(f.equity_multiple).toFixed(2)}x` : '-'
            }
          />
          <MetricCard label="NPV" value={formatCrores(f.npv_cr)} />
        </div>
      </div>

      {/* Revenue & Profit */}
      <div className="card-editorial">
        <h4 className="text-sm font-semibold text-content-secondary uppercase tracking-wider mb-3">
          {isIncome ? 'Income & Valuation' : isHospitality ? 'Revenue & EBITDA' : 'Revenue & Profit'}
        </h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {isIncome ? (
            <>
              <MetricCard label="Stabilized NOI" value={formatCrores(f.stabilized_noi_cr || f.noi_cr)} />
              <MetricCard label="Entry Value" value={formatCrores(f.entry_value_cr)} />
              <MetricCard label="Exit Value" value={formatCrores(f.exit_value_cr)} />
              <MetricCard label="Total Dev Cost" value={formatCrores(f.total_cost_cr)} />
            </>
          ) : isHospitality ? (
            <>
              <MetricCard label="Total Revenue (Y1)" value={formatCrores(f.total_revenue_cr)} />
              <MetricCard label="EBITDA (Y1)" value={formatCrores(f.stabilized_noi_cr)} />
              <MetricCard label="Exit Value" value={formatCrores(f.exit_value_cr)} />
              <MetricCard label="RevPAR" value={kpis.revPAR != null ? `₹${kpis.revPAR.toLocaleString('en-IN')}` : '-'} />
            </>
          ) : (
            <>
              <MetricCard label="Total Revenue" value={formatCrores(f.total_revenue_cr)} />
              <MetricCard label="Gross Profit" value={formatCrores(f.gross_profit_cr)} />
              <MetricCard label="Developer Profit" value={formatCrores(f.developer_profit_cr)} />
              <MetricCard label="RLV" value={formatCrores(f.residual_land_value_cr)} />
            </>
          )}
        </div>
      </div>

      {/* Per-unit KPIs */}
      {(kpis.costPerSqft || kpis.revenuePerPlot || kpis.devCostPerSqft || kpis.devCostPerKey) && (
        <div className="card-editorial">
          <h4 className="text-sm font-semibold text-content-secondary uppercase tracking-wider mb-3">
            Unit Economics
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Residential */}
            {kpis.costPerSqft != null && <MetricCard label="Cost / sqft" value={formatINRPerSqft(kpis.costPerSqft)} />}
            {kpis.revenuePerSqft != null && !kpis.revenuePerPlot && <MetricCard label="Revenue / sqft" value={formatINRPerSqft(kpis.revenuePerSqft)} />}
            {kpis.profitPerSqft != null && <MetricCard label="Profit / sqft" value={formatINRPerSqft(kpis.profitPerSqft)} />}
            {kpis.moic != null && <MetricCard label="MOIC" value={`${Number(kpis.moic).toFixed(2)}x`} />}
            {/* Plotted */}
            {kpis.revenuePerPlot != null && <MetricCard label="Revenue / Plot" value={formatINRPerUnit(kpis.revenuePerPlot)} />}
            {kpis.costPerPlot != null && <MetricCard label="Cost / Plot" value={formatINRPerUnit(kpis.costPerPlot)} />}
            {kpis.profitPerPlot != null && <MetricCard label="Profit / Plot" value={formatINRPerUnit(kpis.profitPerPlot)} />}
            {/* Income */}
            {kpis.devCostPerSqft != null && !kpis.devCostPerKey && <MetricCard label="Dev Cost / sqft" value={formatINRPerSqft(kpis.devCostPerSqft)} />}
            {kpis.noiPerSqft != null && <MetricCard label="NOI / sqft" value={formatINRPerSqft(kpis.noiPerSqft)} />}
            {kpis.rentPerSqftAnnual != null && <MetricCard label="Annual Rent / sqft" value={formatINRPerSqft(kpis.rentPerSqftAnnual)} />}
            {/* Hospitality */}
            {kpis.devCostPerKey != null && <MetricCard label="Dev Cost / Key" value={formatINRPerUnit(kpis.devCostPerKey)} />}
            {kpis.revenuePerKey != null && <MetricCard label="Revenue / Key (Y1)" value={formatINRPerUnit(kpis.revenuePerKey)} />}
            {kpis.gopPAR != null && <MetricCard label="GOPPAR" value={`₹${Number(kpis.gopPAR).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`} />}
          </div>
        </div>
      )}

      {/* Costs */}
      <div className="card-editorial">
        <h4 className="text-sm font-semibold text-content-secondary uppercase tracking-wider mb-3">
          Costs
        </h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetricCard label="Total Cost" value={formatCrores(f.total_cost_cr)} />
          <MetricCard label="Land Cost" value={formatCrores(f.land_cost_cr)} />
          <MetricCard label="Construction Cost" value={formatCrores(f.total_construction_cost_cr)} />
          <MetricCard label="Finance Cost" value={formatCrores(f.finance_cost_cr)} />
        </div>
      </div>

      {/* Areas */}
      <div className="card-editorial">
        <h4 className="text-sm font-semibold text-content-secondary uppercase tracking-wider mb-3">
          Area Breakdown
        </h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetricCard
            label={isIncome ? 'Leasable Area' : 'Saleable Area'}
            value={f.saleable_area_sqft != null ? formatArea(f.saleable_area_sqft) : '-'}
          />
          <MetricCard
            label="Built-up Area"
            value={f.gross_area_sqft != null ? formatArea(f.gross_area_sqft) : '-'}
          />
          {f.carpet_area_sqft != null && (
            <MetricCard label="Carpet Area" value={formatArea(f.carpet_area_sqft)} />
          )}
          {f.dscr != null && <MetricCard label="DSCR" value={Number(f.dscr).toFixed(2)} />}
        </div>
      </div>

      {/* Provenance graph — how the KPIs above are derived. Passes
          dealId so the component fetches the authoritative kernel-v2 DAG
          with live node values; falls back to client-side topology if the
          backend graph isn't available (new / unsaved deal). */}
      <ProvenanceGraphView
        dealId={dealId}
        assetClass={assetClass}
        facilityIds={mp.facilityIds || (f.finance_cost_cr ? ['construction-loan'] : [])}
        tierIds={mp.tierIds || []}
        hasCovenants={f.dscr != null}
      />

      {/* Footer — last-updated stamp + two credibility one-liners: the signed
          audit trail and the provenance ledger. Both open their full detail in
          a modal on click (the provenance one replaced a top-level deal tab on
          2026-07-19) instead of always rendering a card. */}
      <div className="flex items-center justify-between gap-3 flex-wrap pt-2">
        <div className="flex items-center gap-2 flex-wrap">
          <AuditTrailChip dealId={dealId} />
          <ProvenanceLedgerChip dealId={dealId} />
        </div>
        {f.updated_at && (
          <p className="text-xs text-content-muted">
            Model last updated:{' '}
            {new Date(f.updated_at).toLocaleString('en-IN', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        )}
      </div>
    </div>
  );
}
