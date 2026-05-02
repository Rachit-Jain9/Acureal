import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

let docsQuery;
let versionsQuery;
let pagesQuery;
let updateMetadataMock;
let preparePagesMock;

vi.mock('../../store/authStore', () => ({
  default: () => ({ user: { role: 'admin' } }),
}));

vi.mock('../../hooks/useMasterPlan', () => ({
  useZones: () => ({ data: [], isLoading: false }),
  useMasterPlanDocuments: () => docsQuery,
  useMasterPlanDocumentVersions: () => versionsQuery,
  useMasterPlanCorpus: () => ({
    data: [
      {
        canonical_name: 'volume-6-zoning-regulations.pdf',
        plan_name: 'RMP 2031 Volume 6 — Zoning Regulations',
        plan_version: 'RMP 2031 Provisional',
        doc_type: 'rmp_table',
        source_role: 'provisional_plan',
        legal_status: 'provisional',
        authority_name: 'Bangalore Development Authority',
        processing_mode: 'text_extraction',
        ocr_required: false,
        source_confidence: 0.85,
        uploaded: false,
        document: null,
      },
      {
        canonical_name: 'guidance-value.pdf',
        plan_name: 'BBMP Unit Area Value (UAV) — Property Tax Zones',
        plan_version: 'BBMP UAV',
        doc_type: 'bbmp_uav_pdf',
        source_role: 'property_tax_uav',
        legal_status: 'advisory',
        authority_name: 'Bruhat Bengaluru Mahanagara Palike',
        processing_mode: 'ocr_required',
        ocr_required: true,
        source_confidence: 0.8,
        uploaded: false,
        document: null,
      },
    ],
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useBbmpUavEntries: () => ({
    data: { schema_ready: true, rows: [] },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useImportZoneGeoJSON: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useLandUseIntelligence: () => ({
    data: {
      existing: [{ key: 'residential', label: 'Residential', value: 17.63, absolute_ha: 21284, year: 2015 }],
      proposed: [{ key: 'residential', label: 'Residential', value: 48.04, absolute_ha: 42486.39, year: 2031 }],
      totals: [{ key: 'bma_total_area', label: 'BMA Total Area', value: { value: 120697, unit: 'Ha' } }],
      callouts: [],
    },
    isLoading: false,
    isError: false,
  }),
  useDistrictIntelligence: () => ({
    data: {
      districts: [
        {
          id: 'd1', pd_code: 'PD-01', pd_name: 'CBD', is_sdz: false,
          population_2011: 593883, area_ha: 2774.3, gross_density_pph: 214,
          ward_count: 19, village_count: null, source_page: 23, source_section: null, raw_notes: null,
        },
      ],
      summary: { district_count: 1, sdz_count: 0, total_population_2011: 593883, total_area_ha: 2774, mean_density_pph: 214 },
      callouts: { sdz: null, heritage: null, ngt: null, regional_parks: null, landmarks: [], adjacent_authorities: [], peripheral_ring: null },
      disclaimer: 'AI-extracted.',
    },
    isLoading: false,
    isError: false,
  }),
  useCreateZone: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateZone: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReviewZone: () => ({ mutate: vi.fn() }),
  useUploadMasterPlanDocument: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useExtractMasterPlanDocument: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useExtractMasterPlanDocumentsBatch: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateMasterPlanDocumentMetadata: () => ({ mutateAsync: updateMetadataMock, isPending: false }),
  useMasterPlanDocumentPages: () => pagesQuery,
  usePrepareMasterPlanDocumentPages: () => ({ mutateAsync: preparePagesMock, isPending: false }),
  useOpenMasterPlanDocument: () => ({ mutate: vi.fn(), isPending: false }),
}));

import MasterPlanAdminPage from '../MasterPlanAdminPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <MasterPlanAdminPage />
    </MemoryRouter>,
  );
}

async function openSourceDocuments() {
  const user = userEvent.setup();
  renderPage();
  await act(async () => {
    await user.click(screen.getByRole('button', { name: /source documents/i }));
  });
}

describe('MasterPlanAdminPage source documents', () => {
  beforeEach(() => {
    docsQuery = {
      data: [],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    versionsQuery = {
      data: [],
      isLoading: false,
      isFetching: false,
      isError: false,
      refetch: vi.fn(),
    };
    pagesQuery = {
      data: { schema_ready: true, pages: [] },
      isLoading: false,
      isFetching: false,
      isError: false,
      refetch: vi.fn(),
    };
    updateMetadataMock = vi.fn().mockResolvedValue({});
    preparePagesMock = vi.fn().mockResolvedValue({});
  });

  it('renders controlled source intake and empty state', async () => {
    await openSourceDocuments();

    expect(await screen.findByText('Source document intake')).toBeInTheDocument();
    expect(screen.getByText('No master plan source documents')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /BBMP UAV \/ property tax/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /provisional plan/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /ocr required/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /upload source/i })).toBeDisabled();
  });

  it('renders queued extraction counts and source actions', async () => {
    docsQuery = {
      data: [{
        id: 'doc-1',
        city: 'Bengaluru',
        plan_name: 'RMP-Provisional',
        plan_version: 'RMP 2031 Draft',
        file_name: 'RMP-Provisional.pdf',
        doc_type: 'rmp_table',
        extraction_status: 'completed',
        source_role: 'provisional_plan',
        legal_status: 'provisional',
        authority_name: 'Bangalore Development Authority',
        processing_mode: 'ocr_required',
        ocr_required: true,
        text_coverage_ratio: 0.02,
        zones_extracted: 2,
        far_rules_extracted: 5,
        guidance_rows_extracted: 0,
        evidence_facts_extracted: 7,
      }, {
        id: 'doc-2',
        city: 'Bengaluru',
        plan_name: 'Volume-6 Zoning Regulations',
        plan_version: 'RMP 2031 Draft',
        file_name: 'Volume-6 Zoning Regulations.pdf',
        doc_type: 'rmp_table',
        extraction_status: 'completed',
        source_role: 'operative_regulation',
        legal_status: 'gazetted',
        authority_name: 'Bangalore Development Authority',
        processing_mode: 'text_extraction',
        ocr_required: false,
        text_coverage_ratio: 0.88,
        zones_extracted: 0,
        far_rules_extracted: 0,
        guidance_rows_extracted: 0,
        evidence_facts_extracted: 0,
      }],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };

    await openSourceDocuments();

    expect(await screen.findByText('Source document intake')).toBeInTheDocument();
    expect(screen.getByText('Source readiness')).toBeInTheDocument();
    expect(screen.getByText('RMP-Provisional')).toBeInTheDocument();
    expect(screen.getByText('Volume-6 Zoning Regulations')).toBeInTheDocument();
    expect(screen.getAllByText('queued for review').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Provisional').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Provisional plan').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Bangalore Development Authority').length).toBeGreaterThan(0);
    expect(screen.getAllByText('OCR needed').length).toBeGreaterThan(0);
    expect(screen.getByText('Text 2%')).toBeInTheDocument();
    expect(screen.getAllByText('OCR review').length).toBeGreaterThan(0);
    expect(screen.getByText('2 zones')).toBeInTheDocument();
    expect(screen.getByText('5 FAR')).toBeInTheDocument();
    expect(screen.getByText('7 facts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ocr review/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /re-extract/i })).toBeEnabled();
  });

  it('uses server readiness when the source row includes a readiness contract', async () => {
    docsQuery = {
      data: [{
        id: 'doc-contract',
        city: 'Bengaluru',
        plan_name: 'Index Map',
        plan_version: 'RMP 2031 Draft',
        file_name: 'Index Map.pdf',
        doc_type: 'rmp_table',
        extraction_status: 'pending',
        source_role: 'base_map',
        legal_status: 'draft',
        authority_name: 'Bangalore Development Authority',
        processing_mode: 'text_extraction',
        ocr_required: false,
        source_readiness: {
          key: 'manual',
          label: 'GIS review',
          tone: 'warn',
          description: 'Coordinate source needs GIS review before extraction',
          can_extract: false,
          action_label: 'GIS review',
          block_reason: 'GIS review must finish before extraction.',
        },
      }],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };

    await openSourceDocuments();

    expect(await screen.findByText('Index Map')).toBeInTheDocument();
    expect(screen.getAllByText('GIS review').length).toBeGreaterThan(0);
    expect(screen.getByText('Coordinate source needs GIS review before extraction')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: /gis review/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'GIS review must finish before extraction.');
  });

  it('shows source review history with previous metadata values', async () => {
    const user = userEvent.setup();
    docsQuery = {
      data: [{
        id: 'doc-1',
        city: 'Bengaluru',
        plan_name: 'RMP-Provisional',
        plan_version: 'RMP 2031 Draft',
        file_name: 'RMP-Provisional.pdf',
        doc_type: 'rmp_table',
        extraction_status: 'pending',
        source_role: 'provisional_plan',
        legal_status: 'provisional',
        authority_name: 'Bangalore Development Authority',
        processing_mode: 'text_extraction',
        ocr_required: false,
        text_coverage_ratio: 0.92,
      }],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    versionsQuery = {
      data: [{
        id: 'version-1',
        changed_by_name: 'Rachit Jain',
        changed_at: '2026-04-30T08:45:00.000Z',
        change_reason: 'source registry review',
        previous_values: {
          processing_mode: 'ocr_required',
          ocr_required: true,
          text_coverage_ratio: 0.02,
        },
      }],
      isLoading: false,
      isFetching: false,
      isError: false,
      refetch: vi.fn(),
    };

    await openSourceDocuments();
    await act(async () => {
      await user.click(screen.getByRole('button', { name: /review history rmp-provisional/i }));
    });

    const dialog = screen.getByRole('dialog', { name: /source review history/i });
    expect(within(dialog).getByText('Rachit Jain')).toBeInTheDocument();
    expect(within(dialog).getByText('source registry review')).toBeInTheDocument();
    expect(within(dialog).getByText('Previous Processing')).toBeInTheDocument();
    expect(within(dialog).getByText('OCR required')).toBeInTheDocument();
    expect(within(dialog).getByText('Previous OCR needed')).toBeInTheDocument();
    expect(within(dialog).getByText('Previous Text coverage')).toBeInTheDocument();
    expect(within(dialog).getByText('2%')).toBeInTheDocument();
  });

  it('shows page ledger rows for a source document', async () => {
    const user = userEvent.setup();
    docsQuery = {
      data: [{
        id: 'doc-1',
        city: 'Bengaluru',
        plan_name: 'RMP-Provisional',
        plan_version: 'RMP 2031 Draft',
        file_name: 'RMP-Provisional.pdf',
        doc_type: 'rmp_table',
        extraction_status: 'pending',
        source_role: 'provisional_plan',
        legal_status: 'provisional',
        authority_name: 'Bangalore Development Authority',
        processing_mode: 'ocr_required',
        ocr_required: true,
        text_coverage_ratio: 0.02,
        page_count: 2,
      }],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    pagesQuery = {
      data: {
        schema_ready: true,
        pages: [{
          id: 'page-1',
          page_number: 1,
          ocr_status: 'queued',
          review_status: 'needs_ocr',
          text_coverage_ratio: 0.02,
          confidence_score: 0.65,
        }, {
          id: 'page-2',
          page_number: 2,
          ocr_status: 'not_started',
          review_status: 'pending',
        }],
      },
      isLoading: false,
      isFetching: false,
      isError: false,
      refetch: vi.fn(),
    };

    await openSourceDocuments();
    await act(async () => {
      await user.click(screen.getByRole('button', { name: /page ledger rmp-provisional/i }));
    });

    const dialog = screen.getByRole('dialog', { name: /source page ledger/i });
    expect(within(dialog).getByText('Page 1')).toBeInTheDocument();
    expect(within(dialog).getByText('Page 2')).toBeInTheDocument();
    expect(within(dialog).getByText('needs ocr')).toBeInTheDocument();
    expect(within(dialog).getByText('Text 2%')).toBeInTheDocument();
    expect(within(dialog).getByText('Confidence 65%')).toBeInTheDocument();
  });

  it('prepares empty page rows before OCR and citation review', async () => {
    const user = userEvent.setup();
    docsQuery = {
      data: [{
        id: 'doc-1',
        city: 'Bengaluru',
        plan_name: 'RMP-Provisional',
        plan_version: 'RMP 2031 Draft',
        file_name: 'RMP-Provisional.pdf',
        doc_type: 'rmp_table',
        extraction_status: 'pending',
        source_role: 'provisional_plan',
        legal_status: 'provisional',
        authority_name: 'Bangalore Development Authority',
        processing_mode: 'ocr_required',
        ocr_required: true,
        text_coverage_ratio: 0.02,
        page_count: 2,
      }],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };

    await openSourceDocuments();
    await act(async () => {
      await user.click(screen.getByRole('button', { name: /page ledger rmp-provisional/i }));
    });

    const dialog = screen.getByRole('dialog', { name: /source page ledger/i });
    expect(within(dialog).getByText('No pages prepared yet.')).toBeInTheDocument();
    await act(async () => {
      await user.click(within(dialog).getByRole('button', { name: /prepare pages/i }));
    });

    expect(preparePagesMock).toHaveBeenCalledWith({ id: 'doc-1', pageCount: 2 });
  });

  it('lets reviewers mark an OCR source as text-ready', async () => {
    const user = userEvent.setup();
    docsQuery = {
      data: [{
        id: 'doc-1',
        city: 'Bengaluru',
        plan_name: 'RMP-Provisional',
        plan_version: 'RMP 2031 Draft',
        file_name: 'RMP-Provisional.pdf',
        doc_type: 'rmp_table',
        extraction_status: 'pending',
        source_role: 'provisional_plan',
        legal_status: 'provisional',
        authority_name: 'Bangalore Development Authority',
        processing_mode: 'ocr_required',
        ocr_required: true,
        text_coverage_ratio: 0.02,
        source_confidence: 0.65,
      }],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };

    await openSourceDocuments();
    await act(async () => {
      await user.click(screen.getByRole('button', { name: /review source rmp-provisional/i }));
    });

    const dialog = screen.getByRole('dialog', { name: /review source metadata/i });
    await act(async () => {
      await user.selectOptions(within(dialog).getByLabelText(/processing/i), 'text_extraction');
      await user.clear(within(dialog).getByLabelText(/text coverage/i));
      await user.type(within(dialog).getByLabelText(/text coverage/i), '92');
      await user.click(within(dialog).getByLabelText(/ocr needed/i));
      await user.click(within(dialog).getByRole('button', { name: /save review/i }));
    });

    expect(updateMetadataMock).toHaveBeenCalledWith({
      id: 'doc-1',
      data: expect.objectContaining({
        processingMode: 'text_extraction',
        ocrRequired: false,
        textCoverageRatio: 0.92,
        changeReason: 'source registry review',
      }),
    });
  });

  it('shows loading and failed states without document rows', async () => {
    docsQuery = {
      data: [],
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    };

    await openSourceDocuments();

    expect(screen.getByText('Failed to load source documents.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});

describe('MasterPlanAdminPage source corpus tab', () => {
  beforeEach(() => {
    docsQuery = {
      data: [],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    versionsQuery = {
      data: [],
      isLoading: false,
      isFetching: false,
      isError: false,
      refetch: vi.fn(),
    };
    pagesQuery = {
      data: { schema_ready: true, pages: [] },
      isLoading: false,
      isFetching: false,
      isError: false,
      refetch: vi.fn(),
    };
    updateMetadataMock = vi.fn().mockResolvedValue({});
    preparePagesMock = vi.fn().mockResolvedValue({});
  });

  it('renders the corpus checklist when the Source Corpus tab is selected', async () => {
    const user = userEvent.setup();
    renderPage();

    await act(async () => {
      await user.click(screen.getByRole('button', { name: /source corpus/i }));
    });

    expect(await screen.findByText(/Bengaluru RMP 2031 — expected sources/)).toBeInTheDocument();
    expect(screen.getByText('volume-6-zoning-regulations.pdf')).toBeInTheDocument();
    expect(screen.getByText('guidance-value.pdf')).toBeInTheDocument();
    expect(screen.getByText(/BBMP property tax — separate from IGR sale guidance/i)).toBeInTheDocument();
  });

  it('renders the BBMP UAV review queue when the BBMP UAV tab is selected', async () => {
    const user = userEvent.setup();
    renderPage();

    await act(async () => {
      await user.click(screen.getByRole('button', { name: /bbmp uav/i }));
    });

    expect(await screen.findByText(/Unit Area Value \(UAV\) review queue/i)).toBeInTheDocument();
    expect(screen.getByText(/Not IGR sale guidance/i)).toBeInTheDocument();
  });
});
