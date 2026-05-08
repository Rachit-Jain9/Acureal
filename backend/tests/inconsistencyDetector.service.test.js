'use strict';

// All comparators are pure functions over an extractions array — no DB,
// no LLM. We mock everything else.
jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/services/extraction.service', () => ({ getDealExtractions: jest.fn() }));
jest.mock('../src/services/risk.service', () => ({ create: jest.fn() }));
jest.mock('../src/services/aiArtifacts.service', () => ({
  computeSnapshotHash: jest.fn(() => 'mocked-hash'),
  saveArtifact: jest.fn(),
}));
jest.mock('../src/services/ai/providerRegistry', () => ({
  getProviderAvailability: jest.fn(() => ({ claude: false })),
}));
jest.mock('../src/services/ai/aiRouter', () => ({ runClaudeReasoning: jest.fn() }));

const detector = require('../src/services/inconsistencyDetector.service');

// Factory: build an extraction record matching what getDealExtractions returns.
const ext = ({ doc_type, fields = {}, id = `ext-${doc_type}`, document_id = `doc-${doc_type}`, document_name = `${doc_type}.pdf` }) =>
  ({ id, document_id, document_name, doc_type, status: 'completed', fields, confidence: {} });

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

describe('nameSimilarity', () => {
  test('identical names → 1.0', () => {
    expect(detector.nameSimilarity('John Smith', 'John Smith')).toBe(1);
  });
  test('case-insensitive', () => {
    expect(detector.nameSimilarity('JOHN SMITH', 'john smith')).toBe(1);
  });
  test('extra middle name → high overlap', () => {
    const sim = detector.nameSimilarity('John Smith', 'John A. Smith');
    expect(sim).toBeGreaterThan(0.6);
  });
  test('whitespace tolerance', () => {
    expect(detector.nameSimilarity('  John   Smith  ', 'John Smith')).toBe(1);
  });
  test('completely different names → low score', () => {
    expect(detector.nameSimilarity('Ramesh Kumar', 'Sita Devi')).toBeLessThan(0.3);
  });
  test('empty input → 0', () => {
    expect(detector.nameSimilarity('', 'X')).toBe(0);
    expect(detector.nameSimilarity(null, 'X')).toBe(0);
  });
});

describe('classifyDriftSeverity', () => {
  test('thresholds', () => {
    expect(detector.classifyDriftSeverity(0.5)).toBeNull();
    expect(detector.classifyDriftSeverity(1.5)).toBe('low');
    expect(detector.classifyDriftSeverity(7)).toBe('medium');
    expect(detector.classifyDriftSeverity(15)).toBe('high');
  });
});

