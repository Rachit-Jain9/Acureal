import { useMemo, useState } from 'react';
import { GitCompare, Plus, Search, X } from 'lucide-react';
import { useDeal, useDeals } from '../hooks/useDeals';
import EmptyState from '../components/common/EmptyState';
import PageHeader from '../components/common/PageHeader';
import Badge from '../components/common/Badge';
import { Skeleton, SkeletonCard } from '../design-system';
import {
  DEAL_TYPE_LABELS,
  formatArea,
  formatCrores,
  formatINR,
  formatPct,
  PROPERTY_TYPE_LABELS,
  STAGE_CONFIG,
} from '../utils/format';

const SECTIONS = [
  {
    title: 'Opportunity Snapshot',
    fields: [
      { key: 'property_name', label: 'Linked Property' },
      { key: 'property_type', label: 'Property Type', format: (value) => PROPERTY_TYPE_LABELS[value] || value || '-' },
      { key: 'city', label: 'City' },
      { key: 'deal_type', label: 'Deal Type', format: (value) => DEAL_TYPE_LABELS[value] || value || '-' },
      { key: 'stage', label: 'Stage', format: (value) => STAGE_CONFIG[value]?.label || value || '-' },
      { key: 'priority', label: 'Priority', format: (value) => value ? value[0].toUpperCase() + value.slice(1) : '-' },
    ],
  },
  {
    title: 'Land & Entry',
    fields: [
      { key: 'land_area_sqft', label: 'Land Area', format: formatArea, compare: 'max' },
      { key: 'circle_rate_per_sqft', label: 'Circle Rate', format: (value) => value ? `${formatINR(value, 0)}/sqft` : '-', compare: 'min' },
      { key: 'land_pricing_basis', label: 'Pricing Basis', format: (value) => value === 'per_acre' ? 'INR / acre' : value === 'per_sqft' ? 'INR / sqft' : value ? 'Total in Cr' : '-' },
      { key: 'land_price_rate_inr', label: 'Quoted Rate', format: (value, deal) => {
        if (!value) return '-';
        return deal.land_pricing_basis === 'per_acre'
          ? `${Number(value).toLocaleString('en-IN')} / acre`
          : `${Number(value).toLocaleString('en-IN')} / sqft`;
      } },
      { key: 'land_ask_price_cr', label: 'Total Land Price', format: formatCrores, compare: 'min' },
    ],
  },
  {
    title: 'Underwriting',
    fields: [
      { key: 'total_revenue_cr', label: 'Revenue', format: formatCrores, compare: 'max' },
      { key: 'total_cost_cr', label: 'Total Cost', format: formatCrores, compare: 'min' },
      { key: 'gross_profit_cr', label: 'Gross Profit', format: formatCrores, compare: 'max' },
      { key: 'gross_margin_pct', label: 'Margin', format: formatPct, compare: 'max' },
      { key: 'irr_pct', label: 'IRR', format: formatPct, compare: 'max' },
      { key: 'npv_cr', label: 'NPV', format: formatCrores, compare: 'max' },
      { key: 'equity_multiple', label: 'Equity Multiple', format: (value) => value ? `${Number(value).toFixed(2)}x` : '-', compare: 'max' },
    ],
  },
  {
    title: 'Context',
    fields: [
      { key: 'property_address', label: 'Address' },
      { key: 'notes', label: 'Deal Notes' },
    ],
  },
];

const getFieldValue = (deal, key) => {
  if (deal?.[key] !== undefined) return deal[key];
  if (deal?.financials?.[key] !== undefined) return deal.financials[key];
  return null;
};

