'use strict';

// Bengaluru master-plan source corpus manifest.
//
// OPERATIVE plan = Revised Master Plan 2015 (RMP 2015), Volume III Zoning
// Regulations (BDA; approved vide G.O. UDD 540 BEM AA SE 2004 dated
// 22-06-2007). The RMP 2031 entries below are a WITHDRAWN draft — provisional
// approval was withdrawn by the Karnataka govt in July 2020 and the plan was
// never notified. They are retained only so legacy uploads still classify;
// their legal_status is 'withdrawn' and no number from them is operative.
//
// The 12 entries below are the authoritative classification for the official
// regulatory inputs that feed REDIP's parcel-intelligence and rule extraction.
// Each entry carries the canonical role, legal status, authority, processing
// mode, and reviewer notes — but never any extracted facts. When an admin
// uploads a file whose name matches one of the manifest aliases, the upload
// confirmation endpoint applies these defaults, so reviewers do not have to
// re-classify well-known files by hand.
//
// Important: Guidance Value.pdf is BBMP Unit Area Value (property tax zoning),
// NOT IGR sale guidance. The manifest enforces that separation so tax-zone
// rows never leak into regulatory_data.guidance_values.
//
// To extend the corpus, add a new entry with a unique canonical_name. Aliases
// must stay lowercase, with extension. Page counts are intentionally null
// until a real file is reviewed — never guess.

const path = require('path');

const RMP_2031_PLAN_VERSION = 'RMP 2031 Provisional';
const RMP_2015_PLAN_VERSION = 'RMP 2015';

