import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  KPICards,
  AreaBreakdown,
  CostBreakdown,
  RevenuePanel,
} from '../ResultPanels';

// KPIStatCard (rendered by KPICards) uses useDefaultsMeta → useQuery, so any
// render that mounts a KPI tile needs a QueryClient. Fresh client per render
// keeps tests isolated; retry:false avoids slow failures in CI.
function withQuery(ui) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe('KPICards — residential (default)', () => {
  it('renders the default residential KPI set', () => {
    render(
      withQuery(
        <KPICards
          kpis={{
            irr: 22.3,
            npv: 48.1,
            equityMultiple: 1.85,
            rlv: 34.2,
            dscr: null,
          }}
          assetClass="residential"
          inputs={{}}
        />,
      ),
    );
    expect(screen.getByText('IRR')).toBeInTheDocument();
    expect(screen.getByText('NPV')).toBeInTheDocument();
    expect(screen.getByText('Equity Multiple')).toBeInTheDocument();
    expect(screen.getByText('RLV')).toBeInTheDocument();
    expect(screen.queryByText('DSCR')).toBeNull();
  });

  it('includes DSCR tile when dscr is provided', () => {
    render(
      withQuery(
        <KPICards
          kpis={{
            irr: 15,
            npv: 10,
            equityMultiple: 1.2,
            rlv: 5,
            dscr: 1.45,
          }}
          assetClass="residential"
          inputs={{}}
        />,
      ),
    );
    expect(screen.getByText('DSCR')).toBeInTheDocument();
    expect(screen.getByText('1.45x')).toBeInTheDocument();
  });
});

describe('KPICards — income-producing (office/retail)', () => {
  it('renders NOI / yield-on-cost / IRR / exit-value set', () => {
    render(
      withQuery(
        <KPICards
          kpis={{
            noi: 12.4,
            yieldOnCost: 8.75,
            irr: 14.2,
            exitValue: 185,
          }}
          assetClass="commercial_office"
          inputs={{}}
        />,
      ),
    );
    expect(screen.getByText('Stabilized NOI')).toBeInTheDocument();
    expect(screen.getByText('Yield on Cost')).toBeInTheDocument();
    expect(screen.getByText('8.75%')).toBeInTheDocument();
    expect(screen.getByText('Exit Value')).toBeInTheDocument();
  });
});

describe('AreaBreakdown', () => {
  it('renders residential rows when unit count provided', () => {
    render(
      <AreaBreakdown
        areas={{
          grossBuiltUp: 50000,
          saleable: 42000,
          carpet: 34000,
          superBuiltUp: 46000,
          numberOfUnits: 40,
          residentialAvgUnitSize: 1100,
        }}
        assetClass="residential"
      />,
    );
    expect(screen.getByText('Area Breakdown')).toBeInTheDocument();
    expect(screen.getByText('Gross Built-Up Area')).toBeInTheDocument();
    expect(screen.getByText('Number of Units')).toBeInTheDocument();
  });
});

describe('CostBreakdown', () => {
  it('omits rows with null/zero values and shows Total Cost', () => {
    render(
      <CostBreakdown
        costs={{
          land: 30,
          construction: 60,
          gst: 4.2,
          contingency: null,
          stampDuty: 0,
          total: 94.2,
        }}
        assetClass="residential"
      />,
    );
    expect(screen.getByText('Land Cost')).toBeInTheDocument();
    expect(screen.getByText('Construction Cost')).toBeInTheDocument();
    expect(screen.getByText('GST')).toBeInTheDocument();
    expect(screen.queryByText('Contingency')).toBeNull();
    expect(screen.queryByText('Stamp Duty')).toBeNull();
    expect(screen.getByText('Total Cost')).toBeInTheDocument();
  });
});

describe('RevenuePanel — residential', () => {
  it('renders Revenue & Profit rows for default asset class', () => {
    render(
      <RevenuePanel
        revenue={{ totalRevenue: 140, profit: 46, margin: 32.9 }}
        kpis={{ dscr: null }}
        assetClass="residential"
      />,
    );
    expect(screen.getByText('Revenue & Profit')).toBeInTheDocument();
    expect(screen.getByText('Revenue')).toBeInTheDocument();
    expect(screen.getByText('Profit')).toBeInTheDocument();
    expect(screen.getByText('Margin')).toBeInTheDocument();
  });

  it('renders hotel P&L block for hospitality asset class', () => {
    render(
      <RevenuePanel
        revenue={{
          roomsRevenue: 40,
          fbRevenue: 12,
          totalRevenue: 52,
          gop: 22,
          ebitda: 18,
        }}
        kpis={{ dscr: 1.6 }}
        assetClass="hospitality"
      />,
    );
    expect(screen.getByText('Hotel P&L (Stabilized Year)')).toBeInTheDocument();
    expect(screen.getByText('Rooms Revenue')).toBeInTheDocument();
    expect(screen.getByText('F&B Revenue')).toBeInTheDocument();
    expect(screen.getByText('GOP')).toBeInTheDocument();
    expect(screen.getByText('EBITDA')).toBeInTheDocument();
    expect(screen.getByText('DSCR')).toBeInTheDocument();
  });
});
