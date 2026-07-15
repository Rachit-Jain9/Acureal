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

// ── Per-class descriptor fields (stored under record.attributes) ────────────
// Straight from the operator's template pack: each lease-family class carries
// a handful of descriptors that matter for that asset type. All optional,
// display + evidence only — never metric inputs.

const opts = (...labels) => labels.map((l) => ({ value: l, label: l }));

export const CLASS_DESCRIPTOR_FIELDS = {
  residential_apartments: [
    { name: 'configuration', label: 'Configuration', type: 'select', options: opts('Studio', '1 BHK', '2 BHK', '2.5 BHK', '3 BHK', '3.5 BHK', '4 BHK', '4+ BHK') },
    { name: 'carpet_area_sqft', label: 'Carpet Area (sqft)', type: 'number', step: '1' },
    { name: 'furnishing', label: 'Furnishing', type: 'select', options: opts('Unfurnished', 'Semi-furnished', 'Fully furnished') },
    { name: 'society_treatment', label: 'Society / RWA Charges', type: 'select', options: opts('Tenant pays society', 'Owner pays society', 'Included in rent') },
  ],
  villas: [
    { name: 'plot_area_sqft', label: 'Plot Area (sqft)', type: 'number', step: '1' },
    { name: 'built_up_area_sqft', label: 'Built-up Area (sqft)', type: 'number', step: '1' },
    { name: 'furnishing', label: 'Furnishing', type: 'select', options: opts('Unfurnished', 'Semi-furnished', 'Fully furnished') },
    { name: 'pool_garden_opex', label: 'Pool / Garden Upkeep', type: 'select', options: opts('Tenant maintains', 'Owner maintains', 'Shared') },
  ],
  commercial_office: [
    { name: 'building_grade', label: 'Building Grade', type: 'select', options: opts('Grade A+', 'Grade A', 'Grade B', 'Grade C') },
    { name: 'area_measurement', label: 'Area Measurement', type: 'select', options: opts('Super built-up', 'Built-up', 'Carpet', 'Chargeable') },
    { name: 'sez_stpi', label: 'SEZ / STPI', type: 'select', options: opts('None', 'SEZ', 'STPI') },
    { name: 'fit_out_condition', label: 'Fit-out Condition', type: 'select', options: opts('Warm shell', 'Bare shell', 'Fully fitted', 'Plug & play') },
  ],
  retail: [
    { name: 'retail_category', label: 'Retail Category', type: 'text' },
    { name: 'anchor_inline', label: 'Anchor / Inline', type: 'select', options: opts('Anchor', 'Mini anchor', 'Inline', 'Kiosk', 'F&B') },
    { name: 'store_carpet_area_sqft', label: 'Store Carpet Area (sqft)', type: 'number', step: '1' },
    { name: 'trading_density', label: 'Trading Density (₹/sqft/month)', type: 'number', step: '1' },
  ],
  industrial_warehousing: [
    { name: 'facility_type', label: 'Facility Type', type: 'select', options: opts('Grade A warehouse', 'Standard warehouse', 'Cold storage', 'Light manufacturing', 'In-city fulfilment') },
    { name: 'clear_height_ft', label: 'Clear Height (ft)', type: 'number', step: '0.5' },
    { name: 'dock_doors', label: 'Dock Doors', type: 'number', step: '1' },
    { name: 'power_load_kva', label: 'Power Load (kVA)', type: 'number', step: '1' },
  ],
  mixed_use: [
    { name: 'component_asset_class', label: 'Component', type: 'select', options: opts('Commercial Office', 'Retail', 'Residential', 'Hospitality', 'Other') },
    { name: 'component_tower', label: 'Component / Tower', type: 'text' },
    { name: 'revenue_model', label: 'Revenue Model', type: 'select', options: opts('Fixed rent', 'Revenue share', 'MG + revenue share') },
  ],
  raw_land: [
    { name: 'permitted_land_use', label: 'Permitted Land Use', type: 'text' },
    { name: 'lease_licence_type', label: 'Lease / Licence Type', type: 'select', options: opts('Long-term lease', 'Short-term lease', 'Licence', 'Ground lease') },
    { name: 'upfront_premium', label: 'Upfront Premium (₹)', type: 'number', step: '1' },
  ],
};

// Attribute writes are constrained BY CONSTRUCTION: the drawer's form is
// built from CLASS_DESCRIPTOR_FIELDS, so only catalog keys ever reach
// record.attributes from the UI (existing keys, e.g. the reserved area_input
// echo, are merged and preserved). Import/extraction paths must apply the
// same catalog when they land.

