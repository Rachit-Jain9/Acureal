import { Link } from 'react-router-dom';
import { ArrowRight, TrendingUp, BarChart3 } from 'lucide-react';
import { clsx } from 'clsx';
import { formatCrores, formatPct, formatArea } from '../../utils/format';

function MetricCard({ label, value, sub, highlight }) {
  return (
    <div className="bg-gray-50 rounded-lg p-4">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p
        className={clsx(
          'text-lg font-bold',
          highlight === 'green' && 'text-green-600',
          highlight === 'amber' && 'text-amber-600',
          highlight === 'red' && 'text-red-600',
          !highlight && 'text-gray-900'
        )}
      >
        {value}
      </p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
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

export default function FinancialTab({ deal }) {
  const financials = deal?.financials;
  const dealId = deal?.id;

  if (!financials) {
    return (
      <div className="card text-center py-20">
        <BarChart3 size={40} className="text-gray-300 mx-auto mb-4" />
        <p className="text-base font-semibold text-gray-700 mb-1">No financial model yet</p>
        <p className="text-sm text-gray-400 mb-6">
          Build a full financial model to track IRR, NPV, equity multiple, costs, and revenue
          projections for this deal.
        </p>
        <Link to={`/dashboard/financials/${dealId}`} className="btn btn-primary inline-flex items-center gap-2">
          Build Financial Model <ArrowRight size={15} />
        </Link>
      </div>
    );
  }

  const f = financials;

  return (
    <div className="space-y-6">
      {/* Summary Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp size={18} className="text-primary-600" />
          <h3 className="text-base font-semibold text-gray-900">Financial Model Summary</h3>
        </div>
        <Link
          to={`/dashboard/financials/${dealId}`}
          className="btn btn-primary flex items-center gap-1.5 text-sm"
        >
          Open Full Model <ArrowRight size={14} />
        </Link>
      </div>

      {/* Returns */}
      <div className="card">
        <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Returns
        </h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetricCard
            label="IRR"
            value={formatPct(f.irr_pct)}
            highlight={irrHighlight(f.irr_pct)}
          />
          <MetricCard
            label="Gross Margin"
            value={formatPct(f.gross_margin_pct)}
            highlight={marginHighlight(f.gross_margin_pct)}
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
      <div className="card">
        <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Revenue &amp; Profit
        </h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetricCard label="Total Revenue" value={formatCrores(f.total_revenue_cr)} />
          <MetricCard label="Gross Profit" value={formatCrores(f.gross_profit_cr)} />
          <MetricCard label="Developer Profit" value={formatCrores(f.developer_profit_cr)} />
          <MetricCard
            label="Yield on Cost"
            value={formatPct(f.yield_on_cost_pct)}
          />
        </div>
      </div>

      {/* Costs */}
      <div className="card">
        <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Costs
        </h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetricCard label="Total Cost" value={formatCrores(f.total_cost_cr)} />
          <MetricCard label="Land Cost" value={formatCrores(f.land_cost_cr)} />
          <MetricCard label="Construction Cost" value={formatCrores(f.construction_cost_cr)} />
          <MetricCard label="Other Cost" value={formatCrores(f.other_cost_cr)} />
        </div>
      </div>

      {/* Areas */}
      <div className="card">
        <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Area Breakdown
        </h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetricCard
            label="Saleable Area"
            value={f.saleable_area_sqft != null ? formatArea(f.saleable_area_sqft) : '-'}
          />
          <MetricCard
            label="Built-up Area"
            value={f.builtup_area_sqft != null ? formatArea(f.builtup_area_sqft) : '-'}
          />
          <MetricCard
            label="Carpet Area"
            value={f.carpet_area_sqft != null ? formatArea(f.carpet_area_sqft) : '-'}
          />
          {f.dscr != null && <MetricCard label="DSCR" value={Number(f.dscr).toFixed(2)} />}
        </div>
      </div>

      {/* Last updated */}
      {f.updated_at && (
        <p className="text-xs text-gray-400 text-right">
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
  );
}
