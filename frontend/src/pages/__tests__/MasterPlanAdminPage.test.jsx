import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

let docsQuery;

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
        plan_name: 'Volume-6 Zoning Regulations',
        plan_version: 'RMP 2031 Draft',
        file_name: 'Volume-6 Zoning Regulations.pdf',
        doc_type: 'rmp_table',
        extraction_status: 'completed',
        source_role: 'draft_plan',
        legal_status: 'draft',
        authority_name: 'Bangalore Development Authority',
        processing_mode: 'text_extraction',
        ocr_required: true,
        text_coverage_ratio: 0.35,
        zones_extracted: 2,
        far_rules_extracted: 5,
        guidance_rows_extracted: 0,
        evidence_facts_extracted: 7,
      }],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };

    await openSourceDocuments();

    expect(await screen.findByText('Source document intake')).toBeInTheDocument();
    expect(screen.getByText('Volume-6 Zoning Regulations')).toBeInTheDocument();
    expect(screen.getByText('queued for review')).toBeInTheDocument();
    expect(screen.getAllByText('Draft').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Draft plan').length).toBeGreaterThan(0);
    expect(screen.getByText('Bangalore Development Authority')).toBeInTheDocument();
    expect(screen.getAllByText('OCR needed').length).toBeGreaterThan(0);
    expect(screen.getByText('Text 35%')).toBeInTheDocument();
    expect(screen.getByText('2 zones')).toBeInTheDocument();
    expect(screen.getByText('5 FAR')).toBeInTheDocument();
    expect(screen.getByText('7 facts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /re-extract/i })).toBeEnabled();
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
