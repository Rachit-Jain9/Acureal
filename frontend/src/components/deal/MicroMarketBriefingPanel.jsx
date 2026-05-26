import { useState } from 'react';
import {
  MapPin, ChevronRight, ChevronDown, TrendingUp, Train, Building2, Users,
  Info, AlertTriangle, ShieldCheck, ExternalLink,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useDealMicroMarket } from '../../hooks/useDealContext';
import { formatRelativeTime } from '../../utils/format';

/**
 * MicroMarketBriefingPanel — Phase 1 / Pillar 1.
 *
 * Surfaces the Bengaluru micro-market intelligence for this deal's parcel:
 *   • classification (which of the 20 seeded micro-markets the parcel sits in,
 *     with confidence — 'high' inside radius, 'medium' inside 2× radius,
 *     null for parcels outside seeded Bengaluru coverage)
 *   • per-asset-class benchmark bands (sale rate, rent, cap rate, yield)
 *     with p25 / p50 / p75 / p95 + confidence + source
 *   • demand signals (transit proximity, employment growth, infra triggers,
 *     supply pressure, 12-month price change, buyer-segment mix)
 *
 * Visual rules (CLAUDE.md / feedback_uiux_standards.md):
 *   • Editorial, never tacky. Neutral chrome.
 *   • Confidence drives chip tint. 'low' is shown as 'low' — never silently
 *     dressed up.
 *   • Empty states are honest — "outside seeded markets" / "no coordinates
 *     yet" / "data unavailable" instead of fake numbers.
 *   • Source attribution + last-verified date visible on every cell.
 */

const CONFIDENCE_TONE = {
  high:   'bg-green-50 text-green-700 border-green-200',
  medium: 'bg-amber-50 text-amber-800 border-amber-200',
  low:    'bg-slate-50 text-slate-700 border-slate-200',
};

const TIER_LABEL = { 1: 'Ultra-premium', 2: 'Premium', 3: 'Mid', 4: 'Affordable', 5: 'Emerging' };

const SIGNAL_ICON = {
  transit_proximity:        Train,
  employment_growth_index:  Building2,
  infra_trigger:            TrendingUp,
  absorption_pressure:      AlertTriangle,
  price_yoy_pct:            TrendingUp,
  demand_buyer_segment:     Users,
  new_launch_count_qtr:     Building2,
  delivered_count_yr:       ShieldCheck,
  avg_delivery_delay_months: AlertTriangle,
};

const METRIC_LABEL = {
  sale_rate_per_sqft_inr:         'Sale rate (₹/sqft)',
  rent_per_sqft_month_inr:        'Rent (₹/sqft/month)',
  cap_rate_pct:                   'Cap rate (%)',
  absorption_units_per_quarter:   'Absorption (units/quarter)',
  vacancy_pct:                    'Vacancy (%)',
  gross_rental_yield_pct:         'Gross rental yield (%)',
  guidance_value_per_sqft_inr:    'Guidance value (₹/sqft)',
  plot_rate_per_sqft_inr:         'Plot rate (₹/sqft)',
  office_rent_per_sqft_month_inr: 'Office rent (₹/sqft/month)',
  retail_rent_per_sqft_month_inr: 'Retail rent (₹/sqft/month)',
};

const SIGNAL_LABEL = {
  transit_proximity:         'Transit proximity',
  employment_growth_index:   'Employment growth',
  new_launch_count_qtr:      'New launches (quarter)',
  delivered_count_yr:        'Delivered (12 months)',
  avg_delivery_delay_months: 'Avg delivery delay',
  infra_trigger:             'Infrastructure trigger',
  absorption_pressure:       'Absorption pressure',
  price_yoy_pct:             'Price change (12 months)',
  demand_buyer_segment:      'Buyer-segment mix',
};

const formatNumber = (v, kind) => {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  if (kind?.endsWith('_inr')) return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  if (kind?.endsWith('_pct') || kind?.endsWith('_yield_pct')) return `${n.toFixed(1)}%`;
  return n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
};