const MANIFEST = Object.freeze([
  {
    canonical_name: 'rmp-2015-volume-3-zoning-regulations.pdf',
    aliases: [
      'zoning_regulations_rmp2015f.pdf',
      'rmp 2015 volume 3.pdf',
      'rmp-2015-volume-iii.pdf',
      'revised master plan 2015 volume iii.pdf',
      'rmp2015 zoning regulations.pdf',
    ],
    plan_name: 'RMP 2015 Volume III — Zoning of Land Use and Regulations (OPERATIVE)',
    plan_version: RMP_2015_PLAN_VERSION,
    doc_type: 'rmp_table',
    source_role: 'operative_regulation',
    legal_status: 'gazetted',
    authority_name: 'Bangalore Development Authority',
    processing_mode: 'text_extraction',
    ocr_required: false,
    source_confidence: 1.0,
    registry_notes: 'OPERATIVE statutory zoning rulebook. Approved vide G.O. UDD 540 BEM AA SE 2004 dated 22-06-2007. Primary source for FAR / ground coverage / setbacks / buffers / TDR. Seeded by migration 20260701_rmp2015_zonal_regulations_seed.',
  },
  {
    canonical_name: 'rmp-2015-zoning-amendment-2015.pdf',
    aliases: [
      'udd 105 mnj 2008.pdf',
      'rmp 2015 amendment 2015.pdf',
      'zoning regulations amendment 2015.pdf',
    ],
    plan_name: 'RMP 2015 Zoning Regulations — Amendment (Karnataka Gazette 23-03-2015)',
    plan_version: RMP_2015_PLAN_VERSION,
    doc_type: 'rmp_table',
    source_role: 'operative_regulation',
    legal_status: 'gazetted',
    authority_name: 'Urban Development Department, Govt. of Karnataka',
    processing_mode: 'text_extraction',
    ocr_required: false,
    source_confidence: 1.0,
    registry_notes: 'Amendment to RMP 2015 zonal regulations. Notification No. UDD 105 MNJ 2008 dated 20-03-2015. Amends commercial / ancillary-use rules in residential zones by ring & road width.',
  },
  {
    canonical_name: 'volume-6-zoning-regulations.pdf',
    aliases: ['volume-6 zoning regulations.pdf', 'volume_6_zoning_regulations.pdf', 'volume6-zoning.pdf'],
    plan_name: 'RMP 2031 Volume 6 — Zoning Regulations',
    plan_version: RMP_2031_PLAN_VERSION,
    doc_type: 'rmp_table',
    source_role: 'provisional_plan',
    legal_status: 'draft',
    authority_name: 'Bangalore Development Authority',
    processing_mode: 'text_extraction',
    ocr_required: false,
    source_confidence: 0.0,
    registry_notes: 'WITHDRAWN DRAFT — RMP 2031 was never notified (provisional approval withdrawn Jul 2020). Superseded by the operative RMP 2015 Vol III. Retained for legacy-upload classification only; do NOT promote any FAR/setback/buffer number from this file.',
  },
  {
    canonical_name: 'master-plan.docx',
    aliases: [
      'master plan.docx',
      'master_plan.docx',
      'master plan.pdf',
      'master_plan.pdf',
      'master-plan.pdf',
    ],
    plan_name: 'RMP 2031 Master Plan Document',
    plan_version: RMP_2031_PLAN_VERSION,
    doc_type: 'rmp_table',
    source_role: 'provisional_plan',
    legal_status: 'provisional',
    authority_name: 'Bangalore Development Authority',
    processing_mode: 'text_extraction',
    ocr_required: false,
    source_confidence: 0.8,
    registry_notes: 'Draft RMP narrative (Word source — also accepted as PDF). Cross-reference with Volume 6 before promoting any rule to a deal record.',
  },
  {
    canonical_name: 'rmp-provisional.pdf',
    aliases: ['rmp-provisional.pdf', 'rmp_provisional.pdf'],
    plan_name: 'RMP 2031 Provisional Master Plan',
    plan_version: RMP_2031_PLAN_VERSION,
    doc_type: 'rmp_table',
    source_role: 'provisional_plan',
    legal_status: 'provisional',
    authority_name: 'Bangalore Development Authority',
    processing_mode: 'ocr_required',
    ocr_required: true,
    source_confidence: 0.7,
    registry_notes: 'Image-only provisional master plan. Run OCR before any rule extraction; do not auto-promote facts.',
  },
  {
    canonical_name: 'volume-1-vision-document.pdf',
    aliases: ['volume-1 vision document.pdf', 'volume-1 vision docu.pdf', 'volume_1_vision.pdf'],
    plan_name: 'RMP 2031 Volume 1 — Vision Document',
    plan_version: RMP_2031_PLAN_VERSION,
    doc_type: 'rmp_table',
    source_role: 'supporting_dataset',
    legal_status: 'advisory',
    authority_name: 'Bangalore Development Authority',
    processing_mode: 'text_extraction',
    ocr_required: false,
    source_confidence: 0.7,
    registry_notes: 'Strategic vision and city context. Reference only — never quote as a regulatory rule.',
  },
  {
    canonical_name: 'volume-3-master-plan-document.pdf',
    aliases: ['volume-3 master plan document.pdf', 'volume_3_master_plan.pdf'],
    plan_name: 'RMP 2031 Volume 3 — Master Plan Document',
    plan_version: RMP_2031_PLAN_VERSION,
    doc_type: 'rmp_table',
    source_role: 'provisional_plan',
    legal_status: 'provisional',
    authority_name: 'Bangalore Development Authority',
    processing_mode: 'text_extraction',
    ocr_required: false,
    source_confidence: 0.8,
    registry_notes: 'Master plan narrative. Cross-check Volume 6 for binding controls before promoting facts.',
  },
  {
    canonical_name: 'volume-4-pdr.pdf',
    aliases: ['volume-4 pdr.pdf', 'volume_4_pdr.pdf'],
    plan_name: 'RMP 2031 Volume 4 — Planning District Reports',
    plan_version: RMP_2031_PLAN_VERSION,
    doc_type: 'rmp_table',
    source_role: 'supporting_dataset',
    legal_status: 'provisional',
    authority_name: 'Bangalore Development Authority',
    processing_mode: 'text_extraction',
    ocr_required: false,
    source_confidence: 0.75,
    registry_notes: 'Planning district intelligence. Use for district context, not as a substitute for zone-level rules.',
  },
  {
    canonical_name: 'rmp-database-used.pdf',
    aliases: ['rmp_database used.pdf', 'rmp_database_used.pdf', 'rmp-database-used.pdf'],
    plan_name: 'RMP 2031 Database Used (reference)',
    plan_version: RMP_2031_PLAN_VERSION,
    doc_type: 'rmp_table',
    source_role: 'supporting_dataset',
    legal_status: 'advisory',
    authority_name: 'Bangalore Development Authority',
    processing_mode: 'text_extraction',
    ocr_required: false,
    source_confidence: 0.6,
    registry_notes: 'Reference dataset description. Treat as supporting only — verify before quoting any number.',
  },
  {
    canonical_name: 'index-map.pdf',
    aliases: ['index map.pdf', 'index_map.pdf'],
    plan_name: 'RMP 2031 Index Map',
    plan_version: RMP_2031_PLAN_VERSION,
    doc_type: 'rmp_table',
    source_role: 'base_map',
    legal_status: 'provisional',
    authority_name: 'Bangalore Development Authority',
    processing_mode: 'image_review',
    ocr_required: false,
    source_confidence: 0.7,
    registry_notes: 'Sheet layout / map index. Visual reference; do not infer parcel-level geometry.',
  },
  {
    canonical_name: 'existing-land-use.pdf',
    aliases: ['existing land use.pdf', 'existing_land_use.pdf'],
    plan_name: 'RMP 2031 Existing Land Use Map',
    plan_version: RMP_2031_PLAN_VERSION,
    doc_type: 'rmp_table',
    source_role: 'base_map',
    legal_status: 'provisional',
    authority_name: 'Bangalore Development Authority',
    processing_mode: 'image_review',
    ocr_required: false,
    source_confidence: 0.7,
    registry_notes: 'Existing land-use map. Use for district context only; geometries must come from a reviewed GeoJSON, not raster inference.',
  },
  {
    canonical_name: 'proposed-land-use.pdf',
    aliases: ['proposed land use.pdf', 'proposed_land_use.pdf'],
    plan_name: 'RMP 2031 Proposed Land Use Map',
    plan_version: RMP_2031_PLAN_VERSION,
    doc_type: 'rmp_table',
    source_role: 'land_use_schedule',
    legal_status: 'provisional',
    authority_name: 'Bangalore Development Authority',
    processing_mode: 'image_review',
    ocr_required: false,
    source_confidence: 0.7,
    registry_notes: 'Proposed land-use map. Use as planning context; never substitute for zone-level rules from Volume 6.',
  },
  {
    canonical_name: 'guidance-value.pdf',
    aliases: ['guidance value.pdf', 'guidance_value.pdf'],
    plan_name: 'BBMP Unit Area Value (UAV) — Property Tax Zones',
    plan_version: 'BBMP UAV',
    doc_type: 'bbmp_uav_pdf',
    source_role: 'property_tax_uav',
    legal_status: 'advisory',
    authority_name: 'Bruhat Bengaluru Mahanagara Palike',
    // Corrected 2026-06-10: the file is a 686-page TEXT-LAYER PDF (gazette
    // notification + UAV rate tables + residential/non-residential street
    // registers), not a scan. The earlier ocr_required default made the UI
    // demand OCR forever even after extraction completed.
    processing_mode: 'text_extraction',
    ocr_required: false,
    source_confidence: 0.9,
    registry_notes: 'BBMP property-tax Unit Area Value gazette (Notification No. 384, 09-Mar-2016; 686 pages, text layer). Pages 1-16: notification + rate Tables I & II (route to bbmp_uav_entries). Pages 17-362: RESIDENTIAL street->zone register; 363-686: NON-RESIDENTIAL register (route to bbmp_street_index with the register tag; parser: scripts/parse-bbmp-uav-register.py). NOT an IGR sale guidance dataset — never route to guidance_values.',
  },
  {
    canonical_name: 'grok-guidance-value-remarks.docx',
    aliases: ['grok guidance value remarks.docx', 'grok_guidance_value_remarks.docx'],
    plan_name: 'Guidance Value Remarks (analyst notes)',
    plan_version: 'Analyst notes',
    doc_type: 'guidance_value_report',
    source_role: 'derived_notes',
    legal_status: 'user_supplied',
    authority_name: 'Internal analyst',
    processing_mode: 'manual_entry',
    ocr_required: false,
    source_confidence: 0.4,
    registry_notes: 'AI/analyst-generated remarks. Reference only. Do not promote any number from this file without independent verification.',
  },
]);

