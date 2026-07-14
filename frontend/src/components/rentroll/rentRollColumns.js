// Deal Register column catalog — the single source of truth for the lease
// register's structure (grid columns, drawer form sections, status/basis
// vocabularies). Follows the fieldDefs.js FIELD_DEFS[assetClass] idiom.
//
// Field shape: { name, label, type: 'text'|'number'|'date'|'select', options?,
// step?, hint?, visibleWhen?(assetClass) }. Names map 1:1 to lease_records
// columns (backend whitelist drops anything else).

export const REGISTER_FAMILY_BY_ASSET_CLASS = {
  residential_apartments: 'lease_income',
  villas: 'lease_income',
  commercial_office: 'lease_income',
  retail: 'lease_income',
  industrial_warehousing: 'lease_income',
  mixed_use: 'lease_income',
  raw_land: 'lease_income',
  plotted_development: 'sales_collections',
  hospitality: 'hotel_operating',
  redevelopment: 'redevelopment',
};

// Tab label adapts to the register family (a "Rent Roll" tab on a plotted
// deal would read as ignorance, not intelligence).
export const REGISTER_TAB_LABELS = {
  lease_income: 'Rent Roll',
  sales_collections: 'Sales & Collections',
  hotel_operating: 'Operating Roll',
  redevelopment: 'Occupants & Sales',
};

export const registerFamilyFor = (assetClass) =>
  REGISTER_FAMILY_BY_ASSET_CLASS[assetClass] || 'lease_income';

// Status drives metric eligibility (mirrors utils/rentRollMetrics.js):
// vacant rows feed ERV potential only; LOIs count toward committed occupancy
// under the register's visible LOI policy.
export const LEASE_STATUS_CONFIG = {
  vacant: { label: 'Vacant', tone: 'neutral' },
  loi: { label: 'LOI', tone: 'info' },
  committed: { label: 'Committed', tone: 'info' },
  occupied: { label: 'Occupied', tone: 'success' },
  notice_served: { label: 'Notice Served', tone: 'warn' },
  expired: { label: 'Expired / MTM', tone: 'danger' },
};

export const LEASE_STATUS_OPTIONS = Object.entries(LEASE_STATUS_CONFIG)
  .map(([value, cfg]) => ({ value, label: cfg.label }));

export const RENT_BASIS_OPTIONS = [
  { value: 'per_sqft_month', label: '₹/sqft/month' },
  { value: 'per_unit_month', label: '₹/unit/month' },
  { value: 'per_acre_month', label: '₹/acre/month' },
];

export const RENT_BASIS_SHORT = {
  per_sqft_month: '₹/sf/mo',
  per_unit_month: '₹/unit/mo',
  per_acre_month: '₹/acre/mo',
};

export const CAM_TREATMENT_OPTIONS = [
  { value: 'recovery', label: 'Billed & recovered by owner' },
  { value: 'pass_through', label: 'Paid directly by tenant (pass-through)' },
  { value: 'included_in_rent', label: 'Included in base rent' },
  { value: 'owner_borne', label: 'Borne by owner (no recovery)' },
];

// ── Drawer form sections (lease family) ─────────────────────────────────────

const retailOnly = (assetClass) => assetClass === 'retail';

