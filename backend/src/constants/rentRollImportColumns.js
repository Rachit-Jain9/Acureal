'use strict';

// Deal-register template / import column catalog — the SINGLE source of truth
// for (a) the blank XLSX templates a user downloads to prepare register data
// offline, and (b) the deterministic importer that reads a filled template
// back in. Keeping both on one schema means the header a user sees, the column
// the template writes, and the field the importer maps can never drift.
//
// Each column: { key (DB field), header (human), type, options?, hint?,
//   normalize? }. `key` maps 1:1 to the record table columns (the service
// whitelist drops anything else). Enum `options` become Excel dropdowns in the
// template and an allowed-value check on import. Only a truthful subset of the
// schema is user-fillable — derived metrics are never columns here (they are
// computed by rentRollMetrics from these inputs).
//
// TEMPLATE_VERSION is stamped into the hidden redip_meta sheet; the importer
// rejects a mismatched major version with a readable error (so an old template
// filled against a newer schema fails loudly, never silently mis-maps).

const TEMPLATE_VERSION = 'rr-template-1.0.0';

// Reusable enum option sets (mirror the DB CHECK constraints + rentRollColumns).
const LEASE_STATUS = ['vacant', 'loi', 'committed', 'occupied', 'notice_served', 'expired'];
const RENT_BASIS = ['per_sqft_month', 'per_unit_month', 'per_acre_month'];
const CAM_TREATMENT = ['recovery', 'pass_through', 'included_in_rent', 'owner_borne'];
const SALE_STATUS = ['unsold', 'booked', 'sold', 'registered', 'cancelled'];
const CONTRACT_TYPE = ['hma', 'franchise', 'master_lease', 'revenue_share', 'other'];
const OCCUPANT_STATUS = ['in_place', 'vacated', 'disputed'];
const OCCUPANCY_TYPE = ['owner', 'tenant', 'commercial', 'other'];
const DOC_RISK = ['low', 'medium', 'high'];

// ── Per-kind column catalogs ────────────────────────────────────────────────
// Order = the template's left-to-right column order. `required` columns are
// flagged in the template header note; import still accepts blanks (sourcing-
// stage friendly) but warns when a required identifier is entirely absent.

const LEASE_COLUMNS = [
  { key: 'record_label', header: 'Unit / Ref', type: 'text', required: true },
  { key: 'building', header: 'Building / Zone', type: 'text' },
  { key: 'tenant_name', header: 'Tenant / Occupier', type: 'text' },
  { key: 'sector_use', header: 'Sector / Use', type: 'text' },
  { key: 'status', header: 'Lease Status', type: 'select', options: LEASE_STATUS },
  { key: 'rent_basis', header: 'Rent Basis', type: 'select', options: RENT_BASIS },
  { key: 'chargeable_area_sqft', header: 'Chargeable Area (sqft)', type: 'number' },
  { key: 'lease_start', header: 'Lease Start (YYYY-MM-DD)', type: 'date' },
  { key: 'rent_commencement', header: 'Rent Commencement (YYYY-MM-DD)', type: 'date' },
  { key: 'lease_expiry', header: 'Lease Expiry (YYYY-MM-DD)', type: 'date' },
  { key: 'lockin_end', header: 'Lock-in End (YYYY-MM-DD)', type: 'date' },
  { key: 'notice_period_months', header: 'Notice (months)', type: 'number' },
  { key: 'base_rent_rate', header: 'Base Rent (per basis / month)', type: 'number' },
  { key: 'cam_rate', header: 'CAM (₹/sqft/month)', type: 'number' },
  { key: 'cam_treatment', header: 'CAM Treatment', type: 'select', options: CAM_TREATMENT },
  { key: 'other_income_monthly', header: 'Other Income (₹/month)', type: 'number' },
  { key: 'escalation_pct', header: 'Escalation (%)', type: 'number' },
  { key: 'escalation_every_months', header: 'Escalation Every (months)', type: 'number' },
  { key: 'rent_free_months', header: 'Rent-Free (months)', type: 'number' },
  { key: 'deposit_months', header: 'Deposit (months)', type: 'number' },
  { key: 'security_deposit_amount', header: 'Security Deposit (₹)', type: 'number' },
  { key: 'collection_pct', header: 'Collection (%)', type: 'number' },
  { key: 'market_rent_rate', header: 'Market Rent (same basis)', type: 'number' },
  { key: 'owner_opex_annual', header: 'Owner Opex (₹/year)', type: 'number' },
];