const BBMP_UAV_CANONICAL_NAME = 'guidance-value.pdf';

const ALIAS_INDEX = (() => {
  const map = new Map();
  for (const entry of MANIFEST) {
    map.set(entry.canonical_name, entry);
    for (const alias of entry.aliases) {
      map.set(alias.toLowerCase(), entry);
    }
  }
  return map;
})();

function normalizeFileName(rawName) {
  if (rawName === null || rawName === undefined) return '';
  const base = path.basename(String(rawName)).toLowerCase().trim();
  if (!base) return '';
  return base.replace(/\s+/g, ' ');
}

function findCorpusEntry(rawName) {
  const normalized = normalizeFileName(rawName);
  if (!normalized) return null;

  if (ALIAS_INDEX.has(normalized)) {
    return ALIAS_INDEX.get(normalized);
  }

  const collapsed = normalized.replace(/\s+/g, '-');
  if (ALIAS_INDEX.has(collapsed)) {
    return ALIAS_INDEX.get(collapsed);
  }

  const underscored = normalized.replace(/\s+/g, '_');
  if (ALIAS_INDEX.has(underscored)) {
    return ALIAS_INDEX.get(underscored);
  }

  return null;
}

// Returns the manifest defaults for a filename, with caller-supplied values
// taking precedence. Used by confirmSourceDocumentUpload to auto-classify
// well-known corpus files without overriding explicit reviewer choices.
function applyCorpusDefaults({ fileName, requested = {} }) {
  const entry = findCorpusEntry(fileName);
  if (!entry) return { matched: false, payload: requested };

  const merged = { ...requested };
  const fields = [
    'planName',
    'planVersion',
    'docType',
    'sourceRole',
    'legalStatus',
    'authorityName',
    'processingMode',
    'sourceConfidence',
    'registryNotes',
  ];
  const camelToManifest = {
    planName: 'plan_name',
    planVersion: 'plan_version',
    docType: 'doc_type',
    sourceRole: 'source_role',
    legalStatus: 'legal_status',
    authorityName: 'authority_name',
    processingMode: 'processing_mode',
    sourceConfidence: 'source_confidence',
    registryNotes: 'registry_notes',
  };

  for (const field of fields) {
    const provided = merged[field];
    if (provided === undefined || provided === null || provided === '') {
      merged[field] = entry[camelToManifest[field]];
    }
  }

  if (merged.ocrRequired === undefined || merged.ocrRequired === null || merged.ocrRequired === '') {
    merged.ocrRequired = entry.ocr_required;
  }

  return {
    matched: true,
    canonical_name: entry.canonical_name,
    payload: merged,
  };
}