export const LEASE_FIELD_SECTIONS = [
  {
    title: 'Identity',
    fields: [
      { name: 'record_label', label: 'Unit / Ref', type: 'text' },
      { name: 'building', label: 'Building / Zone', type: 'text' },
      { name: 'tenant_name', label: 'Tenant / Occupier', type: 'text' },
      { name: 'sector_use', label: 'Sector / Use', type: 'text' },
      { name: 'status', label: 'Lease Status', type: 'select', options: LEASE_STATUS_OPTIONS },
    ],
  },
  {
    title: 'Area & basis',
    fields: [
      { name: 'rent_basis', label: 'Rent Basis', type: 'select', options: RENT_BASIS_OPTIONS },
      {
        name: 'chargeable_area_sqft', label: 'Chargeable Area (sqft)', type: 'number', step: '1',
        hint: 'Always in sqft — 1 acre = 43,560 sqft.',
      },
    ],
  },
  {
    title: 'Dates',
    fields: [
      { name: 'lease_start', label: 'Lease Start', type: 'date' },
      { name: 'rent_commencement', label: 'Rent Commencement', type: 'date' },
      { name: 'lease_expiry', label: 'Lease Expiry', type: 'date' },
      { name: 'lockin_end', label: 'Lock-in End', type: 'date' },
      { name: 'notice_period_months', label: 'Notice (months)', type: 'number', step: '1' },
    ],
  },
  {
    title: 'Economics',
    fields: [
      {
        name: 'base_rent_rate', label: 'Base Rent (₹/basis/month)', type: 'number', step: '0.01',
        hint: 'Gross rate, before any JDA/JV share — the model nets ownership downstream.',
      },
      { name: 'cam_rate', label: 'CAM (₹/sqft/month)', type: 'number', step: '0.01' },
      { name: 'cam_treatment', label: 'CAM Treatment', type: 'select', options: CAM_TREATMENT_OPTIONS },
      { name: 'ancillary_qty', label: 'Ancillary Qty (parking etc.)', type: 'number', step: '1' },
      { name: 'ancillary_rate_monthly', label: 'Ancillary Rate (₹/unit/month)', type: 'number', step: '0.01' },
      { name: 'other_income_monthly', label: 'Other Income (₹/month)', type: 'number', step: '1' },
      {
        name: 'sales_revenue_base_annual', label: 'Sales Base (₹/year)', type: 'number', step: '1',
        visibleWhen: retailOnly, hint: 'Annual tenant turnover the variable rent applies to.',
      },
      {
        name: 'variable_rent_pct', label: 'Variable Rent (% of sales)', type: 'number', step: '0.1',
        visibleWhen: retailOnly,
      },
      { name: 'escalation_pct', label: 'Escalation (%)', type: 'number', step: '0.1' },
      { name: 'escalation_every_months', label: 'Escalation Every (months)', type: 'number', step: '1' },
      { name: 'rent_free_months', label: 'Rent-Free (months)', type: 'number', step: '0.5' },
      { name: 'deposit_months', label: 'Deposit (months of rent)', type: 'number', step: '0.5' },
      {
        name: 'security_deposit_amount', label: 'Security Deposit (₹ actual)', type: 'number', step: '1',
        hint: 'The negotiated amount governs; the months figure is a cross-check.',
      },
      { name: 'collection_pct', label: 'Collection (%)', type: 'number', step: '0.1' },
      { name: 'gst_pct', label: 'GST (%) — informational', type: 'number', step: '0.1' },
      { name: 'tds_pct', label: 'TDS (%) — informational', type: 'number', step: '0.1' },
    ],
  },
  {
    title: 'Benchmarks',
    fields: [
      { name: 'market_rent_rate', label: 'Market Rent (same basis)', type: 'number', step: '0.01' },
      { name: 'owner_opex_annual', label: 'Owner Opex (₹/year)', type: 'number', step: '1' },
    ],
  },
];

export const visibleLeaseSections = (assetClass) =>
  LEASE_FIELD_SECTIONS.map((section) => ({
    ...section,
    fields: section.fields.filter((f) => !f.visibleWhen || f.visibleWhen(assetClass)),
  })).filter((section) => section.fields.length > 0);

// Numeric lease fields — inline grid editors and the drawer coerce these
// before PATCH so the API receives numbers, not strings.
export const NUMERIC_LEASE_FIELDS = new Set(
  LEASE_FIELD_SECTIONS.flatMap((s) => s.fields)
    .filter((f) => f.type === 'number')
    .map((f) => f.name),
);
