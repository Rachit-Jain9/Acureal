import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { GoverningPlanStrip, RoadWidthBasisNote } from '../ParcelIntelligencePanel';

describe('GoverningPlanStrip', () => {
  it('renders nothing when no plan is resolved (pre-registry)', () => {
    const { container } = render(<GoverningPlanStrip plan={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the operative plan, authority, and confidence for a resolved BDA parcel', () => {
    const { getByText } = render(
      <GoverningPlanStrip
        plan={{
          authority_code: 'BDA',
          authority_name: 'Bangalore Development Authority',
          plan_code: 'RMP_2015',
          plan_name: 'Revised Master Plan 2015 — Volume III',
          plan_legal_status: 'operative',
          method: 'taluk_alias',
          confidence: 0.85,
          basis: 'K-GIS taluk = Bangalore South → Bangalore Development Authority',
          needs_authority_confirmation: false,
          note: null,
        }}
      />,
    );
    expect(getByText('Revised Master Plan 2015 — Volume III')).toBeInTheDocument();
    expect(getByText('operative')).toBeInTheDocument();
    expect(getByText(/85% confidence/)).toBeInTheDocument();
  });

  it('flags "Confirm authority" when the resolution needs confirmation', () => {
    const { getByText } = render(
      <GoverningPlanStrip
        plan={{
          authority_name: 'Bangalore Development Authority',
          plan_name: 'Revised Master Plan 2015 — Volume III',
          plan_legal_status: 'operative',
          confidence: 0.3,
          needs_authority_confirmation: true,
        }}
      />,
    );
    expect(getByText('Confirm authority')).toBeInTheDocument();
  });

  it('surfaces the honest "rulebook not loaded" note for an Anekal parcel', () => {
    const note = 'Anekal Local Planning Area — Master Plan 2031 (BMRDA) is operative but its zoning/FAR rules are not yet loaded into REDIP — FAR cannot be computed against this rulebook yet.';
    const { getByText } = render(
      <GoverningPlanStrip
        plan={{
          authority_name: 'Anekal Planning Authority',
          plan_name: 'Anekal Local Planning Area — Master Plan 2031 (BMRDA)',
          plan_legal_status: 'operative',
          method: 'taluk_alias',
          confidence: 0.9,
          needs_authority_confirmation: false,
          note,
        }}
      />,
    );
    expect(getByText(note)).toBeInTheDocument();
  });

  it('renders a withdrawn plan with the withdrawn status', () => {
    const { getByText } = render(
      <GoverningPlanStrip
        plan={{
          authority_name: 'Bangalore Development Authority',
          plan_name: 'Revised Master Plan 2031 (Bengaluru) — withdrawn draft',
          plan_legal_status: 'withdrawn',
          confidence: 0.2,
          needs_authority_confirmation: true,
        }}
      />,
    );
    expect(getByText('withdrawn')).toBeInTheDocument();
  });
});

describe('RoadWidthBasisNote', () => {
  it('renders nothing when basis is missing or absent', () => {
    expect(render(<RoadWidthBasisNote basis={null} />).container.firstChild).toBeNull();
    expect(
      render(<RoadWidthBasisNote basis={{ basis: 'missing', label: 'Not provided' }} />).container.firstChild,
    ).toBeNull();
  });

  it('shows an operator-entered width as "As entered"', () => {
    const { getByText } = render(
      <RoadWidthBasisNote basis={{ basis: 'user', label: 'As entered', width_m: 18, note: 'verify on site' }} />,
    );
    expect(getByText(/Road width 18 m · As entered/)).toBeInTheDocument();
  });

  it('shows an OSM-inferred width as "Inferred (OSM)"', () => {
    const { getByText } = render(
      <RoadWidthBasisNote basis={{ basis: 'inferred', label: 'Inferred (OSM)', width_m: 9.5, note: 'reference only' }} />,
    );
    expect(getByText(/Road width 9.5 m · Inferred \(OSM\)/)).toBeInTheDocument();
  });
});