export const visibleLeaseSections = (assetClass) => {
  const sections = LEASE_FIELD_SECTIONS.map((section) => ({
    ...section,
    fields: section.fields.filter((f) => !f.visibleWhen || f.visibleWhen(assetClass)),
  })).filter((section) => section.fields.length > 0);

  const descriptors = CLASS_DESCRIPTOR_FIELDS[assetClass];
  if (descriptors && descriptors.length > 0) {
    sections.push({
      title: 'Asset specifics',
      fields: descriptors.map((f) => ({ ...f, isAttribute: true })),
    });
  }
  return sections;
};

// Numeric lease fields — inline grid editors and the drawer coerce these
// before PATCH so the API receives numbers, not strings.
export const NUMERIC_LEASE_FIELDS = new Set(
  LEASE_FIELD_SECTIONS.flatMap((s) => s.fields)
    .filter((f) => f.type === 'number')
    .map((f) => f.name),
);

// ── Sales & collections family (Shape B: plotted / free-sale inventory) ─────

export const SALE_STATUS_CONFIG = {
  unsold: { label: 'Unsold', tone: 'neutral' },
  booked: { label: 'Booked', tone: 'info' },
  sold: { label: 'Sold', tone: 'success' },
  registered: { label: 'Registered', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
};

export const SALE_STATUS_OPTIONS = Object.entries(SALE_STATUS_CONFIG)
  .map(([value, cfg]) => ({ value, label: cfg.label }));

export const SALE_FIELD_SECTIONS = [
  {
    title: 'Identity',
    fields: [
      { name: 'record_label', label: 'Plot / Unit No.', type: 'text' },
      { name: 'block_phase', label: 'Block / Phase', type: 'text' },
      { name: 'unit_type', label: 'Plot Use / Type', type: 'text' },
      { name: 'customer_name', label: 'Customer / Channel', type: 'text' },
      { name: 'status', label: 'Status', type: 'select', options: SALE_STATUS_OPTIONS },
    ],
  },
  {
    title: 'Area & pricing',
    fields: [
      { name: 'area_sqft', label: 'Plot Area (sqft)', type: 'number', step: '1', hint: '1 acre = 43,560 sqft.' },
      { name: 'base_price_per_sqft', label: 'Base Price (₹/sqft)', type: 'number', step: '1' },
      {
        name: 'other_charges_amount', label: 'Other Charges (₹)', type: 'number', step: '1',
        hint: 'PLC + infra + club + registration etc. Added to the base to form the agreement value.',
      },
      { name: 'gst_pct', label: 'GST (%) — informational', type: 'number', step: '0.5' },
      {
        name: 'agreement_value', label: 'Agreement Value (₹)', type: 'number', step: '1',
        hint: 'The consideration governs when entered; otherwise base × area + charges.',
      },
      { name: 'current_market_rate', label: 'Current Market Rate (₹/sqft)', type: 'number', step: '1', hint: 'Drives unsold GDV / mark-to-market.' },
    ],
  },
  {
    title: 'Collections',
    fields: [
      { name: 'amount_collected', label: 'Collected to Date (₹)', type: 'number', step: '1' },
      { name: 'amount_overdue', label: 'Overdue Amount (₹)', type: 'number', step: '1' },
    ],
  },
  {
    title: 'Dates',
    fields: [
      { name: 'booking_date', label: 'Booking Date', type: 'date' },
      { name: 'agreement_date', label: 'Agreement Date', type: 'date' },
      { name: 'possession_date', label: 'Possession Date', type: 'date' },
    ],
  },
];

// Plot descriptors (stored under record.attributes), straight from the pack.
const PLOT_DESCRIPTOR_FIELDS = [
  { name: 'facing', label: 'Facing', type: 'select', options: ['East', 'West', 'North', 'South', 'North-East', 'North-West', 'South-East', 'South-West'].map((v) => ({ value: v, label: v })) },
  { name: 'corner_plot', label: 'Corner Plot', type: 'select', options: [{ value: 'Yes', label: 'Yes' }, { value: 'No', label: 'No' }] },
  { name: 'dimensions', label: 'Dimensions', type: 'text' },
  { name: 'salesperson', label: 'Salesperson', type: 'text' },
];

export const visibleSaleSections = () => [
  ...SALE_FIELD_SECTIONS,
  { title: 'Plot specifics', fields: PLOT_DESCRIPTOR_FIELDS.map((f) => ({ ...f, isAttribute: true })) },
];

export const NUMERIC_SALE_FIELDS = new Set(
  SALE_FIELD_SECTIONS.flatMap((s) => s.fields)
    .filter((f) => f.type === 'number')
    .map((f) => f.name),
);
