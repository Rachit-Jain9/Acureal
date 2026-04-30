import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

let docsQuery;
let updateMetadataMock;

vi.mock('../../store/authStore', () => ({
  default: () => ({ user: { role: 'admin' } }),
}));

vi.mock('../../hooks/useMasterPlan', () => ({
  useZones: () => ({ data: [], isLoading: false }),
  useMasterPlanDocuments: () => docsQuery,
  useCreateZone: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateZone: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReviewZone: () => ({ mutate: vi.fn() }),
  useUploadMasterPlanDocument: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useExtractMasterPlanDocument: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateMasterPlanDocumentMetadata: () => ({ mutateAsync: updateMetadataMock, isPending: false }),
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
    updateMetadataMock = vi.fn().mockResolvedValue({});
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