// Throws when a Guidance Value.pdf upload is mis-classified as IGR guidance.
// Keeps BBMP UAV separated from IGR sale guidance values at the API edge.
function assertCorpusClassification({ fileName, docType }) {
  const entry = findCorpusEntry(fileName);
  if (!entry) return;
  if (entry.canonical_name !== BBMP_UAV_CANONICAL_NAME) return;

  if (docType && docType !== entry.doc_type) {
    const error = new Error(
      'Guidance Value.pdf is BBMP Unit Area Value (property tax). Route it to bbmp_uav_pdf, not IGR guidance.',
    );
    error.statusCode = 400;
    throw error;
  }
}

function buildCorpusStatus(documents = []) {
  const lookup = new Map();
  for (const doc of documents) {
    const fileName = doc?.file_name || doc?.plan_name;
    const entry = findCorpusEntry(fileName);
    if (!entry) continue;
    const existing = lookup.get(entry.canonical_name);
    const docCreated = doc?.created_at ? new Date(doc.created_at).getTime() : 0;
    const existingCreated = existing?.created_at ? new Date(existing.created_at).getTime() : -1;
    if (!existing || docCreated > existingCreated) {
      lookup.set(entry.canonical_name, doc);
    }
  }

  return MANIFEST.map((entry) => {
    const matchedDoc = lookup.get(entry.canonical_name) || null;
    return {
      canonical_name: entry.canonical_name,
      plan_name: entry.plan_name,
      plan_version: entry.plan_version,
      doc_type: entry.doc_type,
      source_role: entry.source_role,
      legal_status: entry.legal_status,
      authority_name: entry.authority_name,
      processing_mode: entry.processing_mode,
      ocr_required: entry.ocr_required,
      source_confidence: entry.source_confidence,
      registry_notes: entry.registry_notes,
      uploaded: Boolean(matchedDoc),
      document: matchedDoc
        ? {
          id: matchedDoc.id,
          plan_name: matchedDoc.plan_name,
          file_name: matchedDoc.file_name,
          extraction_status: matchedDoc.extraction_status,
          source_role: matchedDoc.source_role,
          legal_status: matchedDoc.legal_status,
          processing_mode: matchedDoc.processing_mode,
          ocr_required: Boolean(matchedDoc.ocr_required),
          source_confidence: matchedDoc.source_confidence,
          created_at: matchedDoc.created_at,
        }
        : null,
    };
  });
}

module.exports = {
  MANIFEST,
  BBMP_UAV_CANONICAL_NAME,
  findCorpusEntry,
  applyCorpusDefaults,
  assertCorpusClassification,
  buildCorpusStatus,
};