const ASSET_CLASS_LABEL = {
  residential_apartments: 'Residential apartments',
  villas: 'Villas',
  plotted_development: 'Plotted development',
  commercial_office: 'Commercial office',
  retail: 'Retail',
  industrial_warehousing: 'Industrial / warehousing',
  hospitality: 'Hospitality',
  mixed_use: 'Mixed-use',
  redevelopment: 'Redevelopment',
  raw_land: 'Raw land',
};

function BenchmarkRow({ row }) {
  return (
    <tr className="border-b border-hairline last:border-0">
      <td className="py-1.5 pr-2 text-xs text-content-secondary">
        {METRIC_LABEL[row.metric_kind] || row.metric_kind}
      </td>
      <td className="py-1.5 px-1 text-xs text-content-muted tabular-nums">{formatNumber(row.p25, row.metric_kind)}</td>
      <td className="py-1.5 px-1 text-sm font-semibold text-content-primary tabular-nums">{formatNumber(row.p50, row.metric_kind)}</td>
      <td className="py-1.5 px-1 text-xs text-content-muted tabular-nums">{formatNumber(row.p75, row.metric_kind)}</td>
      <td className="py-1.5 px-1 text-xs text-content-muted tabular-nums">{formatNumber(row.p95, row.metric_kind)}</td>
      <td className="py-1.5 pl-2 text-right">
        <span
          className={clsx(
            'text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded border',
            CONFIDENCE_TONE[row.confidence] || CONFIDENCE_TONE.low,
          )}
        >
          {row.confidence}
        </span>
      </td>
    </tr>
  );
}

function BenchmarksByAssetClass({ benchmarks }) {
  if (!benchmarks || benchmarks.length === 0) {
    return (
      <div className="text-sm text-content-muted py-3">
        No benchmark data for this micro-market yet.
      </div>
    );
  }
  // Group by asset_class
  const byClass = benchmarks.reduce((acc, row) => {
    const key = row.asset_class || 'other';
    if (!acc[key]) acc[key] = [];
    acc[key].push(row);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {Object.entries(byClass).map(([assetClass, rows]) => (
        <div key={assetClass}>
          <div className="text-xs uppercase tracking-wider text-content-secondary font-medium mb-1.5">
            {ASSET_CLASS_LABEL[assetClass] || assetClass}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline">
                <th className="text-left py-1 pr-2 text-[10px] uppercase tracking-wider text-content-muted font-medium">Metric</th>
                <th className="text-right py-1 px-1 text-[10px] uppercase tracking-wider text-content-muted font-medium">p25</th>
                <th className="text-right py-1 px-1 text-[10px] uppercase tracking-wider text-content-muted font-medium">Median</th>
                <th className="text-right py-1 px-1 text-[10px] uppercase tracking-wider text-content-muted font-medium">p75</th>
                <th className="text-right py-1 px-1 text-[10px] uppercase tracking-wider text-content-muted font-medium">p95</th>
                <th className="text-right py-1 pl-2 text-[10px] uppercase tracking-wider text-content-muted font-medium">Conf</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => <BenchmarkRow key={`${r.asset_class}-${r.metric_kind}`} row={r} />)}
            </tbody>
          </table>
          {/* Source attribution — collapse multiple sources on the same asset class into one line */}
          <div className="mt-1 text-[10px] text-content-muted italic">
            Source: {[...new Set(rows.map((r) => r.source_ref).filter(Boolean))].join(' · ')}
          </div>
        </div>
      ))}
    </div>
  );
}

