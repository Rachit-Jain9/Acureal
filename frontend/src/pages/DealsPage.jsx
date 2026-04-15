import { useState, useMemo, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Search, X, Briefcase, ChevronLeft, ChevronRight } from 'lucide-react';
import { clsx } from 'clsx';
import { useDeals, useCreateDeal } from '../hooks/useDeals';
import { useProperties } from '../hooks/useProperties';
import LoadingSpinner from '../components/common/LoadingSpinner';
import EmptyState from '../components/common/EmptyState';
import Badge from '../components/common/Badge';
import PageHeader from '../components/common/PageHeader';
import {
  formatCrores,
  formatPct,
  formatRelativeTime,
  STAGE_CONFIG,
  PRIORITY_CONFIG,
  DEAL_TYPE_LABELS,
  PROPERTY_TYPE_LABELS,
} from '../utils/format';
import { buildLandPricingPreview } from '../utils/landPricing';

const ASSET_CLASS_LABELS = {
  residential_apartments: 'Residential Apts',
  plotted_development: 'Plotted Dev',
  villas: 'Villas',
  commercial_office: 'Commercial Office',
  retail: 'Retail',
  industrial_warehousing: 'Industrial/WH',
  hospitality: 'Hospitality',
  mixed_use: 'Mixed Use',
  raw_land: 'Raw Land',
  redevelopment: 'Redevelopment',
};

const DEAL_STRUCTURE_LABELS = {
  outright: 'Outright',
  jv: 'JV',
  jda: 'JDA',
  revenue_share: 'Rev Share',
  area_share: 'Area Share',
  profit_share: 'Profit Share',
  ground_lease: 'Ground Lease',
  hybrid: 'Hybrid',
};

const INITIAL_FORM = {
  propertyId: '',
  name: '',
  dealType: 'acquisition',
  stage: 'screening',
  priority: 'medium',
  assetClass: 'residential_apartments',
  dealStructure: 'outright',
  landPricingBasis: 'total_cr',
  landPriceRateInr: '',
  landExtentInputValue: '',
  landExtentInputUnit: 'sqft',
  landAskPriceCr: '',
  notes: '',
};