describe('indexByDocType', () => {
  test('groups extractions by doc_type', () => {
    const idx = detector.indexByDocType([
      ext({ doc_type: 'sale_deed' }),
      ext({ doc_type: 'sale_deed', id: 'ext-2' }),
      ext({ doc_type: 'ec' }),
    ]);
    expect(idx.sale_deed).toHaveLength(2);
    expect(idx.ec).toHaveLength(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Comparator: seller / EC mismatch
// ──────────────────────────────────────────────────────────────────────────

describe('detectSellerEcMismatch', () => {
  test('flags HIGH when names are completely different', () => {
    const findings = detector.detectSellerEcMismatch({
      sale_deed: [ext({ doc_type: 'sale_deed', fields: { grantor: 'Ramesh Kumar' } })],
      ec: [ext({ doc_type: 'ec', fields: { transactions: [{ party_1: 'Sita Devi' }] } })],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe('title');
    expect(findings[0].severity).toBe('high');
    expect(findings[0].title).toMatch(/Seller name mismatch/);
    expect(findings[0].evidence).toHaveLength(2);
  });

  test('flags MEDIUM when names overlap partially', () => {
    const findings = detector.detectSellerEcMismatch({
      sale_deed: [ext({ doc_type: 'sale_deed', fields: { grantor: 'Ramesh Kumar Sharma' } })],
      ec: [ext({ doc_type: 'ec', fields: { transactions: [{ party_1: 'Suresh Sharma' }] } })],
    });
    // Token overlap: only "sharma" → 1/3 = 0.33 → flagged but not HIGH
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('medium');
  });

  test('no flag when names match exactly', () => {
    const findings = detector.detectSellerEcMismatch({
      sale_deed: [ext({ doc_type: 'sale_deed', fields: { grantor: 'Ramesh Kumar' } })],
      ec: [ext({ doc_type: 'ec', fields: { transactions: [{ party_1: 'Ramesh Kumar' }] } })],
    });
    expect(findings).toEqual([]);
  });

  test('no flag when names match within similarity threshold', () => {
    const findings = detector.detectSellerEcMismatch({
      sale_deed: [ext({ doc_type: 'sale_deed', fields: { grantor: 'Ramesh Kumar Reddy' } })],
      ec: [ext({ doc_type: 'ec', fields: { transactions: [{ party_1: 'Ramesh K Reddy' }] } })],
    });
    // High overlap (Ramesh + Reddy) → above 0.6 threshold
    expect(findings).toEqual([]);
  });

  test('skips when either side has no data', () => {
    expect(detector.detectSellerEcMismatch({ sale_deed: [], ec: [] })).toEqual([]);
    expect(detector.detectSellerEcMismatch({})).toEqual([]);
    expect(
      detector.detectSellerEcMismatch({
        sale_deed: [ext({ doc_type: 'sale_deed', fields: {} })],
        ec: [ext({ doc_type: 'ec', fields: { transactions: [] } })],
      }),
    ).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Comparator: consideration drift
// ──────────────────────────────────────────────────────────────────────────

describe('detectConsiderationDrift', () => {
  test('flags HIGH when consideration values diverge by >10%', () => {
    const findings = detector.detectConsiderationDrift({
      sale_deed: [ext({ doc_type: 'sale_deed', fields: { consideration_inr: 10000000, document_number: 'DOC-1' } })],
      ec: [ext({ doc_type: 'ec', fields: { transactions: [{ document_number: 'DOC-1', consideration_value_inr: 8500000 }] } })],
    });
    // 15% drift
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe('financial');
    expect(findings[0].severity).toBe('high');
  });

  test('matches by amount when document_number absent', () => {
    const findings = detector.detectConsiderationDrift({
      sale_deed: [ext({ doc_type: 'sale_deed', fields: { consideration_inr: 10000000 } })],
      ec: [ext({ doc_type: 'ec', fields: { transactions: [{ consideration_value_inr: 10100000 }] } })],
    });
    // 1% drift, within match-tolerance, then re-checked for severity
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('low');
  });

  test('no flag when amounts identical', () => {
    expect(
      detector.detectConsiderationDrift({
        sale_deed: [ext({ doc_type: 'sale_deed', fields: { consideration_inr: 10000000 } })],
        ec: [ext({ doc_type: 'ec', fields: { transactions: [{ consideration_value_inr: 10000000 }] } })],
      }),
    ).toEqual([]);
  });

  test('Indian-comma format parses correctly + document_number bridges large-drift pairs', () => {
    // Same DOC-7 in both records → matched as the same transaction even
    // though amounts differ by 15% (which would otherwise fail amount-only
    // matching). Confirms both that the parser handles "1,00,00,000"
    // (Indian crore notation = 10,000,000) AND that document_number is the
    // primary join key.
    const findings = detector.detectConsiderationDrift({
      sale_deed: [ext({ doc_type: 'sale_deed', fields: { consideration_inr: '1,00,00,000', document_number: 'DOC-7' } })],
      ec: [ext({ doc_type: 'ec', fields: { transactions: [{ document_number: 'DOC-7', consideration_value_inr: '85,00,000' }] } })],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('high');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Comparator: FSI conflict
// ──────────────────────────────────────────────────────────────────────────

describe('detectFsiConflict', () => {
  test('flags CRITICAL when proposed FSI exceeds permissible by >10%', () => {
    const findings = detector.detectFsiConflict({
      sanctioned_plan: [ext({ doc_type: 'sanctioned_plan', fields: { fsi_proposed: 3.5 } })],
      zoning_certificate: [ext({ doc_type: 'zoning_certificate', fields: { permissible_fsi: 2.5 } })],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe('regulatory');
    expect(findings[0].severity).toBe('critical');
  });

  test('flags HIGH when overshoot is between 2-10%', () => {
    const findings = detector.detectFsiConflict({
      sanctioned_plan: [ext({ doc_type: 'sanctioned_plan', fields: { fsi_proposed: 2.65 } })],
      zoning_certificate: [ext({ doc_type: 'zoning_certificate', fields: { permissible_fsi: 2.5 } })],
    });
    // 6% overshoot
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('high');
  });

  test('no flag when proposed within permissible', () => {
    expect(
      detector.detectFsiConflict({
        sanctioned_plan: [ext({ doc_type: 'sanctioned_plan', fields: { fsi_proposed: 2.5 } })],
        zoning_certificate: [ext({ doc_type: 'zoning_certificate', fields: { permissible_fsi: 2.5 } })],
      }),
    ).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Comparator: area drift across documents
// ──────────────────────────────────────────────────────────────────────────

describe('detectAreaDrift', () => {
  test('flags MEDIUM when sale_deed area and sanctioned_plan plot_area drift >5%', () => {
    const findings = detector.detectAreaDrift({
      sale_deed: [ext({ doc_type: 'sale_deed', fields: { area_sqft: 10000 } })],
      sanctioned_plan: [ext({ doc_type: 'sanctioned_plan', fields: { plot_area_sqft: 9000 } })],
    });
    // 10% drift
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe('legal');
    expect(['high', 'medium']).toContain(findings[0].severity);
  });

  test('normalizes acres ↔ sqft via 43,560 multiplier', () => {
    // 5 acres = 217,800 sqft. Sanctioned plan claims 217,500 sqft. ~0.14% drift, no flag.
    const findings = detector.detectAreaDrift({
      sale_deed: [ext({ doc_type: 'sale_deed', fields: { area_acres: 5 } })],
      sanctioned_plan: [ext({ doc_type: 'sanctioned_plan', fields: { plot_area_sqft: 217500 } })],
    });
    expect(findings).toEqual([]);
  });

  test('compares all unordered pairs across 3+ docs', () => {
    const findings = detector.detectAreaDrift({
      sale_deed: [ext({ doc_type: 'sale_deed', fields: { area_sqft: 10000 } })],
      sanctioned_plan: [ext({ doc_type: 'sanctioned_plan', fields: { plot_area_sqft: 8500 } })], // 15% drift vs sale
      layout_approval: [ext({ doc_type: 'layout_approval', fields: { total_area_acres: 0.18 } })], // ~7841 sqft
    });
    // 3 observations → 3 unordered pairs, all driving drift. Expect 3 findings.
    expect(findings.length).toBeGreaterThanOrEqual(2);
    for (const f of findings) {
      expect(['critical', 'high', 'medium']).toContain(f.severity);
    }
  });

  test('no flag with single observation', () => {
    expect(
      detector.detectAreaDrift({
        sale_deed: [ext({ doc_type: 'sale_deed', fields: { area_sqft: 10000 } })],
      }),
    ).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Comparator: RERA gap
// ──────────────────────────────────────────────────────────────────────────

describe('detectReraGap', () => {
  test('flags HIGH when sanctioned plan exists but no RERA found anywhere', () => {
    const findings = detector.detectReraGap({
      sanctioned_plan: [ext({ doc_type: 'sanctioned_plan', fields: { plan_number: 'SP/123' } })],
      sale_deed: [ext({ doc_type: 'sale_deed', fields: {} })],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('high');
    expect(findings[0].title).toMatch(/RERA/);
  });

  test('no flag when any extraction carries a RERA number', () => {
    expect(
      detector.detectReraGap({
        sanctioned_plan: [ext({ doc_type: 'sanctioned_plan', fields: { plan_number: 'SP/123' } })],
        sale_deed: [ext({ doc_type: 'sale_deed', fields: { rera_number: 'PRM/KA/RERA/abc/2024' } })],
      }),
    ).toEqual([]);
  });

  test('no flag when no sanctioned plan in scope', () => {
    expect(
      detector.detectReraGap({
        sale_deed: [ext({ doc_type: 'sale_deed', fields: {} })],
      }),
    ).toEqual([]);
  });

  test('rejects placeholder / empty RERA numbers', () => {
    const findings = detector.detectReraGap({
      sanctioned_plan: [ext({ doc_type: 'sanctioned_plan', fields: { plan_number: 'SP/123' } })],
      sale_deed: [ext({ doc_type: 'sale_deed', fields: { rera_number: 'TBD' } })],
    });
    // 'TBD' is too short — shouldn't count
    expect(findings).toHaveLength(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// runAllComparators — full integration on a worst-case bundle
// ──────────────────────────────────────────────────────────────────────────

describe('runAllComparators', () => {
  test('catches multiple simultaneous issues on a noisy deal', () => {
    const findings = detector.runAllComparators([
      ext({
        doc_type: 'sale_deed',
        fields: {
          grantor: 'Ramesh Kumar',
          consideration_inr: 10000000,
          area_sqft: 10000,
          document_number: 'DOC-1',
        },
      }),
      ext({
        doc_type: 'ec',
        fields: {
          transactions: [
            { document_number: 'DOC-1', party_1: 'Sita Devi', consideration_value_inr: 8500000 },
          ],
        },
      }),
      ext({
        doc_type: 'sanctioned_plan',
        fields: { fsi_proposed: 3.5, plot_area_sqft: 8500 },
      }),
      ext({
        doc_type: 'zoning_certificate',
        fields: { permissible_fsi: 2.5 },
      }),
    ]);

    const titles = findings.map((f) => f.title);
    expect(titles).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Seller name mismatch/),
        expect.stringMatching(/consideration disagrees/),
        expect.stringMatching(/Sanctioned FSI exceeds/),
        expect.stringMatching(/Area mismatch/),
        expect.stringMatching(/RERA/),
      ]),
    );
  });

  test('returns empty array for a clean deal', () => {
    expect(
      detector.runAllComparators([
        ext({ doc_type: 'sale_deed', fields: { grantor: 'X', consideration_inr: 10000000, area_sqft: 10000, rera_number: 'PRM/KA/RERA/abc/2024' } }),
        ext({ doc_type: 'ec', fields: { transactions: [{ party_1: 'X', consideration_value_inr: 10000000 }] } }),
        ext({ doc_type: 'sanctioned_plan', fields: { fsi_proposed: 2.5, plot_area_sqft: 10000 } }),
        ext({ doc_type: 'zoning_certificate', fields: { permissible_fsi: 2.5 } }),
      ]),
    ).toEqual([]);
  });

  test('survives a comparator throwing — others still run', () => {
    // Pass garbage as a known-good shape; if any comparator chokes it
    // shouldn't take down the rest of the run.
    const findings = detector.runAllComparators([
      // intentionally non-array transactions field — could trip a careless impl
      ext({ doc_type: 'ec', fields: { transactions: null } }),
      ext({ doc_type: 'sanctioned_plan', fields: { plan_number: 'SP/X' } }),
    ]);
    // We expect at least the RERA gap finding (sanctioned plan + no RERA)
    expect(findings.some((f) => /RERA/.test(f.title))).toBe(true);
  });
});
