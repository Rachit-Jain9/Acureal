import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import MasterPlanLegend from '../MasterPlanLegend';
import { RMP2015_LANDUSE_LEGEND, RMP2015_LEGEND_SOURCE } from '../../../utils/cadastralLayers';

const CATEGORIES = [
  'Residential', 'Commercial', 'Industrial', 'Public & Semi-public',
  'Parks & Open Space', 'Traffic & Transportation', 'Public Utilities',
  'Agricultural land', 'Unclassified',
];

const HEX = /^#[0-9A-Fa-f]{6}$/;

describe('RMP2015_LANDUSE_LEGEND constant', () => {
  it('covers exactly the nine statutory BDA RMP 2015 zone categories', () => {
    expect(RMP2015_LANDUSE_LEGEND.map((g) => g.category)).toEqual(CATEGORIES);
  });

  it('every category and sub-zone has a valid hex colour and a code', () => {
    for (const g of RMP2015_LANDUSE_LEGEND) {
      expect(g.color).toMatch(HEX);
      expect(typeof g.code).toBe('string');
      expect(g.code.length).toBeGreaterThan(0);
      for (const s of g.subzones || []) {
        expect(s.color).toMatch(HEX);
        expect(typeof s.label).toBe('string');
      }
    }
  });

  it('carries a reference-only source caveat (no fabricated facts)', () => {
    expect(RMP2015_LEGEND_SOURCE).toMatch(/BDA/);
    expect(RMP2015_LEGEND_SOURCE.toLowerCase()).toMatch(/verify/);
  });
});

describe('MasterPlanLegend', () => {
  it('renders every statutory category and the source line', () => {
    render(<MasterPlanLegend collapsible={false} />);
    for (const c of CATEGORIES) {
      expect(screen.getByText(c)).toBeInTheDocument();
    }
    expect(screen.getByText(RMP2015_LEGEND_SOURCE)).toBeInTheDocument();
  });

  it('reveals sub-zones only after the toggle is pressed', () => {
    render(<MasterPlanLegend collapsible={false} />);
    expect(screen.queryByText('Residential (Main)')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /show sub-zones/i }));
    expect(screen.getByText('Residential (Main)')).toBeInTheDocument();
    expect(screen.getByText('Lake / tank')).toBeInTheDocument();
  });

  it('collapsible mode exposes a labelled disclosure header', () => {
    render(<MasterPlanLegend collapsible defaultOpen />);
    const header = screen.getByRole('button', { name: /land-use legend/i });
    expect(header).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
  });
});
