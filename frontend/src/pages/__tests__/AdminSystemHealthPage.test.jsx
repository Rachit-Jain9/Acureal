import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mocks the liveness hook so we control the watchdog payload directly.
// Focused on the Data API exposure vital: the check that guards Acureal's
// SECOND door into the database (Supabase's internet-facing PostgREST API),
// which in Aug 2026 was found granting `anon` full CRUD on every table plus
// EXECUTE on the auth SECURITY DEFINER helpers. A card that renders "healthy"
// while objects are exposed would hide exactly the class of failure this whole
// page exists to surface.

let healthState;
const useSystemHealthMock = vi.fn();

vi.mock('../../hooks/useSystemHealth', () => ({
  useSystemHealth: (...args) => useSystemHealthMock(...args),
}));

import AdminSystemHealthPage from '../AdminSystemHealthPage';

const renderPage = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AdminSystemHealthPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const payload = (apiExposure) => ({
  overall: apiExposure.status === 'unhealthy' ? 'unhealthy' : 'healthy',
  window_hours: 3,
  unhealthy_count: apiExposure.status === 'unhealthy' ? 1 : 0,
  unknown_count: 0,
  generated_at: new Date().toISOString(),
  checks: {
    ai_providers: { status: 'healthy', models_checked: 2, detail: 'All AI models within the error threshold.' },
    audit_trail: { status: 'healthy', audit_writes: 3, event_writes: 1, detail: 'Audit trail recording normally.' },
    extractions: { status: 'healthy', stuck: 0, threshold_minutes: 15, detail: 'No stuck extractions.' },
    tenant_isolation: {
      status: 'healthy', scoped_visible_deals: 0, db_role: 'redip_app', bypasses_rls: false,
      detail: 'Tenant boundary holds AND the DB role no longer bypasses RLS.',
    },
    api_exposure: apiExposure,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  useSystemHealthMock.mockImplementation(() => ({
    data: healthState, isLoading: false, isError: false, error: null,
    refetch: vi.fn(), isFetching: false,
  }));
});

describe('AdminSystemHealthPage — Data API exposure vital', () => {
  it('renders the closed state with the reviewed-definer count', () => {
    healthState = payload({
      status: 'healthy',
      api_roles_present: true,
      exposed_tables: [],
      exposed_functions: [],
      unreviewed_definers: [],
      risky_default_acls: 0,
      definers_reviewed: 8,
      detail: 'Data API surface closed: no anon/authenticated grants.',
    });
    renderPage();

    expect(screen.getByText('Data API exposure')).toBeInTheDocument();
    expect(screen.getByText(/8 reviewed SECURITY DEFINER functions/)).toBeInTheDocument();
    expect(screen.getByText(/default privileges closed/)).toBeInTheDocument();
  });

  it('names every exposed object when the door is open', () => {
    healthState = payload({
      status: 'unhealthy',
      api_roles_present: true,
      exposed_tables: ['public.users', 'public.refresh_token_grants'],
      exposed_functions: ['public.auth_find_user_for_login'],
      unreviewed_definers: [],
      risky_default_acls: 0,
      definers_reviewed: 8,
      detail: '2 table(s) reachable by anon/authenticated through the Data API.',
    });
    renderPage();

    // The operator must be able to read exactly WHICH objects leaked — a count
    // alone is not actionable.
    expect(screen.getByText('public.users')).toBeInTheDocument();
    expect(screen.getByText('public.refresh_token_grants')).toBeInTheDocument();
    expect(screen.getByText('public.auth_find_user_for_login')).toBeInTheDocument();
    expect(screen.getByText('DEGRADED')).toBeInTheDocument();
  });

  it('surfaces an unreviewed SECURITY DEFINER function alongside exposed objects', () => {
    healthState = payload({
      status: 'unhealthy',
      api_roles_present: true,
      exposed_tables: [],
      exposed_functions: [],
      unreviewed_definers: ['public.some_new_helper'],
      risky_default_acls: 0,
      definers_reviewed: 9,
      detail: '1 SECURITY DEFINER function(s) not on the reviewed allowlist.',
    });
    renderPage();
    expect(screen.getByText('public.some_new_helper')).toBeInTheDocument();
  });

  it('explains itself on a database with no anon role', () => {
    healthState = payload({
      status: 'healthy',
      api_roles_present: false,
      definers_reviewed: 8,
      detail: 'No anon/authenticated roles exist on this database.',
    });
    renderPage();
    expect(screen.getByText('No anon role on this database.')).toBeInTheDocument();
  });
});
