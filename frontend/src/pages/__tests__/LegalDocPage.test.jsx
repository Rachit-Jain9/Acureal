import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const useLegalActiveMock = vi.fn();
vi.mock('../../hooks/useLegalActive', () => ({
  useLegalActive: () => useLegalActiveMock(),
}));

import TermsPage from '../legal/TermsPage';
import PrivacyPage from '../legal/PrivacyPage';
import CookiesPage from '../legal/CookiesPage';

const SAMPLE_TERMS = {
  id: 1,
  kind: 'terms_of_service',
  version: 'v1',
  effective_at: '2026-05-04T00:00:00Z',
  body_md: '# Terms\n\nThis is a **draft** with a [link](/privacy).',
};

const SAMPLE_PRIVACY = {
  id: 2,
  kind: 'privacy_policy',
  version: 'v1',
  effective_at: '2026-05-04T00:00:00Z',
  body_md: '# Privacy\n\n| Sub-processor | Country |\n|---|---|\n| Anthropic | USA |\n',
};

const renderRoute = (Page) =>
  render(
    <MemoryRouter>
      <Page />
    </MemoryRouter>,
  );

describe('LegalDocPage shells', () => {
  it('renders the markdown body for the configured kind', () => {
    useLegalActiveMock.mockReturnValue({
      data: { terms_of_service: SAMPLE_TERMS, privacy_policy: SAMPLE_PRIVACY },
      loading: false,
      error: null,
    });
    renderRoute(TermsPage);
    expect(screen.getByRole('heading', { level: 1, name: /Terms of Service/i })).toBeInTheDocument();
    // Body content is rendered via Markdown
    expect(screen.getByText(/draft/i)).toBeInTheDocument();
  });

  it('renders a GFM table from the privacy markdown', () => {
    useLegalActiveMock.mockReturnValue({
      data: { terms_of_service: SAMPLE_TERMS, privacy_policy: SAMPLE_PRIVACY },
      loading: false,
      error: null,
    });
    renderRoute(PrivacyPage);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('Anthropic')).toBeInTheDocument();
    expect(screen.getByText('Sub-processor')).toBeInTheDocument();
  });

  it('shows a loading skeleton when the hook is loading', () => {
    useLegalActiveMock.mockReturnValue({ data: null, loading: true, error: null });
    renderRoute(TermsPage);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows the not-published state when the kind is missing from active docs', () => {
    useLegalActiveMock.mockReturnValue({
      data: { privacy_policy: SAMPLE_PRIVACY }, // terms missing
      loading: false,
      error: null,
    });
    renderRoute(TermsPage);
    expect(screen.getByText(/Not yet published/i)).toBeInTheDocument();
  });

  it('shows the danger error state on fetch failure', () => {
    useLegalActiveMock.mockReturnValue({
      data: null,
      loading: false,
      error: new Error('boom'),
    });
    renderRoute(CookiesPage);
    expect(screen.getByText(/Could not load this document/i)).toBeInTheDocument();
  });
});