export default function DealsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Filters
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [stageFilter, setStageFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [page, setPage] = useState(1);

  // Sync search param from header navigation
  useEffect(() => {
    const q = searchParams.get('search');
    if (q) setSearch(q);
  }, [searchParams]);

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(INITIAL_FORM);

  const params = useMemo(() => {
    const p = { page, limit: 12 };
    if (search) p.search = search;
    if (stageFilter) p.stage = stageFilter;
    if (typeFilter) p.dealType = typeFilter;
    if (priorityFilter) p.priority = priorityFilter;
    return p;
  }, [search, stageFilter, typeFilter, priorityFilter, page]);

  const { data, isLoading, isError } = useDeals(params);
  const { data: propertiesData } = useProperties({ limit: 200 });
  const createDeal = useCreateDeal();

  const deals = data?.data || [];
  const pagination = data?.pagination || { total: 0, page: 1, totalPages: 1 };
  const properties = propertiesData?.data || [];
  const selectedProperty = properties.find((property) => property.id === form.propertyId);
  const landPricingPreview = buildLandPricingPreview({
    pricingBasis: form.landPricingBasis,
    totalPriceCr: form.landAskPriceCr,
    rateInr: form.landPriceRateInr,
    extentValue: form.landExtentInputValue,
    extentUnit: form.landExtentInputUnit,
    fallbackAreaSqft: selectedProperty?.land_area_sqft,
  });

  const handleFilterReset = () => {
    setSearch('');
    setStageFilter('');
    setTypeFilter('');
    setPriorityFilter('');
    setPage(1);
  };

  const hasFilters = search || stageFilter || typeFilter || priorityFilter;

  const handleOpenModal = () => {
    setForm(INITIAL_FORM);
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setForm(INITIAL_FORM);
  };

  const handleFormChange = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const payload = {
      propertyId: form.propertyId || undefined,
      name: form.name,
      dealType: form.dealType,
      stage: form.stage,
      priority: form.priority,
      assetClass: form.assetClass,
      dealStructure: form.dealStructure,
      landPricingBasis: form.landPricingBasis,
      landPriceRateInr: form.landPriceRateInr ? parseFloat(form.landPriceRateInr) : undefined,
      landExtentInputValue: form.landExtentInputValue ? parseFloat(form.landExtentInputValue) : undefined,
      landExtentInputUnit: form.landExtentInputUnit,
      landAskPriceCr: landPricingPreview.totalPriceCr ?? undefined,
      notes: form.notes || undefined,
    };
    try {
      await createDeal.mutateAsync(payload);
      handleCloseModal();
    } catch {
      // error handled by hook
    }
  };

  if (isLoading) {
    return <LoadingSpinner className="py-24" />;
  }

  if (isError) {
    return (
      <div className="text-center py-24 text-red-600">
        Failed to load deals. Please try again.
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Deals"
        description={`${pagination.total} deal${pagination.total !== 1 ? 's' : ''} in pipeline`}
        actions={
          <button onClick={handleOpenModal} className="btn btn-primary flex items-center gap-2">
            <Plus size={16} />
            New Deal
          </button>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input
            type="text"
            placeholder="Search deals, properties, cities..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="input pl-9 w-full"
          />
        </div>

        <select
          value={stageFilter}
          onChange={(e) => { setStageFilter(e.target.value); setPage(1); }}
          className="input w-auto"
        >
          <option value="">All Stages</option>
          {Object.entries(STAGE_CONFIG).filter(([key]) => key !== 'dead').map(([key, cfg]) => (
            <option key={key} value={key}>{cfg.label}</option>
          ))}
        </select>

        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          className="input w-auto"
        >
          <option value="">All Types</option>
          {Object.entries(DEAL_TYPE_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>

        <select
          value={priorityFilter}
          onChange={(e) => { setPriorityFilter(e.target.value); setPage(1); }}
          className="input w-auto"
        >
          <option value="">All Priorities</option>
          {Object.entries(PRIORITY_CONFIG).map(([key, cfg]) => (
            <option key={key} value={key}>{cfg.label}</option>
          ))}
        </select>

        {hasFilters && (
          <button onClick={handleFilterReset} className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1">
            <X size={14} /> Clear
          </button>
        )}
      </div>

      {/* Deal Cards Grid */}
      {deals.length === 0 ? (
        <EmptyState
          title="No deals found"
          description={hasFilters ? 'Try adjusting your filters.' : 'Create your first deal to get started.'}
          icon={Briefcase}
          action={
            !hasFilters && (
              <button onClick={handleOpenModal} className="btn btn-primary mt-2">
                <Plus size={16} className="mr-1 inline" /> New Deal
              </button>
            )
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {deals.map((deal) => {
              const stageCfg = STAGE_CONFIG[deal.stage] || STAGE_CONFIG.screening;
              const priorityCfg = PRIORITY_CONFIG[deal.priority] || PRIORITY_CONFIG.medium;
              return (
                <Link
                  key={deal.id}
                  to={`/dashboard/deals/${deal.id}`}
                  className="card hover:shadow-md transition-shadow cursor-pointer"
                >
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="font-semibold text-gray-900 truncate pr-2">{deal.name}</h3>
                    <Badge className={stageCfg.color}>{stageCfg.label}</Badge>
                  </div>

                  <p className="text-sm text-gray-600 mb-1">{deal.property_name || 'Unlinked property'}</p>
                  <p className="text-xs text-gray-400 mb-3">{deal.city}{deal.state ? `, ${deal.state}` : ''}</p>

                  <div className="grid grid-cols-2 gap-3 mb-3 text-sm">
                    <div>
                      <p className="text-xs text-gray-400">Land Area</p>
                      <p className="font-medium text-gray-800">
                        {deal.land_area_acres
                          ? `${Number(deal.land_area_acres).toFixed(2)} acres`
                          : deal.land_area_sqft
                            ? `${Number(deal.land_area_sqft).toLocaleString('en-IN')} sqft`
                            : 'Pending'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400">Headline Economics</p>
                      <p className="font-medium text-gray-800">
                        {deal.land_ask_price_cr ? formatCrores(deal.land_ask_price_cr) : formatCrores(deal.total_revenue_cr)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center flex-wrap gap-2 mb-3">
                    <Badge className={priorityCfg.color}>{priorityCfg.label}</Badge>
                    <span className="text-xs text-gray-500">{DEAL_TYPE_LABELS[deal.deal_type] || deal.deal_type}</span>
                    {deal.asset_class && (
                      <span className="text-xs text-gray-500">
                        {ASSET_CLASS_LABELS[deal.asset_class] || deal.asset_class}
                      </span>
                    )}
                    {deal.deal_structure && (
                      <span className="text-xs text-gray-500">
                        {DEAL_STRUCTURE_LABELS[deal.deal_structure] || deal.deal_structure}
                      </span>
                    )}
                  </div>

                  {Array.isArray(deal.key_risks) && deal.key_risks.length > 0 && (
                    <div className="mb-3 flex flex-wrap gap-1.5">
                      {deal.key_risks.slice(0, 2).map((risk) => (
                        <span
                          key={risk}
                          className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700"
                        >
                          {risk}
                        </span>
                      ))}
                      {deal.open_high_risk_count > 2 && (
                        <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">
                          +{deal.open_high_risk_count - 2} more
                        </span>
                      )}
                    </div>
                  )}

                  <div className="flex items-center justify-between text-sm border-t pt-3">
                    <div>
                      <span className="text-gray-400 text-xs">IRR</span>
                      <p className="font-medium">{formatPct(deal.irr_pct)}</p>
                    </div>
                    <div className="text-right">
                      <span className="text-gray-400 text-xs">Revenue</span>
                      <p className="font-medium">{formatCrores(deal.total_revenue_cr)}</p>
                    </div>
                  </div>

                  {(deal.last_activity_date || deal.updated_at) && (
                    <p className="text-xs text-gray-400 mt-2">
                      Updated {formatRelativeTime(deal.last_activity_date || deal.updated_at)}
                    </p>
                  )}
                </Link>
              );
            })}
          </div>

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-between mt-6">
              <p className="text-sm text-gray-500">
                Showing {(pagination.page - 1) * (params.limit || 12) + 1}
                &ndash;
                {Math.min(pagination.page * (params.limit || 12), pagination.total)} of {pagination.total}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={pagination.page <= 1}
                  className="btn btn-secondary p-2 disabled:opacity-40"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="text-sm text-gray-700">
                  Page {pagination.page} of {pagination.totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                  disabled={pagination.page >= pagination.totalPages}
                  className="btn btn-secondary p-2 disabled:opacity-40"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* New Deal Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
              <h2 className="text-lg font-bold text-gray-900">New Deal</h2>
              <button onClick={handleCloseModal} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Property</label>
                <select
                  name="propertyId"
                  value={form.propertyId}
                  onChange={handleFormChange}
                  className="input w-full"
                >
                  <option value="">Add later / source first</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {(p.display_name || p.name || 'Untitled property')}
                      {p.city ? ` - ${p.city}` : ''}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  You can create the deal now and link a property later if sourcing data is still incomplete.
                </p>
                {selectedProperty && (
                  <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    {PROPERTY_TYPE_LABELS[selectedProperty.property_type] || selectedProperty.property_type || 'Property'} in {selectedProperty.city || 'unknown city'}
                    {selectedProperty.land_area_sqft ? ` · ${Number(selectedProperty.land_area_sqft).toLocaleString('en-IN')} sqft` : ''}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Deal Name *</label>
                <input
                  type="text"
                  name="name"
                  value={form.name}
                  onChange={handleFormChange}
                  required
                  placeholder="e.g. Whitefield JV Phase 1"
                  className="input w-full"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                  <select name="dealType" value={form.dealType} onChange={handleFormChange} className="input w-full">
                    {Object.entries(DEAL_TYPE_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Stage</label>
                  <select name="stage" value={form.stage} onChange={handleFormChange} className="input w-full">
                    {Object.entries(STAGE_CONFIG).map(([key, cfg]) => (
                      <option key={key} value={key}>{cfg.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                  <select name="priority" value={form.priority} onChange={handleFormChange} className="input w-full">
                    {Object.entries(PRIORITY_CONFIG).map(([key, cfg]) => (
                      <option key={key} value={key}>{cfg.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Asset Class</label>
                  <select name="assetClass" value={form.assetClass} onChange={handleFormChange} className="input w-full">
                    <option value="residential_apartments">Residential Apartments</option>
                    <option value="plotted_development">Plotted Development</option>
                    <option value="villas">Villas</option>
                    <option value="commercial_office">Commercial Office</option>
                    <option value="retail">Retail</option>
                    <option value="industrial_warehousing">Industrial / Warehousing</option>
                    <option value="hospitality">Hospitality</option>
                    <option value="mixed_use">Mixed Use</option>
                    <option value="raw_land">Raw Land</option>
                    <option value="redevelopment">Redevelopment</option>
                  </select>
                </div>
                <div className="col-span-2 md:col-span-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Deal Structure</label>
                  <select name="dealStructure" value={form.dealStructure} onChange={handleFormChange} className="input w-full">
                    <option value="outright">Outright Purchase</option>
                    <option value="jv">JV (Joint Venture)</option>
                    <option value="jda">JDA (Development Agreement)</option>
                    <option value="revenue_share">Revenue Share</option>
                    <option value="area_share">Area Share</option>
                    <option value="profit_share">Profit Share</option>
                    <option value="ground_lease">Ground Lease</option>
                    <option value="hybrid">Hybrid</option>
                  </select>
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-slate-50 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-slate-900">Land Pricing</h4>
                    <p className="text-xs text-slate-500">Quote land cost in crore, per acre, or per sqft. REDIP will normalize the total.</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Pricing Basis</label>
                    <select
                      name="landPricingBasis"
                      value={form.landPricingBasis}
                      onChange={handleFormChange}
                      className="input w-full"
                    >
                      <option value="total_cr">Total in Cr</option>
                      <option value="per_sqft">INR / sqft</option>
                      <option value="per_acre">INR / acre</option>
                    </select>
                  </div>

                  {form.landPricingBasis === 'total_cr' ? (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Total Land Price (Cr)</label>
                      <input
                        type="number"
                        name="landAskPriceCr"
                        value={form.landAskPriceCr}
                        onChange={handleFormChange}
                        step="0.01"
                        min="0"
                        placeholder="e.g. 25.50"
                        className="input w-full"
                      />
                    </div>
                  ) : (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {form.landPricingBasis === 'per_acre' ? 'Land Rate (INR / acre)' : 'Land Rate (INR / sqft)'}
                      </label>
                      <input
                        type="number"
                        name="landPriceRateInr"
                        value={form.landPriceRateInr}
                        onChange={handleFormChange}
                        step="0.01"
                        min="0"
                        placeholder={form.landPricingBasis === 'per_acre' ? 'e.g. 250000000' : 'e.g. 12000'}
                        className="input w-full"
                      />
                    </div>
                  )}

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Land Extent for Pricing</label>
                    <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
                      <input
                        type="number"
                        name="landExtentInputValue"
                        value={form.landExtentInputValue}
                        onChange={handleFormChange}
                        step="0.01"
                        min="0"
                        placeholder={selectedProperty?.land_area_sqft ? 'Optional override. Blank uses linked property area.' : 'Enter the deal land extent'}
                        className="input w-full"
                      />
                      <select
                        name="landExtentInputUnit"
                        value={form.landExtentInputUnit}
                        onChange={handleFormChange}
                        className="input w-full"
                      >
                        <option value="sqft">sq ft</option>
                        <option value="acre">acre</option>
                      </select>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      {selectedProperty?.land_area_sqft
                        ? `Linked property fallback area: ${Number(selectedProperty.land_area_sqft).toLocaleString('en-IN')} sqft`
                        : 'If no linked property exists yet, enter the sourcing extent here so total pricing can still be calculated.'}
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="rounded-lg bg-white px-3 py-2">
                    <p className="text-xs text-gray-500">Normalized area</p>
                    <p className="text-sm font-semibold text-slate-900">
                      {landPricingPreview.areaSqft ? `${landPricingPreview.areaSqft.toLocaleString('en-IN')} sqft` : '-'}
                    </p>
                  </div>
                  <div className="rounded-lg bg-white px-3 py-2">
                    <p className="text-xs text-gray-500">Equivalent acres</p>
                    <p className="text-sm font-semibold text-slate-900">
                      {landPricingPreview.areaAcres ? landPricingPreview.areaAcres.toFixed(4) : '-'}
                    </p>
                  </div>
                  <div className="rounded-lg bg-slate-900 px-3 py-2 text-white">
                    <p className="text-xs text-slate-300">Computed total land price</p>
                    <p className="text-sm font-semibold">
                      {landPricingPreview.totalPriceCr != null ? `${landPricingPreview.totalPriceCr.toFixed(2)} Cr` : '-'}
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  name="notes"
                  value={form.notes}
                  onChange={handleFormChange}
                  rows={3}
                  placeholder="Any initial notes..."
                  className="input w-full"
                />
              </div>

              </div>
              <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 flex-shrink-0 rounded-b-xl">
                <button type="button" onClick={handleCloseModal} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" disabled={createDeal.isPending} className="btn btn-primary">
                  {createDeal.isPending ? 'Creating...' : 'Create Deal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
