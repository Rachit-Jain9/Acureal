'use strict';

const corpus = require('../src/services/masterplanCorpus');

describe('masterplanCorpus manifest', () => {
  test('exposes 14 canonical entries with required classification fields', () => {
    expect(corpus.MANIFEST).toHaveLength(14);
    for (const entry of corpus.MANIFEST) {
      expect(entry.canonical_name).toMatch(/\.(pdf|docx)$/);
      expect(entry.plan_name).toEqual(expect.any(String));
      expect(entry.source_role).toEqual(expect.any(String));
      expect(entry.legal_status).toEqual(expect.any(String));
      expect(entry.processing_mode).toEqual(expect.any(String));
      expect(entry.authority_name).toEqual(expect.any(String));
    }
  });

  test('canonical names are unique across the manifest', () => {
    const seen = new Set();
    for (const entry of corpus.MANIFEST) {
      expect(seen.has(entry.canonical_name)).toBe(false);
      seen.add(entry.canonical_name);
    }
  });

  test('Volume 6 (RMP 2031 draft) is withdrawn; operative RMP 2015 Vol III is present', () => {
    const entry = corpus.findCorpusEntry('Volume-6 Zoning Regulations.pdf');
    expect(entry).not.toBeNull();
    expect(entry.legal_status).toBe('draft');
    expect(entry.source_role).toBe('provisional_plan');

    const operative = corpus.findCorpusEntry('Zoning_Regulations_RMP2015f.pdf');
    expect(operative).not.toBeNull();
    expect(operative.legal_status).toBe('gazetted');
    expect(operative.source_role).toBe('operative_regulation');
    expect(operative.plan_version).toBe('RMP 2015');
  });

  test('RMP-Provisional.pdf is OCR-required and provisional', () => {
    const entry = corpus.findCorpusEntry('RMP-Provisional.pdf');
    expect(entry).not.toBeNull();
    expect(entry.processing_mode).toBe('ocr_required');
    expect(entry.ocr_required).toBe(true);
    expect(entry.legal_status).toBe('provisional');
  });

  test('Guidance Value.pdf is BBMP UAV, NEVER IGR sale guidance', () => {
    const entry = corpus.findCorpusEntry('Guidance Value.pdf');
    expect(entry).not.toBeNull();
    expect(entry.doc_type).toBe('bbmp_uav_pdf');
    expect(entry.source_role).toBe('property_tax_uav');
    expect(entry.authority_name).toBe('Bruhat Bengaluru Mahanagara Palike');
    expect(entry.plan_version).toBe('BBMP UAV');
  });

  test('GROK Guidance Value Remarks is derived notes / advisory', () => {
    const entry = corpus.findCorpusEntry('GROK Guidance Value Remarks.docx');
    expect(entry).not.toBeNull();
    expect(entry.source_role).toBe('derived_notes');
    expect(entry.processing_mode).toBe('manual_entry');
  });

  test('findCorpusEntry returns null for unknown files', () => {
    expect(corpus.findCorpusEntry('Some Random File.pdf')).toBeNull();
    expect(corpus.findCorpusEntry('')).toBeNull();
    expect(corpus.findCorpusEntry(null)).toBeNull();
    expect(corpus.findCorpusEntry(undefined)).toBeNull();
  });

  test('findCorpusEntry tolerates spaces, dashes, and underscores', () => {
    const e1 = corpus.findCorpusEntry('Volume-6 Zoning Regulations.pdf');
    const e2 = corpus.findCorpusEntry('volume_6_zoning_regulations.pdf');
    const e3 = corpus.findCorpusEntry('VOLUME-6 ZONING REGULATIONS.PDF');
    expect(e1?.canonical_name).toBe('volume-6-zoning-regulations.pdf');
    expect(e2?.canonical_name).toBe('volume-6-zoning-regulations.pdf');
    expect(e3?.canonical_name).toBe('volume-6-zoning-regulations.pdf');
  });

  test('Master Plan auto-classifies for both .docx source and .pdf export', () => {
    const docxEntry = corpus.findCorpusEntry('Master Plan.docx');
    const pdfEntry = corpus.findCorpusEntry('Master Plan.pdf');
    const underscoredPdf = corpus.findCorpusEntry('Master_Plan.pdf');
    expect(docxEntry?.canonical_name).toBe('master-plan.docx');
    expect(pdfEntry?.canonical_name).toBe('master-plan.docx');
    expect(underscoredPdf?.canonical_name).toBe('master-plan.docx');
    expect(pdfEntry?.source_role).toBe('provisional_plan');
    expect(pdfEntry?.processing_mode).toBe('text_extraction');
  });

  test('findCorpusEntry strips path prefixes', () => {
    const entry = corpus.findCorpusEntry('/tmp/uploads/Master Plan.docx');
    expect(entry?.canonical_name).toBe('master-plan.docx');
  });
});

