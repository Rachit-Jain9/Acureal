import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SubprocessorsPage from '../SubprocessorsPage';

describe('SubprocessorsPage', () => {
  const renderPage = () =>
    render(
      <MemoryRouter>
        <SubprocessorsPage />
      </MemoryRouter>
    );

  it('renders the page heading and intro', () => {
    renderPage();
    expect(
      screen.getByRole('heading', { name: /Sub-processors/i, level: 1 })
    ).toBeInTheDocument();
  });

  it('lists every sub-processor as its own section', () => {
    renderPage();
    for (const name of ['Supabase', 'Vercel', 'Anthropic', 'OpenAI', 'Google', 'Resend']) {
      expect(screen.getByRole('heading', { name, level: 2 })).toBeInTheDocument();
    }
  });

  it('states India data residency and the residency note', () => {
    renderPage();
    expect(screen.getByText('India — Mumbai (ap-south-1)')).toBeInTheDocument();
    expect(screen.getByText('Note on data residency')).toBeInTheDocument();
  });
});