const SALE_COLUMNS = [
  { key: 'record_label', header: 'Plot / Unit No.', type: 'text', required: true },
  { key: 'block_phase', header: 'Block / Phase', type: 'text' },
  { key: 'unit_type', header: 'Plot Use / Type', type: 'text' },
  { key: 'customer_name', header: 'Customer / Channel', type: 'text' },
  { key: 'status', header: 'Status', type: 'select', options: SALE_STATUS },
  { key: 'area_sqft', header: 'Plot Area (sqft)', type: 'number' },
  { key: 'base_price_per_sqft', header: 'Base Price (₹/sqft)', type: 'number' },
  { key: 'other_charges_amount', header: 'Other Charges (₹)', type: 'number' },
  { key: 'agreement_value', header: 'Agreement Value (₹)', type: 'number' },
  { key: 'amount_collected', header: 'Collected to Date (₹)', type: 'number' },
  { key: 'amount_overdue', header: 'Overdue Amount (₹)', type: 'number' },
  { key: 'current_market_rate', header: 'Current Market Rate (₹/sqft)', type: 'number' },
  { key: 'booking_date', header: 'Booking Date (YYYY-MM-DD)', type: 'date' },
  { key: 'agreement_date', header: 'Agreement Date (YYYY-MM-DD)', type: 'date' },
  { key: 'possession_date', header: 'Possession Date (YYYY-MM-DD)', type: 'date' },
];

const OCCUPANT_COLUMNS = [
  { key: 'record_label', header: 'Existing Unit Ref', type: 'text', required: true },
  { key: 'building', header: 'Existing Building / Wing', type: 'text' },
  { key: 'occupant_name', header: 'Occupant Name', type: 'text' },
  { key: 'occupancy_type', header: 'Occupier Type', type: 'select', options: OCCUPANCY_TYPE },
  { key: 'agreement_status', header: 'Agreement Status', type: 'text' },
  { key: 'status', header: 'Vacation Status', type: 'select', options: OCCUPANT_STATUS },
  { key: 'existing_carpet_area_sqft', header: 'Existing Carpet (sqft)', type: 'number' },
  { key: 'rehab_entitlement_sqft', header: 'Rehab Entitlement (sqft)', type: 'number' },
  { key: 'additional_area_sqft', header: 'Additional / Fungible (sqft)', type: 'number' },
  { key: 'transit_rent_monthly', header: 'Transit Rent (₹/month)', type: 'number' },
  { key: 'transit_rent_start', header: 'Transit Start (YYYY-MM-DD)', type: 'date' },
  { key: 'transit_rent_end', header: 'Transit End (YYYY-MM-DD)', type: 'date' },
  { key: 'transit_rent_escalation_pct', header: 'Transit Escalation (% pa)', type: 'number' },
  { key: 'shifting_allowance', header: 'Shifting Allowance (₹)', type: 'number' },
  { key: 'brokerage_amount', header: 'Brokerage (₹)', type: 'number' },
  { key: 'corpus_amount', header: 'Corpus / Hardship (₹)', type: 'number' },
  { key: 'other_obligation_amount', header: 'Other Obligation (₹)', type: 'number' },
  { key: 'rehab_possession_target', header: 'Rehab Possession Target (YYYY-MM-DD)', type: 'date' },
  { key: 'documentation_risk', header: 'Documentation Risk', type: 'select', options: DOC_RISK },
];

const HOTEL_KEY_COLUMNS = [
  { key: 'room_type', header: 'Room Type', type: 'text', required: true },
  { key: 'keys_count', header: 'Keys', type: 'number' },
  { key: 'operational', header: 'Operational (TRUE/FALSE)', type: 'boolean' },
  { key: 'ooo_pct', header: 'Out-of-Order (%)', type: 'number' },
  { key: 'adr_premium_pct', header: 'ADR Premium / (Discount) (%)', type: 'number' },
  { key: 'floor_wing', header: 'Floor / Wing', type: 'text' },
];

