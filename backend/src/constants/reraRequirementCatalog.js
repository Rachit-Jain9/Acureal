'use strict';

/**
 * reraRequirementCatalog — the single declarative source of truth for the
 * Karnataka RERA readiness rule engine (Phase 4 / V1 substrate).
 *
 * This replaces the old inline `READINESS_BUCKETS` array in
 * karnatakaReraReadiness.service.js. Every requirement is *data*, not an
 * imperative overlay function. Tailoring per asset class / joint-development /
 * conditional NOC is expressed as `applies_when` predicates evaluated by
 * `services/rera/ruleEvaluator.js`. New regulatory items are added here only;
 * the engine, panel, DOCX and tests all read from this catalog.
 *
 * Same single-source-of-truth pattern the codebase already uses for
 * `frontend/src/utils/productGuide.js`.
 *
 * Item shape:
 *   {
 *     id, label, description, bucket,
 *     weight,            // 1..5 — drives the completeness score
 *     is_blocker,        // optional: a fatal gap that caps the score
 *     applies_when,      // optional: [{field, op, value}] AND-ed; absent = always
 *     detect,            // { approvalTypes, approvalNamePatterns, docNamePatterns,
 *                        //   docCategories, extractedFields } — matched against the deal
 *     recommended_action,// operational next step shown when missing/pending
 *     official_source,   // { label, url } — "verify on the K-RERA portal"
 *   }
 *
 * HARD RULE (CLAUDE.md): this catalog is an organisation aid. Items, labels and
 * recommended actions stay operational ("upload the EC") — never statutory
 * verdicts ("title is clear", "RERA-compliant").
 */

// ── Official-source pointers (K-RERA portal) ────────────────────────────────
const PORTAL = { label: 'Karnataka RERA portal', url: 'https://rera.karnataka.gov.in/' };
const DOWNLOADS = { label: 'K-RERA downloads (forms & formats)', url: 'https://rera.karnataka.gov.in/downloadPage' };
const PROJECT_REG = { label: 'K-RERA project registration', url: 'https://rera.karnataka.gov.in/initProjectRegistration' };

// ── Asset-class groupings used by `applies_when` predicates ─────────────────
const BUILDING_CLASSES = ['residential_apartments', 'villas', 'mixed_use', 'redevelopment', 'commercial_office', 'retail'];
const PLOTTED_CLASSES = ['plotted_development'];
const COMMERCIAL_CLASSES = ['commercial_office', 'retail', 'mixed_use'];

/**
 * ASSET_CLASS_RERA_NATURE — drives the applicability engine (NOT the checklist).
 *   'registrable'  : real-estate projects that sell apartments/plots/villas —
 *                    treated as potentially in-scope unless sale-intent is
 *                    explicitly false.
 *   'conditional'  : commercial / industrial — in-scope ONLY when units are
 *                    being sold/booked/marketed (the "wrongly assumed exempt"
 *                    case from the operator's vision doc).
 *   'rarely'       : hospitality / raw land — operated or held, not unit-sold;
 *                    likely exempt unless explicitly strata-sold.
 */
const ASSET_CLASS_RERA_NATURE = Object.freeze({
  residential_apartments: 'registrable',
  plotted_development: 'registrable',
  villas: 'registrable',
  mixed_use: 'registrable',
  redevelopment: 'registrable',
  commercial_office: 'conditional',
  retail: 'conditional',
  industrial_warehousing: 'conditional',
  hospitality: 'rarely',
  raw_land: 'rarely',
});

// ── Bucket metadata (render order) ──────────────────────────────────────────
const RERA_BUCKETS = [
  { id: 'application_declaration', label: 'Application & Declaration', description: 'K-RERA portal application forms and promoter declaration.' },
  { id: 'title_ownership', label: 'Title & Ownership', description: 'Title chain, encumbrance, mutation, conversion, guidance value.' },
  { id: 'jda_jv', label: 'JDA / Joint Development', description: 'Joint-development terms, landowner KYC, and co-promoter disclosure.' },
  { id: 'plan_approvals', label: 'Plan & Approvals', description: 'Sanctioned / layout plan, commencement certificate, structural safety.' },
  { id: 'project_specs', label: 'Project Specifications', description: 'Carpet area, unit / plot schedule, amenities, completion schedule.' },
  { id: 'statutory_nocs', label: 'Statutory NOCs', description: 'Fire, environment, water, sewage and power clearances (as applicable).' },
  { id: 'promoter_identity', label: 'Promoter Identity', description: 'Promoter PAN, GST, board resolution and Karnataka office.' },
  { id: 'previous_projects', label: 'Track Record & Litigation', description: 'Past-five-years projects and litigation disclosure (Section 4(2)(b)).' },
  { id: 'financial_disclosures', label: 'Financial Disclosures', description: 'Audited statements, ITR, project cost and CA certification.' },
  { id: 'escrow_finance', label: 'RERA Bank & Escrow Accounts', description: 'The 100% collection, 70% RERA escrow and 30% free accounts.' },
  { id: 'proforma_disclosures', label: 'Buyer-Facing Documents', description: 'Proforma allotment, agreement for sale, conveyance and brochure.' },
  { id: 'professional_certificates', label: 'Professional Certificates', description: 'Architect, engineer and CA appointments + Form-1/2/3.' },
];