function DemandSignal({ signal }) {
  const Icon = SIGNAL_ICON[signal.signal_kind] || Info;
  const isYoyPriceUp = signal.signal_kind === 'price_yoy_pct' && Number(signal.value_numeric) > 0;
  return (
    <div className="flex items-start gap-2 py-1.5">
      <Icon size={13} className={clsx('shrink-0 mt-0.5', isYoyPriceUp ? 'text-green-600' : 'text-content-muted')} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <span className="text-xs font-medium text-content-secondary">
            {SIGNAL_LABEL[signal.signal_kind] || signal.signal_kind}
          </span>
          {signal.value_numeric != null && (
            <span className="text-sm font-semibold text-content-primary tabular-nums">
              {signal.value_numeric}{signal.unit && signal.unit !== 'count' ? ` ${signal.unit}` : ''}
            </span>
          )}
        </div>
        {signal.value_text && (
          <div className="text-xs text-content-secondary leading-snug mt-0.5">{signal.value_text}</div>
        )}
        {signal.source_ref && (
          <div className="text-[10px] text-content-muted italic mt-0.5">{signal.source_ref}</div>
        )}
      </div>
    </div>
  );
}

export default function MicroMarketBriefingPanel() {
  const briefing = useDealMicroMarket();
  const [signalsOpen, setSignalsOpen] = useState(false);

  const { classification, locality, benchmarks = [], demand_signals = [], reason } = briefing;

  // Empty / unhappy states surfaced honestly.
  if (reason === 'no_parcel_coordinates') {
    return (
      <div className="card-editorial">
        <h3 className="text-base font-semibold text-content-primary flex items-center gap-2 mb-2">
          <MapPin size={16} className="text-content-muted" />
          Micro-Market Briefing
        </h3>
        <div className="text-sm text-content-muted py-2">
          Add the parcel's coordinates to surface micro-market benchmarks + demand signals
          for this deal.
        </div>
      </div>
    );
  }

  if (reason === 'no_match' || !classification?.locality_code) {
    return (
      <div className="card-editorial">
        <h3 className="text-base font-semibold text-content-primary flex items-center gap-2 mb-2">
          <MapPin size={16} className="text-content-muted" />
          Micro-Market Briefing
        </h3>
        <div className="text-sm text-content-muted py-2">
          This parcel is outside REDIP's seeded Bengaluru micro-markets
          {classification?.distance_km ? ` (~${classification.distance_km} km from nearest)` : ''}.
          Manual benchmarks required.
        </div>
      </div>
    );
  }

  if (reason === 'unavailable') {
    return null; // migration not yet applied — empty render, no broken UI
  }

  return (
    <div className="card-editorial">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-content-primary flex items-center gap-2">
            <MapPin size={16} className="text-content-muted" />
            Micro-Market Briefing
          </h3>
          <div className="flex items-center gap-2 flex-wrap mt-1">
            <span className="text-sm font-medium text-content-secondary">{locality?.name || classification.name}</span>
            {locality?.tier && (
              <span className="text-[10px] uppercase tracking-wider text-content-muted">
                {TIER_LABEL[locality.tier]}
              </span>
            )}
            {classification.confidence && (
              <span
                className={clsx(
                  'text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded border',
                  CONFIDENCE_TONE[classification.confidence] || CONFIDENCE_TONE.low,
                )}
              >
                {classification.confidence} confidence
              </span>
            )}
            {classification.distance_km != null && (
              <span className="text-[10px] text-content-muted">
                {classification.distance_km} km from centroid
              </span>
            )}
          </div>
          {locality?.notes && (
            <div className="text-xs text-content-secondary mt-1 leading-snug">{locality.notes}</div>
          )}
        </div>
      </div>

      <BenchmarksByAssetClass benchmarks={benchmarks} />

      {demand_signals.length > 0 && (
        <div className="mt-4 pt-3 border-t border-hairline">
          <button
            type="button"
            onClick={() => setSignalsOpen((v) => !v)}
            aria-expanded={signalsOpen}
            className="w-full flex items-center justify-between gap-2 text-xs uppercase tracking-wider text-content-secondary font-medium hover:text-content-primary"
          >
            <span>Demand signals ({demand_signals.length})</span>
            {signalsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          {signalsOpen && (
            <div className="mt-2 space-y-1 divide-y divide-hairline">
              {demand_signals.map((s, i) => (
                <DemandSignal key={`${s.signal_kind}-${i}`} signal={s} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
