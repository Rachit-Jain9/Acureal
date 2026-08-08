import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SensitivityTable from '../SensitivityTable';

// A 5×5 income grid shaped exactly as the kernel emits it: rents across
// the columns, exit-cap ticks down the rows, both centred on the deal.
// The centre cell (12.7%) is the same IRR the KPI tile shows — that is a
// kernel invariant, enforced in `postprocess.sensitivity.test.ts`.
const INCOME = {
  sellingRates: [96, 108, 120, 132, 144],
  constructionCosts: [7, 7.5, 8, 8.5, 9],
  grid: [
    [11.1, 12.6, 14.1, 15.5, 16.8],
    [10.5, 12.0, 13.4, 14.8, 16.1],
    [9.9, 11.4, 12.7, 14.1, 15.4],
    [9.4, 10.8, 12.1, 13.5, 14.7],
    [8.9, 10.3, 11.6, 12.9, 14.1],
  ],
  axis: ['Exit Cap Rate (%)', 'Base Rent/sqft/mo'],
};

const baseCell = () =>
  screen.getByTitle('This deal as underwritten — matches the headline IRR');

describe('SensitivityTable', () => {
  it('renders nothing without a grid', () => {
    const { container } = render(<SensitivityTable sensitivity={null} assetClass="commercial_office" />);
    expect(container.firstChild).toBeNull();
  });

  it('marks the centre cell as the deal', () => {
    // The whole point of the grid is reading distance-from-trouble, which
    // is meaningless if you cannot tell which cell you are standing on.
    render(<SensitivityTable sensitivity={INCOME} assetClass="commercial_office" />);
    expect(baseCell()).toHaveTextContent('12.7%');
  });

  it('marks exactly one cell', () => {
    render(<SensitivityTable sensitivity={INCOME} assetClass="commercial_office" />);
    expect(
      screen.getAllByTitle('This deal as underwritten — matches the headline IRR'),
    ).toHaveLength(1);
  });

  it('lands on the centre of a 9×9 residential grid too', () => {
    // Odd-sized grids of a different dimension must still resolve to the
    // middle, not to a hardcoded index 2.
    const rates = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const nine = {
      sellingRates: rates,
      constructionCosts: rates,
      grid: rates.map((r) => rates.map((c) => r * 10 + c)),
      axis: ['Constr. Cost/sqft', 'Selling Rate/sqft'],
    };
    render(<SensitivityTable sensitivity={nine} assetClass="residential_apartments" />);
    expect(baseCell()).toHaveTextContent('55.0%'); // grid[4][4] = 5*10+5
  });

  it('says so when the stored grid disagrees with the headline IRR', () => {
    // A matrix saved before income moved onto the kernel keeps its old,
    // rosier centre until the deal is recalculated. Marking that cell
    // "this deal" would put a number on screen that contradicts the KPI
    // tile directly above it.
    render(
      <SensitivityTable sensitivity={INCOME} assetClass="commercial_office" headlineIrr={9.9} />,
    );
    expect(screen.getByText(/saved under an earlier model/i)).toBeInTheDocument();
    expect(
      screen.queryByTitle('This deal as underwritten — matches the headline IRR'),
    ).not.toBeInTheDocument();
  });

  it('marks the cell normally when the grid agrees with the headline', () => {
    render(
      <SensitivityTable sensitivity={INCOME} assetClass="commercial_office" headlineIrr={12.7} />,
    );
    expect(screen.queryByText(/saved under an earlier model/i)).not.toBeInTheDocument();
    expect(baseCell()).toHaveTextContent('12.7%');
  });

  it('does not cry stale over floating-point noise', () => {
    render(
      <SensitivityTable sensitivity={INCOME} assetClass="commercial_office" headlineIrr={12.7004} />,
    );
    expect(screen.queryByText(/saved under an earlier model/i)).not.toBeInTheDocument();
  });

  it('stays quiet when there is no headline IRR to compare against', () => {
    // Deals whose IRR is null (no sign change in the cash flows) must not
    // trip the warning — nothing is known to be wrong.
    render(<SensitivityTable sensitivity={INCOME} assetClass="commercial_office" />);
    expect(screen.queryByText(/saved under an earlier model/i)).not.toBeInTheDocument();
    expect(baseCell()).toBeInTheDocument();
  });

  it('renders income cap-rate rows as percentages, including half-point ticks', () => {
    // The exit-cap axis is now centred on the deal, so ticks like 7.5%
    // are the norm rather than the old whole-number 5/6/7/8/9 ladder.
    render(<SensitivityTable sensitivity={INCOME} assetClass="commercial_office" />);
    expect(screen.getByText('7.5%')).toBeInTheDocument();
    expect(screen.getByText('8.5%')).toBeInTheDocument();
  });
});
