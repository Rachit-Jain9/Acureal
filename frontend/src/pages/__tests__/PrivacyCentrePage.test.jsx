import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// The Privacy Centre talks to the backend via privacyAPI + consentAPI. We mock
// the whole api module (CloseAccountCard, rendered inside the page, also pulls
// authAPI from it) so the test is deterministic and offline.
const overviewMock = vi.fn();
const consentGetMock = vi.fn();
const consentUpdateMock = vi.fn();
const exportMock = vi.fn();

vi.mock('../../services/api', () => ({
  privacyAPI: {
    overview: (...a) => overviewMock(...a),
    exportData: (...a) => exportMock(...a),
  },
  consentAPI: {
    get: (...a) => consentGetMock(...a),
    update: (...a) => consentUpdateMock(...a),
  },
  authAPI: {
    closeAccount: vi.fn(),
  },
}));

vi.mock('../../components/common/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  default: () => null,
}));

import PrivacyCentrePage from '../PrivacyCentrePage';

const OVERVIEW = {
  profile: {
    id: 'u1',
    email: 'analyst@example.com',
    name: 'Test Analyst',
    phone: '9876543210',
    role: 'analyst',
    account_status: 'active',
    sign_in_method: 'password',
    password_set: true,
    email_verified: true,
    email_verified_at: '2026-05-01T00:00:00.000Z',
    last_login_at: '2026-05-20T00:00:00.000Z',
    account_created_at: '2026-04-01T00:00:00.000Z',
    last_updated_at: '2026-05-20T00:00:00.000Z',
  },
  organisation_memberships: [
    {
      organization_id: 'o1',
      organization_name: 'Acme Capital',
      organization_slug: 'acme',
      role: 'owner',
      is_active: true,
      joined_at: '2026-04-01T00:00:00.000Z',
    },
  ],
  legal_acceptances: [
    {
      document_kind: 'terms_of_service',
      version: 'v1',
      accepted_at: '2026-05-01T00:00:00.000Z',
      effective_at: '2026-04-01T00:00:00.000Z',
      ip_address: '203.0.113.1',
    },
  ],
  active_sessions: [
    {
      started_at: '2026-05-20T00:00:00.000Z',
      expires_at: '2026-06-19T00:00:00.000Z',
      ip_address: '203.0.113.9',
      device: 'Chrome on macOS',
    },
  ],
};

const CONSENT = {
  purposes: ['product_improvement', 'anonymized_benchmarking', 'marketing', 'ai_processing'],
  state: {
    product_improvement: false,
    anonymized_benchmarking: true,
    marketing: false,
    ai_processing: false,
  },
  available: true,
  history: [],
};

const renderPage = () =>
  render(
    <MemoryRouter>
      <PrivacyCentrePage />
    </MemoryRouter>
  );

beforeEach(() => {
  overviewMock.mockReset();
  consentGetMock.mockReset();
  consentUpdateMock.mockReset();
  exportMock.mockReset();
  overviewMock.mockResolvedValue({ data: { data: OVERVIEW } });
  consentGetMock.mockResolvedValue({ data: { data: CONSENT } });
  consentUpdateMock.mockResolvedValue({
    data: { data: { recorded: 1, state: { ...CONSENT.state, marketing: true }, available: true } },
  });
});

describe('PrivacyCentrePage', () => {
  it('renders every privacy section once data loads', async () => {
    renderPage();
    expect(await screen.findByText('Your information')).toBeInTheDocument();
    expect(screen.getByText('Your consent choices')).toBeInTheDocument();
    expect(screen.getByText(/Legal agreements you have accepted/i)).toBeInTheDocument();
    expect(screen.getByText('Active sign-ins')).toBeInTheDocument();
    expect(screen.getByText('Download your data')).toBeInTheDocument();
    // Real account data is surfaced to the data subject.
    expect(screen.getByText('analyst@example.com')).toBeInTheDocument();
    expect(screen.getByText('Acme Capital')).toBeInTheDocument();
  });

  it('renders one consent switch per purpose reflecting the current state', async () => {
    renderPage();
    await screen.findByText('Your consent choices');
    expect(screen.getAllByRole('switch')).toHaveLength(4);
    expect(screen.getByLabelText('Anonymised benchmarking')).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(screen.getByLabelText('Product updates & marketing')).toHaveAttribute(
      'aria-checked',
      'false'
    );
  });

  it('persists a consent change through consentAPI.update', async () => {
    renderPage();
    await screen.findByText('Your consent choices');
    fireEvent.click(screen.getByLabelText('Product updates & marketing'));
    await waitFor(() => {
      expect(consentUpdateMock).toHaveBeenCalledWith({ marketing: true });
    });
  });

  it('asks for password confirmation before a data export', async () => {
    renderPage();
    await screen.findByText('Download your data');
    fireEvent.click(screen.getByRole('button', { name: /Download my data/i }));
    expect(await screen.findByLabelText(/Confirm your password/i)).toBeInTheDocument();
  });

  it('shows an error state when the privacy data cannot be loaded', async () => {
    overviewMock.mockRejectedValue(new Error('network'));
    renderPage();
    expect(
      await screen.findByText(/Could not load your privacy information/i)
    ).toBeInTheDocument();
  });
});
