import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ProvenanceChip from '../ProvenanceChip';

const sampleProvenance = {
  land_area_sqft: {
    source: 'document_extraction',
    applied_at: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(), // 2 days ago
    applied_by: 'u-1',
    applied_by_name: 'Rachit Jain',
    applied_value: 12500,
    source_extraction_ids: ['ext-1'],
    source_document_names: ['sale-deed.pdf'],
    source_document_types: ['sale_deed'],
    target_table: 'properties',
    ontology_version: '1.0.0',
  },
};

describe('ProvenanceChip (PR-NX50)', () => {
  it('renders NOTHING when the field has no provenance entry', () => {
    const { container } = render(
      <ProvenanceChip field="survey_number" provenance={sampleProvenance} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders NOTHING when provenance map is undefined', () => {
    const { container } = render(<ProvenanceChip field="land_area_sqft" provenance={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the (i) chip button for an auto-filled field', () => {
    render(<ProvenanceChip field="land_area_sqft" provenance={sampleProvenance} />);
    // The button has an aria-label naming the source document
    expect(screen.getByRole('button', { name: /Auto-filled from sale-deed/i })).toBeInTheDocument();
  });

  it('opens the popover on click with provenance metadata', () => {
    render(<ProvenanceChip field="land_area_sqft" provenance={sampleProvenance} />);
    fireEvent.click(screen.getByRole('button'));
    // Popover content
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    expect(screen.getByText(/Auto-filled from Sale Deed/i)).toBeInTheDocument();
    expect(screen.getByText('sale-deed.pdf')).toBeInTheDocument();
    expect(screen.getByText(/Rachit Jain/)).toBeInTheDocument();
    expect(screen.getByText(/2d ago/i)).toBeInTheDocument();
    expect(screen.getByText(/properties\.land_area_sqft/)).toBeInTheDocument();
    expect(screen.getByText(/v1\.0\.0/)).toBeInTheDocument();
  });

  it('humanizes doc_type (sale_deed → Sale Deed) in the popover header', () => {
    const prov = {
      x: {
        ...sampleProvenance.land_area_sqft,
        source_document_types: ['encumbrance_certificate'],
      },
    };
    render(<ProvenanceChip field="x" provenance={prov} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText(/Auto-filled from Encumbrance Certificate/i)).toBeInTheDocument();
  });

  it('renders without doc_type / doc_name fallbacks gracefully', () => {
    const prov = {
      x: {
        applied_at: new Date().toISOString(),
        applied_by_name: 'A',
        target_table: 'properties',
        // No source_document_names or types
      },
    };
    render(<ProvenanceChip field="x" provenance={prov} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText(/Auto-filled from document extraction/i)).toBeInTheDocument();
  });
});