const HOTEL_CONTRACT_COLUMNS = [
  { key: 'record_label', header: 'Contract Ref', type: 'text', required: true },
  { key: 'operator_name', header: 'Operator / Lessee', type: 'text' },
  { key: 'brand', header: 'Brand', type: 'text' },
  { key: 'contract_type', header: 'Contract Type', type: 'select', options: CONTRACT_TYPE },
  { key: 'start_date', header: 'Start Date (YYYY-MM-DD)', type: 'date' },
  { key: 'end_date', header: 'End Date (YYYY-MM-DD)', type: 'date' },
  { key: 'lockin_end', header: 'Lock-in End (YYYY-MM-DD)', type: 'date' },
  { key: 'notice_period_months', header: 'Notice (months)', type: 'number' },
  { key: 'base_fee_pct', header: 'Base Fee (% of revenue)', type: 'number' },
  { key: 'incentive_fee_pct', header: 'Incentive Fee (% of GOP)', type: 'number' },
  { key: 'ffe_reserve_pct', header: 'FF&E Reserve (%)', type: 'number' },
  { key: 'minimum_guarantee_annual', header: 'Minimum Guarantee (₹/year)', type: 'number' },
  { key: 'owner_priority_annual', header: 'Owner Priority (₹/year)', type: 'number' },
  { key: 'key_money', header: 'Key Money (₹)', type: 'number' },
  { key: 'security_deposit_amount', header: 'Security Deposit (₹)', type: 'number' },
  { key: 'keys_covered', header: 'Keys Covered', type: 'number' },
];

const HOTEL_MONTH_COLUMNS = [
  { key: 'month', header: 'Month (YYYY-MM-DD, first of month)', type: 'date', required: true },
  { key: 'occupancy_pct', header: 'Occupancy (%)', type: 'number' },
  { key: 'adr', header: 'ADR (₹/night)', type: 'number' },
  { key: 'room_revenue', header: 'Room Revenue (₹)', type: 'number' },
  { key: 'fnb_revenue', header: 'F&B Revenue (₹)', type: 'number' },
  { key: 'other_revenue', header: 'Other Revenue (₹)', type: 'number' },
  { key: 'dept_expenses', header: 'Departmental Expenses (₹)', type: 'number' },
  { key: 'undistributed_expenses', header: 'Undistributed Expenses (₹)', type: 'number' },
  { key: 'gop', header: 'Gross Operating Profit (₹)', type: 'number' },
  { key: 'fees_paid', header: 'Management Fees (₹)', type: 'number' },
  { key: 'ffe_reserve', header: 'FF&E Reserve (₹)', type: 'number' },
  { key: 'owner_noi', header: 'Owner NOI / EBITDA (₹)', type: 'number' },
];

const IMPORT_COLUMNS_BY_KIND = Object.freeze({
  lease: LEASE_COLUMNS,
  sale: SALE_COLUMNS,
  occupant: OCCUPANT_COLUMNS,
  hotel_key_block: HOTEL_KEY_COLUMNS,
  hotel_contract: HOTEL_CONTRACT_COLUMNS,
  hotel_operating_month: HOTEL_MONTH_COLUMNS,
});

// One friendly worksheet name per kind (≤31 chars, no invalid Excel chars).
const KIND_SHEET_NAME = Object.freeze({
  lease: 'Rent Roll',
  sale: 'Sales & Collections',
  occupant: 'Occupants',
  hotel_key_block: 'Key Inventory',
  hotel_contract: 'Contracts',
  hotel_operating_month: 'Operating Months',
});

// Kinds that make up each family's template (a family with >1 kind gets one
// data sheet per kind). Mirrors RECORD_KINDS_BY_FAMILY in rentRoll.service.
const KINDS_BY_FAMILY = Object.freeze({
  lease_income: ['lease'],
  sales_collections: ['sale'],
  hotel_operating: ['hotel_key_block', 'hotel_contract', 'hotel_operating_month'],
  redevelopment: ['occupant', 'sale'],
});

module.exports = {
  TEMPLATE_VERSION,
  IMPORT_COLUMNS_BY_KIND,
  KIND_SHEET_NAME,
  KINDS_BY_FAMILY,
};