// ── Requirements (flat, declarative) ────────────────────────────────────────
const RERA_REQUIREMENTS = [
  // ── Application & Declaration ──────────────────────────────────────────────
  {
    id: 'form_a_application', bucket: 'application_declaration',
    label: 'Form-A (Application for registration)',
    description: 'Submitted to the K-RERA online portal.',
    weight: 5,
    detect: { docNamePatterns: [/form[\s-]*a\b/i, /rera.*application/i] },
    recommended_action: 'Prepare Form-A on the K-RERA portal — it is generated from the project schedule + promoter details.',
    official_source: PROJECT_REG,
  },
  {
    id: 'form_b_declaration', bucket: 'application_declaration',
    label: 'Form-B (Promoter declaration)',
    description: 'Declaration of project details, schedule, and promoter undertaking.',
    weight: 5,
    detect: { docNamePatterns: [/form[\s-]*b\b/i, /promoter.*declaration/i] },
    recommended_action: 'Draft Form-B with the CA — the promoter undertaking. Notarised on Karnataka stamp paper.',
    official_source: DOWNLOADS,
  },
  {
    id: 'project_affidavit', bucket: 'application_declaration',
    label: 'Section 3(1) affidavit on stamp paper',
    description: 'Notarised promoter affidavit filed alongside Form-B.',
    weight: 3,
    detect: { docNamePatterns: [/affidavit/i] },
    recommended_action: 'Have your lawyer prepare the notarised affidavit on Karnataka stamp paper.',
    official_source: DOWNLOADS,
  },

  // ── Title & Ownership ──────────────────────────────────────────────────────
  {
    id: 'title_deed', bucket: 'title_ownership',
    label: 'Authenticated title deed',
    description: "Registered sale deed or grant establishing the promoter's title.",
    weight: 5, is_blocker: true,
    detect: { docNamePatterns: [/title.*deed/i, /sale.*deed/i, /\bgift.*deed\b/i, /\bgrant\b/i], docCategories: ['title_deed', 'sale_deed'] },
    recommended_action: 'Upload the registered title deed (PDF). Required for K-RERA Form-B.',
    official_source: PORTAL,
  },
  {
    id: 'legal_title_report', bucket: 'title_ownership',
    label: 'Legal title / search report (advocate)',
    description: "Advocate's title-search report on the chain of title.",
    weight: 4,
    detect: { docNamePatterns: [/title.*report/i, /search.*report/i, /advocate.*report/i, /title.*opinion/i], signoffRoles: ['advocate'] },
    recommended_action: 'Get an advocate to issue a title search report covering the chain of title (commonly 30+ years).',
    official_source: PORTAL,
  },
  {
    id: 'encumbrance_certificate', bucket: 'title_ownership',
    label: 'Encumbrance Certificate (EC)',
    description: '30-year EC from the sub-registrar showing no encumbrances.',
    weight: 5,
    detect: { docNamePatterns: [/encumbrance/i, /\bec\b/i], docCategories: ['encumbrance_certificate', 'ec'] },
    recommended_action: 'Obtain a 30-year EC (Form 15) from the sub-registrar to evidence clear title for K-RERA.',
    official_source: PORTAL,
  },
  {
    id: 'khata_certificate', bucket: 'title_ownership',
    label: 'Khata Certificate & Extract',
    description: "BBMP / BMRDA / Panchayat khata in the promoter's name.",
    weight: 4,
    detect: { approvalTypes: ['khata'], approvalNamePatterns: [/khata/i], docNamePatterns: [/khata/i] },
    recommended_action: 'Apply for Khata transfer to the promoter at BBMP / BMRDA.',
    official_source: PORTAL,
  },
  {
    id: 'mutation_records', bucket: 'title_ownership',
    label: 'Mutation records (RTC / Pahani)',
    description: 'Revenue records confirming mutation of ownership.',
    weight: 3,
    detect: { docNamePatterns: [/mutation/i, /\brtc\b/i, /\bpahani\b/i], docCategories: ['mutation_records', 'rtc'] },
    recommended_action: 'Pull the mutation extract from the village accountant / tahsildar (Form 11E for revenue land).',
    official_source: PORTAL,
  },
  {
    id: 'dc_conversion', bucket: 'title_ownership',
    label: 'DC Conversion Order (Agri → Non-Agri)',
    description: 'Required when the land was agricultural before development.',
    weight: 4,
    detect: { approvalTypes: ['conversion'], approvalNamePatterns: [/dc.*conversion/i, /agricultural.*non.*agricultural/i], docNamePatterns: [/dc.*conversion/i, /conversion.*order/i] },
    recommended_action: 'If the parcel was agricultural, obtain the DC conversion order from the Deputy Commissioner.',
    official_source: PORTAL,
  },
  {
    id: 'guidance_value_certificate', bucket: 'title_ownership',
    label: 'Guidance value certificate',
    description: 'Sub-registrar guidance (circle-rate) value for the parcel.',
    weight: 2,
    detect: { docNamePatterns: [/guidance.*value/i, /circle.*rate/i] },
    recommended_action: 'Obtain the guidance value certificate from the sub-registrar (Kaveri portal).',
    official_source: PORTAL,
  },

  // ── JDA / Joint Development (only when the deal is a joint development) ──────
  {
    id: 'registered_jda', bucket: 'jda_jv',
    label: 'Registered Joint Development Agreement',
    description: 'The registered JDA between landowner and developer.',
    weight: 5, is_blocker: true,
    applies_when: [{ field: 'isJoint', op: 'eq', value: true }],
    detect: { docNamePatterns: [/\bjda\b/i, /joint.*development/i, /development.*agreement/i] },
    recommended_action: 'Register the JDA at the sub-registrar — an unregistered JDA is a high-risk gap for K-RERA.',
    official_source: DOWNLOADS,
  },
  {
    id: 'jd_affidavit', bucket: 'jda_jv',
    label: 'JD affidavit-cum-declaration',
    description: 'Joint-development affidavit format prescribed by K-RERA.',
    weight: 4,
    applies_when: [{ field: 'isJoint', op: 'eq', value: true }],
    detect: { docNamePatterns: [/jd.*affidavit/i, /joint.*development.*affidavit/i] },
    recommended_action: 'Prepare the JD affidavit-cum-declaration (K-RERA downloads page) and notarise it.',
    official_source: DOWNLOADS,
  },
  {
    id: 'landowner_kyc', bucket: 'jda_jv',
    label: 'Landowner KYC (PAN / Aadhaar / address)',
    description: 'Identity and address proof of the landowner party.',
    weight: 3,
    applies_when: [{ field: 'isJoint', op: 'eq', value: true }],
    detect: { docNamePatterns: [/landowner.*kyc/i, /landowner.*pan/i, /landowner.*aadhaar/i, /owner.*id.*proof/i] },
    recommended_action: 'Collect the landowner PAN, Aadhaar and address proof for the JD declaration.',
    official_source: PORTAL,
  },
  {
    id: 'co_promoter_disclosure', bucket: 'jda_jv',
    label: 'Co-promoter disclosure',
    description: 'Where the landowner shares sale rights, both are promoters — disclose all.',
    weight: 3,
    applies_when: [{ field: 'isJoint', op: 'eq', value: true }],
    detect: { docNamePatterns: [/co.*promoter/i, /promoter.*disclosure/i] },
    recommended_action: 'List every co-promoter. If the landowner has sale rights under the JDA, they are a deemed promoter — flag for legal review.',
    official_source: PORTAL,
  },
  {
    id: 'jda_area_revenue_share', bucket: 'jda_jv',
    label: 'Area / revenue share schedule',
    description: 'Landowner vs developer allocation of units / revenue.',
    weight: 2,
    applies_when: [{ field: 'isJoint', op: 'eq', value: true }],
    detect: { docNamePatterns: [/area.*share/i, /revenue.*share/i, /allocation.*schedule/i, /sharing.*ratio/i] },
    recommended_action: 'Document the area / revenue share and landowner allocation inventory.',
    official_source: PORTAL,
  },

  // ── Plan & Approvals ───────────────────────────────────────────────────────
  {
    id: 'sanctioned_building_plan', bucket: 'plan_approvals',
    label: 'Sanctioned building plan (BBMP / BDA / BMRDA / BMICAPA)',
    description: 'Approved building plan with the planning-authority seal.',
    weight: 5, is_blocker: true,
    applies_when: [{ field: 'assetClass', op: 'in', value: BUILDING_CLASSES }],
    detect: { approvalTypes: ['building_plan'], approvalNamePatterns: [/sanctioned.*plan/i, /building.*plan/i], docNamePatterns: [/sanctioned.*plan/i, /building.*plan/i, /approved.*plan/i] },
    recommended_action: 'Submit the building plan to BBMP / BDA / BMRDA / BMICAPA and obtain the sanction seal.',
    official_source: PORTAL,
  },
  {
    id: 'commencement_certificate', bucket: 'plan_approvals',
    label: 'Building Commencement Certificate (BCC)',
    description: 'Issued by the planning authority after the sanctioned plan.',
    weight: 5, is_blocker: true,
    applies_when: [{ field: 'assetClass', op: 'in', value: BUILDING_CLASSES }],
    detect: { approvalTypes: ['building_plan'], approvalNamePatterns: [/commencement.*certificate/i, /\bbcc\b/i], docNamePatterns: [/commencement.*certificate/i, /\bbcc\b/i] },
    recommended_action: 'Apply for the BCC at the planning authority after the sanctioned plan + scrutiny fees. A K-RERA project can be registered only after plan approval + CC.',
    official_source: PORTAL,
  },
  {
    id: 'layout_approval', bucket: 'plan_approvals',
    label: 'Layout approval / technical sanction order',
    description: 'Approved layout / technical sanction for a plotted development.',
    weight: 5, is_blocker: true,
    applies_when: [{ field: 'assetClass', op: 'in', value: PLOTTED_CLASSES }],
    detect: { approvalTypes: ['planning', 'building_plan'], approvalNamePatterns: [/layout.*approval/i, /technical.*sanction/i, /layout.*plan/i], docNamePatterns: [/layout.*approval/i, /technical.*sanction/i, /approved.*layout/i] },
    recommended_action: 'Obtain the layout approval / technical sanction order from BDA / BMRDA / the planning authority.',
    official_source: PORTAL,
  },
  {
    id: 'plot_demarcation', bucket: 'plan_approvals',
    label: 'Demarcation plan & final release order',
    description: 'Plot demarcation plan and the final release / final approved layout.',
    weight: 3,
    applies_when: [{ field: 'assetClass', op: 'in', value: PLOTTED_CLASSES }],
    detect: { docNamePatterns: [/demarcation/i, /release.*order/i, /final.*approved.*layout/i] },
    recommended_action: 'Obtain the approved demarcation plan and final release order for the layout.',
    official_source: PORTAL,
  },
  {
    id: 'structural_safety_cert', bucket: 'plan_approvals',
    label: 'Structural safety certificate',
    description: 'Structural-stability certificate from a structural engineer.',
    weight: 4,
    applies_when: [{ field: 'assetClass', op: 'in', value: BUILDING_CLASSES }],
    detect: { docNamePatterns: [/structural.*safety/i, /structural.*stability/i, /structural.*certificate/i], signoffRoles: ['structural_engineer'] },
    recommended_action: 'Have the structural engineer issue the structural safety certificate for the building.',
    official_source: DOWNLOADS,
  },
  {
    id: 'cdp_zoning_certificate', bucket: 'plan_approvals',
    label: 'CDP / Master Plan zoning certificate',
    description: 'Confirms the parcel is zoned for the proposed use.',
    weight: 3,
    detect: { approvalTypes: ['planning'], approvalNamePatterns: [/cdp/i, /master.*plan.*zoning/i, /zoning.*certificate/i], docNamePatterns: [/cdp/i, /zoning.*certificate/i] },
    recommended_action: 'Get the CDP / master-plan zoning certificate from BDA / BBMP.',
    official_source: PORTAL,
  },

  // ── Project Specifications ─────────────────────────────────────────────────
  {
    id: 'unit_inventory', bucket: 'project_specs',
    label: 'Tower / block / unit inventory',
    description: 'Building-wise, floor-wise inventory of apartments / units.',
    weight: 3,
    applies_when: [{ field: 'assetClass', op: 'in', value: BUILDING_CLASSES }],
    detect: { docNamePatterns: [/unit.*inventory/i, /inventory.*schedule/i, /flat.*schedule/i, /tower.*schedule/i] },
    recommended_action: 'Prepare the tower/block/floor unit inventory with saleable unit count.',
    official_source: PROJECT_REG,
  },
  {
    id: 'carpet_area_schedule', bucket: 'project_specs',
    label: 'Carpet-area schedule (RERA-defined)',
    description: 'Carpet, balcony and open-terrace area per unit (not super built-up).',
    weight: 3,
    applies_when: [{ field: 'assetClass', op: 'in', value: BUILDING_CLASSES }],
    detect: { docNamePatterns: [/carpet.*area/i, /area.*statement/i, /area.*schedule/i] },
    recommended_action: 'Have the architect prepare the carpet-area schedule per unit — RERA prices are on carpet area.',
    official_source: PROJECT_REG,
  },
  {
    id: 'plot_schedule', bucket: 'project_specs',
    label: 'Plot schedule & common-area plan',
    description: 'Plot-wise schedule plus roads, parks and civic-amenity areas.',
    weight: 3,
    applies_when: [{ field: 'assetClass', op: 'in', value: PLOTTED_CLASSES }],
    detect: { docNamePatterns: [/plot.*schedule/i, /civic.*amenit/i, /roads.*plan/i, /utility.*corridor/i] },
    recommended_action: 'Prepare the plot schedule with roads, parks, utility corridors and civic-amenity areas.',
    official_source: PROJECT_REG,
  },
  {
    id: 'layout_with_specs', bucket: 'project_specs',
    label: 'Layout plan with specifications',
    description: 'Layout plan showing each unit / plot with specifications.',
    weight: 4,
    detect: { docNamePatterns: [/layout.*plan/i, /unit.*specification/i, /apartment.*specification/i], docCategories: ['layout_plan', 'unit_specifications'] },
    recommended_action: 'Prepare a layout plan with the unit / plot specification breakdown.',
    official_source: PROJECT_REG,
  },
  {
    id: 'amenities_list', bucket: 'project_specs',
    label: 'Amenities list with sizes',
    description: 'Common areas / amenities (clubhouse, gym, parking) with sqft.',
    weight: 2,
    detect: { docNamePatterns: [/amenit/i, /common.*areas/i] },
    recommended_action: 'Draft an amenities list with sizes — goes into Form-B.',
    official_source: PROJECT_REG,
  },
  {
    id: 'project_schedule', bucket: 'project_specs',
    label: 'Project schedule (start + completion)',
    description: 'Proposed commencement + handover dates declared in Form-B.',
    weight: 4,
    detect: { docNamePatterns: [/project.*schedule/i, /completion.*schedule/i, /\bgantt\b/i] },
    recommended_action: 'Lock the start + handover dates with the architect/engineer — RERA holds the promoter to these.',
    official_source: PROJECT_REG,
  },

  // ── Statutory NOCs ─────────────────────────────────────────────────────────
  {
    id: 'fire_noc', bucket: 'statutory_nocs',
    label: 'Fire NOC (Karnataka Fire & Emergency Services)',
    description: 'Required for residential / mixed-use / commercial buildings.',
    weight: 4,
    applies_when: [{ field: 'assetClass', op: 'in', value: BUILDING_CLASSES }],
    detect: { approvalTypes: ['fire_noc'], approvalNamePatterns: [/fire.*noc/i, /fire.*emergency/i], docNamePatterns: [/fire.*noc/i] },
    recommended_action: 'Apply at Karnataka Fire & Emergency Services — the NOC is valid until the expiry on the certificate.',
    official_source: PORTAL,
  },
  {
    id: 'environment_clearance', bucket: 'statutory_nocs',
    label: 'Environment Clearance (larger projects)',
    description: 'KSPCB / SEIAA clearance, typically for built-up > 20,000 sqm.',
    weight: 3,
    applies_when: [{ field: 'assetClass', op: 'in', value: BUILDING_CLASSES }],
    detect: { approvalTypes: ['environment'], approvalNamePatterns: [/environment.*clearance/i, /kspcb/i, /seiaa/i], docNamePatterns: [/environment.*clearance/i, /kspcb/i, /\bcfe\b/i, /seiaa/i] },
    recommended_action: 'If built-up area exceeds 20,000 sqm, apply for Environment Clearance via SEIAA (Karnataka).',
    official_source: PORTAL,
  },
  {
    id: 'water_noc', bucket: 'statutory_nocs',
    label: 'BWSSB / Panchayat water connection NOC',
    description: 'Confirms water-supply provisioning for the project.',
    weight: 3,
    detect: { approvalTypes: ['water_sewage', 'water'], approvalNamePatterns: [/bwssb.*water/i, /water.*noc/i, /water.*connection/i], docNamePatterns: [/bwssb.*water/i, /water.*noc/i] },
    recommended_action: 'Apply to BWSSB (BBMP limits) or the Gram Panchayat (BMRDA limits) for the water-connection NOC.',
    official_source: PORTAL,
  },
  {
    id: 'sewage_noc', bucket: 'statutory_nocs',
    label: 'BWSSB sewage connection NOC',
    description: 'Sewage / sewerage provisioning NOC.',
    weight: 2,
    applies_when: [{ field: 'assetClass', op: 'in', value: BUILDING_CLASSES }],
    detect: { approvalTypes: ['water_sewage', 'sewage'], approvalNamePatterns: [/bwssb.*sewage/i, /sewage.*noc/i, /sewerage/i], docNamePatterns: [/sewage.*noc/i, /sewerage/i] },
    recommended_action: 'Apply to BWSSB for the sewage NOC.',
    official_source: PORTAL,
  },
  {
    id: 'power_noc', bucket: 'statutory_nocs',
    label: 'BESCOM power connection / NOC',
    description: 'Power-supply provisioning NOC from BESCOM.',
    weight: 3,
    detect: { approvalTypes: ['power'], approvalNamePatterns: [/bescom.*power/i, /power.*noc/i, /power.*connection/i], docNamePatterns: [/bescom.*power/i, /power.*noc/i] },
    recommended_action: 'Apply to BESCOM for the power-connection NOC.',
    official_source: PORTAL,
  },

  // ── Promoter Identity ──────────────────────────────────────────────────────
  {
    id: 'promoter_pan', bucket: 'promoter_identity',
    label: 'Promoter PAN',
    description: 'PAN of the promoting entity (individual / firm / LLP / company).',
    weight: 5,
    detect: { docNamePatterns: [/promoter.*pan/i, /\bpan.*card/i], extractedFields: ['promoter_pan'] },
    recommended_action: "Upload the promoter's PAN card — required for Form-B.",
    official_source: PROJECT_REG,
  },
  {
    id: 'promoter_gst', bucket: 'promoter_identity',
    label: 'Promoter GST registration',
    description: 'GST registration certificate of the promoting entity.',
    weight: 4,
    detect: { docNamePatterns: [/\bgst\b/i, /goods.*services.*tax/i], extractedFields: ['promoter_gst', 'gstin'] },
    recommended_action: 'Upload the GST registration certificate.',
    official_source: PROJECT_REG,
  },
  {
    id: 'authorized_signatory_pan', bucket: 'promoter_identity',
    label: 'Authorized signatory PAN',
    description: 'PAN of the authorized signatory (company promoters).',
    weight: 2,
    detect: { docNamePatterns: [/authorized.*signatory/i, /director.*pan/i] },
    recommended_action: 'Upload the PAN of the authorized signatory (director / partner).',
    official_source: PROJECT_REG,
  },
  {
    id: 'board_resolution', bucket: 'promoter_identity',
    label: 'Board resolution / authorization',
    description: 'Authorising the project + signatory (company / LLP promoters).',
    weight: 3,
    detect: { docNamePatterns: [/board.*resolution/i, /authorization.*letter/i, /power.*of.*attorney/i] },
    recommended_action: 'Pass a board resolution / authorization authorising the project + signatory; upload the signed minutes.',
    official_source: PROJECT_REG,
  },
  {
    id: 'registered_office_ka', bucket: 'promoter_identity',
    label: 'Karnataka registered office / address proof',
    description: 'A registered office address within Karnataka.',
    weight: 3,
    detect: { docNamePatterns: [/registered.*office/i, /address.*proof/i] },
    recommended_action: 'Provide the promoter address proof — K-RERA requires a registered office within Karnataka.',
    official_source: PROJECT_REG,
  },

  // ── Track Record & Litigation ──────────────────────────────────────────────
  {
    id: 'past_projects_disclosure', bucket: 'previous_projects',
    label: 'Past 5-years projects disclosure',
    description: 'Brief of projects launched in the last five years (Section 4(2)(b)).',
    weight: 3,
    detect: { docNamePatterns: [/past.*projects/i, /previous.*projects/i, /project.*history/i, /track.*record/i] },
    recommended_action: 'Disclose all projects in the last 5 years with status, delays and completion certificates.',
    official_source: PROJECT_REG,
  },
  {
    id: 'litigation_disclosure', bucket: 'previous_projects',
    label: 'Litigation / complaint disclosure',
    description: 'Pending / concluded litigation and complaints on past projects.',
    weight: 3,
    detect: { docNamePatterns: [/litigation/i, /court.*case/i, /complaint.*status/i, /non.*litigation.*affidavit/i] },
    recommended_action: 'Disclose all litigation (case number, court, status) and any complaints on previous projects. Suppression can void registration.',
    official_source: PROJECT_REG,
  },

  // ── Financial Disclosures ──────────────────────────────────────────────────
  {
    id: 'audited_financials', bucket: 'financial_disclosures',
    label: 'Audited financial statements (3 yrs)',
    description: 'Balance sheet, P&L, cash flow and auditor report for last 3 FYs.',
    weight: 3,
    detect: { docNamePatterns: [/balance.*sheet/i, /profit.*loss/i, /\bp&l\b/i, /audited.*financ/i, /cash.*flow/i, /auditor.*report/i] },
    recommended_action: 'Upload the last 3 years of audited financial statements (B/S, P&L, cash flow, auditor report).',
    official_source: PROJECT_REG,
  },
  {
    id: 'itr_filings', bucket: 'financial_disclosures',
    label: 'Income-tax returns (3 yrs)',
    description: 'ITR acknowledgements for the last three financial years.',
    weight: 2,
    detect: { docNamePatterns: [/\bitr\b/i, /income.*tax.*return/i] },
    recommended_action: 'Upload the last 3 years of ITR acknowledgements.',
    official_source: PROJECT_REG,
  },
  {
    id: 'project_cost_ca_cert', bucket: 'financial_disclosures',
    label: 'Project cost — CA certificate (Form-1)',
    description: 'CA-certified total project cost and 70%-deposit confirmation.',
    weight: 4,
    detect: { docNamePatterns: [/form[\s-]*1\b/i, /ca.*certificate/i, /project.*cost.*certificate/i], extractedFields: ['project_cost'], signoffRoles: ['ca'] },
    recommended_action: 'Have the CA issue the Form-1 project-cost certificate (cost breakdown + 70% escrow confirmation).',
    official_source: DOWNLOADS,
  },
  {
    id: 'project_cost_breakup', bucket: 'financial_disclosures',
    label: 'Project cost break-up',
    description: 'Land, construction, infrastructure, finance and contingency split.',
    weight: 2,
    detect: { docNamePatterns: [/cost.*breakup/i, /cost.*break.*up/i, /cost.*estimate/i, /cost.*sheet/i] },
    recommended_action: 'Prepare a detailed project cost break-up — feeds the CA Form-1 certificate.',
    official_source: PROJECT_REG,
  },

  // ── RERA Bank Accounts ─────────────────────────────────────────────────────
  {
    id: 'rera_escrow_account', bucket: 'escrow_finance',
    label: '70% RERA escrow account (no-lien)',
    description: 'The separate account where 70% of receivables must flow.',
    weight: 5, is_blocker: true,
    detect: { docNamePatterns: [/escrow/i, /rera.*account/i, /70.*account/i], extractedFields: ['escrow_bank_account', 'escrow_account_number'] },
    recommended_action: 'Open a no-lien RERA escrow account at a scheduled bank (named with the project) before applying — non-negotiable for K-RERA.',
    official_source: PORTAL,
  },
  {
    id: 'collection_account_100', bucket: 'escrow_finance',
    label: '100% collection account',
    description: 'The account into which all allottee collections are received.',
    weight: 2,
    detect: { docNamePatterns: [/100.*account/i, /collection.*account/i], extractedFields: ['collection_account'] },
    recommended_action: 'Open the 100% collection account; share the IFSC + account number in Form-B.',
    official_source: PORTAL,
  },
  {
    id: 'free_account_30', bucket: 'escrow_finance',
    label: '30% free account',
    description: 'The account holding the 30% non-escrow share.',
    weight: 1,
    detect: { docNamePatterns: [/30.*account/i, /free.*account/i], extractedFields: ['free_account'] },
    recommended_action: 'Open the 30% free account for the non-escrow share.',
    official_source: PORTAL,
  },
  {
    id: 'bank_affidavit', bucket: 'escrow_finance',
    label: 'Bank notarised affidavit',
    description: 'Bank affidavit confirming the RERA account terms.',
    weight: 3,
    detect: { docNamePatterns: [/bank.*affidavit/i, /bank.*letter/i, /no.*lien/i, /cancelled.*cheque/i], signoffRoles: ['banker'] },
    recommended_action: 'Get the bank notarised affidavit / letter confirming the no-lien RERA account.',
    official_source: DOWNLOADS,
  },

  // ── Buyer-facing documents ─────────────────────────────────────────────────
  {
    id: 'proforma_agreement_sale', bucket: 'proforma_disclosures',
    label: 'Proforma agreement for sale',
    description: 'Template agreement for sale per the RERA-prescribed format.',
    weight: 3,
    detect: { docNamePatterns: [/agreement.*for.*sale/i, /agreement.*of.*sale/i, /proforma.*agreement/i, /sale.*agreement/i] },
    recommended_action: 'Prepare the proforma agreement for sale (K-RERA format) — terms cannot be one-sided against the buyer.',
    official_source: DOWNLOADS,
  },
  {
    id: 'proforma_allotment', bucket: 'proforma_disclosures',
    label: 'Proforma allotment letter',
    description: 'Template allotment letter issued to buyers on booking.',
    weight: 2,
    detect: { docNamePatterns: [/allotment.*letter/i, /proforma.*allotment/i] },
    recommended_action: 'Prepare the proforma allotment letter (unit details, payment schedule, possession timeline).',
    official_source: DOWNLOADS,
  },
  {
    id: 'proforma_conveyance', bucket: 'proforma_disclosures',
    label: 'Proforma conveyance deed',
    description: 'Template deed of transfer on completion + full payment.',
    weight: 1,
    detect: { docNamePatterns: [/conveyance.*deed/i, /proforma.*conveyance/i] },
    recommended_action: 'Prepare the proforma conveyance deed for the final transfer of title.',
    official_source: DOWNLOADS,
  },
  {
    id: 'brochure_specs', bucket: 'proforma_disclosures',
    label: 'Brochure & specifications',
    description: 'Marketing brochure + specifications (must match the sanctioned plan).',
    weight: 1,
    detect: { docNamePatterns: [/brochure/i, /specification/i, /\bspecs\b/i] },
    recommended_action: 'Prepare the brochure + specifications; keep amenity / area claims consistent with the sanctioned plan.',
    official_source: PROJECT_REG,
  },

  // ── Professional Certificates ──────────────────────────────────────────────
  {
    id: 'architect_appointment', bucket: 'professional_certificates',
    label: 'Architect appointment (COA-registered) + Form-2',
    description: 'COA-registered architect appointed; Form-2 architect certificate.',
    weight: 3,
    detect: { docNamePatterns: [/architect.*appoint/i, /architect.*letter/i, /\bcoa\b/i, /form[\s-]*2\b/i], signoffRoles: ['architect'] },
    recommended_action: 'Appoint a COA-registered architect; upload the appointment letter + Form-2 certificate.',
    official_source: DOWNLOADS,
  },
  {
    id: 'engineer_appointment', bucket: 'professional_certificates',
    label: 'Engineer appointment + Form-3',
    description: 'Structural / project engineer appointed; Form-3 engineer certificate.',
    weight: 3,
    detect: { docNamePatterns: [/engineer.*appoint/i, /engineer.*letter/i, /structural.*engineer/i, /form[\s-]*3\b/i], signoffRoles: ['engineer'] },
    recommended_action: 'Appoint the engineer; upload the appointment letter + Form-3 certificate.',
    official_source: DOWNLOADS,
  },
  {
    id: 'ca_appointment', bucket: 'professional_certificates',
    label: 'Chartered Accountant appointment',
    description: 'CA appointed — handles Form-1 + the quarterly Form-4 attestation.',
    weight: 3,
    detect: { docNamePatterns: [/\bca\b.*appoint/i, /chartered.*accountant/i], signoffRoles: ['ca'] },
    recommended_action: 'Appoint a CA (different from the statutory auditor for withdrawal certificates); upload the appointment letter.',
    official_source: DOWNLOADS,
  },
];