export default function DealComparePage() {
  const [selectedIds, setSelectedIds] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);

  const { data: dealsData, isLoading } = useDeals({ limit: 200, includeArchived: false });
  const deals = dealsData?.data || [];

  const detailQuery1 = useDeal(selectedIds[0]);
  const detailQuery2 = useDeal(selectedIds[1]);
  const detailQuery3 = useDeal(selectedIds[2]);
  const detailQuery4 = useDeal(selectedIds[3]);
  const detailQueries = [detailQuery1, detailQuery2, detailQuery3, detailQuery4].slice(0, selectedIds.length);
  const selectedDeals = detailQueries.map((query) => query.data).filter(Boolean);
  const isComparing = detailQueries.some((query) => query.isLoading);

  const selectableDeals = useMemo(
    () =>
      deals.filter((deal) => {
        if (selectedIds.includes(deal.id)) return false;
        if (!searchTerm.trim()) return true;

        const needle = searchTerm.toLowerCase();
        return (
          deal.name?.toLowerCase().includes(needle) ||
          deal.city?.toLowerCase().includes(needle) ||
          deal.property_name?.toLowerCase().includes(needle)
        );
      }),
    [deals, searchTerm, selectedIds]
  );

  const addDeal = (id) => {
    if (selectedIds.length >= 4) return;
    setSelectedIds((current) => [...current, id]);
    setSearchTerm('');
    setShowDropdown(false);
  };

  const removeDeal = (id) => {
    setSelectedIds((current) => current.filter((selectedId) => selectedId !== id));
  };

  const getBestIndices = (field) => {
    if (!field.compare || selectedDeals.length < 2) return [];

    const values = selectedDeals
      .map((deal, index) => ({ index, value: Number(getFieldValue(deal, field.key)) }))
      .filter((entry) => Number.isFinite(entry.value));

    if (values.length < 2) return [];

    const targetValue =
      field.compare === 'min'
        ? Math.min(...values.map((entry) => entry.value))
        : Math.max(...values.map((entry) => entry.value));

    return values.filter((entry) => entry.value === targetValue).map((entry) => entry.index);
  };

  // Skeleton: page header + deal-picker chip strip + comparison grid placeholder.
  if (isLoading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <PageHeader title="Compare Opportunities" description="Pick up to four deals and review land, pricing, and underwriting side by side." />
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-40 rounded-md" />
          ))}
        </div>
        <SkeletonCard height="h-64" titleWidth="w-1/4" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Compare Opportunities"
        description="Pick up to four deals and review land, pricing, and underwriting side by side."
      />

      <div className="rounded-2xl border border-hairline-strong bg-bg-elevated p-6 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-[1.2fr_minmax(0,1fr)]">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-content-secondary">How to use this</h3>
            <p className="mt-2 text-sm text-content-secondary">
              Start with land entry and pricing, then compare underwriting quality, stage position, and notes. The highlighted values mark the strongest metric in each numeric row.
            </p>
          </div>

          <div className="rounded-xl bg-bg-secondary p-4">
            <h4 className="text-sm font-semibold text-content-primary">Selection</h4>
            <div className="mt-3 flex flex-wrap gap-2">
              {selectedIds.map((id) => {
                const deal = deals.find((item) => item.id === id);
                return (
                  <span key={id} className="inline-flex items-center gap-1.5 rounded-full bg-bg-primary px-3 py-1.5 text-xs font-medium text-white">
                    {deal?.name || 'Loading...'}
                    <button onClick={() => removeDeal(id)} className="text-content-muted hover:text-white">
                      <X size={12} />
                    </button>
                  </span>
                );
              })}
            </div>
          </div>
        </div>

        {selectedIds.length < 4 && (
          <div className="relative mt-5">
            <div className="relative max-w-xl">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" size={16} />
              <input
                type="text"
                value={searchTerm}
                onChange={(event) => {
                  setSearchTerm(event.target.value);
                  setShowDropdown(true);
                }}
                onFocus={() => setShowDropdown(true)}
                placeholder="Search deals by name, city, or linked property..."
                className="input w-full pl-9"
              />
            </div>

            {showDropdown && selectableDeals.length > 0 && (
              <div className="absolute z-20 mt-2 max-h-72 w-full max-w-2xl overflow-y-auto rounded-2xl border border-hairline-strong bg-bg-elevated shadow-xl">
                {selectableDeals.slice(0, 20).map((deal) => (
                  <button
                    key={deal.id}
                    onClick={() => addDeal(deal.id)}
                    className="flex w-full items-center justify-between gap-4 border-b border-hairline px-4 py-3 text-left transition hover:bg-bg-secondary last:border-b-0"
                  >
                    <div>
                      <p className="text-sm font-medium text-content-primary">{deal.name}</p>
                      <p className="text-xs text-content-secondary">
                        {deal.property_name || 'Unlinked property'}
                        {deal.city ? ` · ${deal.city}` : ''}
                      </p>
                    </div>
                    <Plus size={14} className="text-content-muted" />
                  </button>
                ))}
              </div>
            )}

            {showDropdown && (
              <div className="fixed inset-0 z-10" onClick={() => setShowDropdown(false)} />
            )}
          </div>
        )}
      </div>

      {selectedDeals.length === 0 && !isComparing ? (
        <EmptyState
          icon={GitCompare}
          title="No deals selected"
          description="Add at least two deals to unlock a full opportunity comparison."
        />
      ) : isComparing ? (
        <div className="space-y-6" aria-busy="true">
          <SkeletonCard height="h-48" titleWidth="w-1/4" />
          <SkeletonCard height="h-48" titleWidth="w-1/3" />
        </div>
      ) : (
        <div className="space-y-6">
          {SECTIONS.map((section) => (
            <div key={section.title} className="rounded-2xl border border-hairline-strong bg-bg-elevated shadow-sm">
              <div className="border-b border-hairline px-6 py-4">
                <h3 className="text-base font-semibold text-content-primary">{section.title}</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b border-hairline bg-bg-secondary">
                      <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-content-secondary">Metric</th>
                      {selectedDeals.map((deal) => (
                        <th key={deal.id} className="px-6 py-3 text-left text-sm font-semibold text-content-primary">
                          <div>
                            <p>{deal.name}</p>
                            <p className="text-xs font-normal text-content-secondary">{deal.city || 'Unknown city'}</p>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline">
                    {section.fields.map((field) => {
                      const bestIndices = getBestIndices(field);

                      return (
                        <tr key={field.key} className="align-top">
                          <td className="px-6 py-3 text-xs font-medium uppercase tracking-wide text-content-secondary">
                            {field.label}
                          </td>
                          {selectedDeals.map((deal, index) => {
                            const value = getFieldValue(deal, field.key);
                            const formattedValue = field.format ? field.format(value, deal) : value || '-';

                            return (
                              <td
                                key={deal.id}
                                className={`px-6 py-3 text-sm ${
                                  bestIndices.includes(index)
                                    ? 'bg-emerald-50 font-semibold text-emerald-700'
                                    : 'text-content-primary'
                                }`}
                              >
                                {formattedValue || '-'}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