describe('applyCorpusDefaults', () => {
  test('fills missing fields from manifest when filename matches', () => {
    const result = corpus.applyCorpusDefaults({
      fileName: 'Volume-6 Zoning Regulations.pdf',
      requested: {},
    });
    expect(result.matched).toBe(true);
    expect(result.canonical_name).toBe('volume-6-zoning-regulations.pdf');
    expect(result.payload.docType).toBe('rmp_table');
    expect(result.payload.sourceRole).toBe('provisional_plan');
    expect(result.payload.legalStatus).toBe('draft');
    expect(result.payload.processingMode).toBe('text_extraction');
    expect(result.payload.ocrRequired).toBe(false);
  });

  test('reviewer-supplied values override manifest defaults', () => {
    const result = corpus.applyCorpusDefaults({
      fileName: 'Volume-6 Zoning Regulations.pdf',
      requested: {
        legalStatus: 'gazetted',
        sourceConfidence: 0.99,
      },
    });
    expect(result.matched).toBe(true);
    expect(result.payload.legalStatus).toBe('gazetted');
    expect(result.payload.sourceConfidence).toBe(0.99);
    expect(result.payload.docType).toBe('rmp_table');
  });

  test('returns matched:false when filename is unknown', () => {
    const result = corpus.applyCorpusDefaults({
      fileName: 'Random Upload.pdf',
      requested: { docType: 'rmp_table' },
    });
    expect(result.matched).toBe(false);
    expect(result.payload.docType).toBe('rmp_table');
  });

  test('marks RMP-Provisional.pdf as ocr_required:true', () => {
    const result = corpus.applyCorpusDefaults({
      fileName: 'RMP-Provisional.pdf',
      requested: {},
    });
    expect(result.matched).toBe(true);
    expect(result.payload.ocrRequired).toBe(true);
    expect(result.payload.processingMode).toBe('ocr_required');
  });

  test('classifies Guidance Value.pdf as BBMP UAV', () => {
    const result = corpus.applyCorpusDefaults({
      fileName: 'Guidance Value.pdf',
      requested: {},
    });
    expect(result.matched).toBe(true);
    expect(result.payload.docType).toBe('bbmp_uav_pdf');
    expect(result.payload.sourceRole).toBe('property_tax_uav');
    expect(result.payload.authorityName).toBe('Bruhat Bengaluru Mahanagara Palike');
  });
});

describe('assertCorpusClassification', () => {
  test('throws when Guidance Value.pdf is mis-classified as IGR guidance', () => {
    expect(() => corpus.assertCorpusClassification({
      fileName: 'Guidance Value.pdf',
      docType: 'igr_guidance_pdf',
    })).toThrow(/BBMP/);
  });

  test('allows Guidance Value.pdf as bbmp_uav_pdf', () => {
    expect(() => corpus.assertCorpusClassification({
      fileName: 'Guidance Value.pdf',
      docType: 'bbmp_uav_pdf',
    })).not.toThrow();
  });

  test('allows Guidance Value.pdf with no docType (manifest fills it)', () => {
    expect(() => corpus.assertCorpusClassification({
      fileName: 'Guidance Value.pdf',
      docType: null,
    })).not.toThrow();
    expect(() => corpus.assertCorpusClassification({
      fileName: 'Guidance Value.pdf',
      docType: undefined,
    })).not.toThrow();
  });

  test('does not throw for unknown filenames', () => {
    expect(() => corpus.assertCorpusClassification({
      fileName: 'Random Upload.pdf',
      docType: 'igr_guidance_pdf',
    })).not.toThrow();
  });
});

describe('buildCorpusStatus', () => {
  test('marks every manifest entry as not uploaded when documents list is empty', () => {
    const status = corpus.buildCorpusStatus([]);
    expect(status).toHaveLength(14);
    for (const item of status) {
      expect(item.uploaded).toBe(false);
      expect(item.document).toBeNull();
    }
  });

  test('matches uploaded documents to manifest by filename', () => {
    const docs = [
      {
        id: 'doc-vol6',
        plan_name: 'RMP 2031 Volume 6 — Zoning Regulations',
        file_name: 'Volume-6 Zoning Regulations.pdf',
        extraction_status: 'pending',
        source_role: 'provisional_plan',
        legal_status: 'provisional',
        processing_mode: 'text_extraction',
        ocr_required: false,
        source_confidence: 0.85,
        created_at: '2026-04-30T10:00:00Z',
      },
      {
        id: 'doc-bbmp',
        plan_name: 'BBMP UAV',
        file_name: 'Guidance Value.pdf',
        extraction_status: 'pending',
        created_at: '2026-04-30T11:00:00Z',
      },
    ];
    const status = corpus.buildCorpusStatus(docs);
    const vol6 = status.find((s) => s.canonical_name === 'volume-6-zoning-regulations.pdf');
    const guidance = status.find((s) => s.canonical_name === 'guidance-value.pdf');
    expect(vol6.uploaded).toBe(true);
    expect(vol6.document.id).toBe('doc-vol6');
    expect(guidance.uploaded).toBe(true);
    expect(guidance.document.id).toBe('doc-bbmp');
  });

  test('keeps the most recent document when multiple uploads share the same canonical name', () => {
    const docs = [
      {
        id: 'old',
        file_name: 'Volume-6 Zoning Regulations.pdf',
        created_at: '2026-04-29T10:00:00Z',
      },
      {
        id: 'new',
        file_name: 'volume_6_zoning_regulations.pdf',
        created_at: '2026-04-30T10:00:00Z',
      },
    ];
    const status = corpus.buildCorpusStatus(docs);
    const vol6 = status.find((s) => s.canonical_name === 'volume-6-zoning-regulations.pdf');
    expect(vol6.uploaded).toBe(true);
    expect(vol6.document.id).toBe('new');
  });

  test('ignores documents that do not match any manifest entry', () => {
    const docs = [{ id: 'random', file_name: 'Random.pdf', created_at: '2026-04-30T10:00:00Z' }];
    const status = corpus.buildCorpusStatus(docs);
    expect(status.every((item) => item.uploaded === false)).toBe(true);
  });
});