/**
 * Informational conditional clearances — surfaced as "consider if applicable"
 * rather than scored items, so the checklist stays honest (NOCs are not all
 * mandatory). These get a real predicate / scored item in a later phase once
 * the triggering inputs (proximity, height, terrain) are captured.
 */
const CONDITIONAL_NOC_NOTES = [
  { id: 'airport_height', label: 'Airport height clearance (AAI)', when: 'Project within an airport funnel / height-restricted zone.' },
  { id: 'metro_bmrcl', label: 'BMRCL / Namma Metro interface', when: 'Project abutting a metro corridor.' },
  { id: 'lift_noc', label: 'Lift authority NOC', when: 'High-rise building with lifts.' },
  { id: 'crz', label: 'CRZ clearance', when: 'Coastal / tidal-influence zone (rare in Bengaluru).' },
  { id: 'factory_explosives', label: 'Factories / Explosives NOC', when: 'Industrial / warehouse with hazardous storage.' },
];

// Flat id index for fast lookups.
const REQUIREMENT_INDEX = (() => {
  const idx = new Map();
  for (const item of RERA_REQUIREMENTS) idx.set(item.id, item);
  return idx;
})();

module.exports = {
  RERA_BUCKETS,
  RERA_REQUIREMENTS,
  REQUIREMENT_INDEX,
  ASSET_CLASS_RERA_NATURE,
  CONDITIONAL_NOC_NOTES,
  BUILDING_CLASSES,
  PLOTTED_CLASSES,
  COMMERCIAL_CLASSES,
  // source pointers (reused by UI / DOCX labels)
  PORTAL,
  DOWNLOADS,
  PROJECT_REG,
};
