import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import BulkAddressLookupPanel, { _internal } from '../BulkAddressLookupPanel';

// Mock the API the panel calls per row.
vi.mock('../../../services/api', () => ({
  propertiesAPI: {
    autoDeriveContext: vi.fn(),
  },
}));

import { propertiesAPI } from '../../../services/api';

const samplePayload = (label) => ({
  data: {
    data: {
      coordinates: { lat: 12.97, lng: 77.6, source: 'google', confidence: 0.92, status: 'verified' },
      bbmpJurisdiction: { withinBbmp: true, ward: { ward_no: 117 }, detection_method: 'bbmp_bbox_check' },
      bbmpZone: { zone_code: 'A', guidance_value_band_min_inr: 35000, guidance_value_band_max_inr: 50000 },
      planningDistrict: { pd_code: 'PD-01', pd_name: 'Central Business District' },
      kgis: { hierarchy: { taluk: 'Bangalore South', village: 'Begur' } },
      applicableWarnings: [{ kind: `Test warning for ${label}` }, { kind: 'Other' }],
      coordinatesGate: { gated: false },
    },
  },
});

beforeEach(() => {
  propertiesAPI.autoDeriveContext.mockReset();
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn(() => Promise.resolve()) },
    writable: true,
    configurable: true,
  });
});

describe('BulkAddressLookupPanel — parseAddresses helper', () => {
  it('trims, dedupes (case-insensitive), and caps at MAX_ADDRESSES', () => {
    const lines = [
      '100 Brigade Road',
      '  100 Brigade Road  ', // dupe with whitespace
      '100 BRIGADE ROAD',     // dupe case-insensitive
      '',                     // empty line — skipped
      'Whitefield Main Road',
      ...Array.from({ length: 60 }, (_, i) => `Addr ${i}`), // over cap
    ].join('\n');
    const parsed = _internal.parseAddresses(lines);
    expect(parsed.addresses.length).toBe(_internal.MAX_ADDRESSES);
    expect(parsed.dropped).toBe(2); // two case-insensitive dupes
    expect(parsed.overCap).toBeGreaterThan(0);
  });

  it('returns empty result for null/empty input', () => {
    expect(_internal.parseAddresses('')).toEqual({ addresses: [], dropped: 0, overCap: 0 });
    expect(_internal.parseAddresses(null)).toEqual({ addresses: [], dropped: 0, overCap: 0 });
  });
});

describe('BulkAddressLookupPanel — projectRow helper', () => {
  it('projects a successful payload into the table row shape', () => {
    const payload = samplePayload('Brigade').data.data;
    const row = _internal.projectRow('100 Brigade Road', payload);
    expect(row.status).toBe('ok');
    expect(row.bbmp_zone).toBe('A');
    expect(row.bbmp_ward).toBe(117);
    expect(row.pd_code).toBe('PD-01');
    expect(row.kgis_taluk).toBe('Bangalore South');
    expect(row.warning_count).toBe(2);
    expect(row.bbmp_guidance_band).toMatch(/35,000-50,000/);
  });

  it('marks the row low_confidence when coordinatesGate is gated', () => {
    const payload = {
      ...samplePayload('X').data.data,
      coordinatesGate: { gated: true, reason: 'low_confidence_geocode' },
    };
    const row = _internal.projectRow('X', payload);
    expect(row.status).toBe('low_confidence');
  });

  it('marks the row failed for a null payload + carries the error', () => {
    const row = _internal.projectRow('xyzzy', null);
    expect(row.status).toBe('failed');
    expect(row.error).toBe('No payload returned');
  });
});

describe('BulkAddressLookupPanel — rowsToTsv helper', () => {
  it('produces a tab-separated header + body suitable for Excel paste', () => {
    const row = _internal.projectRow('100 Brigade Road', samplePayload('test').data.data);
    const tsv = _internal.rowsToTsv([row]);
    const [header, body] = tsv.split('\n');
    expect(header.split('\t')).toContain('Address');
    expect(header.split('\t')).toContain('Within BBMP');
    expect(body).toMatch(/100 Brigade Road\t/);
    expect(body).toMatch(/Yes/);  // within_bbmp=true
  });

  it('strips embedded tabs/newlines from cells to keep the TSV grid intact', () => {
    const dirty = _internal.projectRow('addr\twith\ttabs\nand newlines', null);
    const tsv = _internal.rowsToTsv([dirty]);
    const dataRow = tsv.split('\n')[1];
    // The address cell should be ONE cell in the row (no extra tab columns)
    expect(dataRow.startsWith('addr with tabs and newlines')).toBe(true);
  });
});

describe('BulkAddressLookupPanel — UI', () => {
  it('renders the textarea, empty count, and disabled Run button initially', () => {
    render(<BulkAddressLookupPanel />);
    expect(screen.getByTestId('bulk-lookup-textarea')).toBeInTheDocument();
    expect(screen.getByTestId('bulk-lookup-count').textContent).toMatch(/0\s*of\s*50/);
    const runBtn = screen.getByTestId('bulk-lookup-run');
    expect(runBtn).toBeDisabled();
  });

  it('counts non-empty lines as the user types', () => {
    render(<BulkAddressLookupPanel />);
    const ta = screen.getByTestId('bulk-lookup-textarea');
    fireEvent.change(ta, { target: { value: '100 Brigade Road\nWhitefield Main Road\n' } });
    expect(screen.getByTestId('bulk-lookup-count').textContent).toMatch(/2\s*of\s*50/);
    expect(screen.getByTestId('bulk-lookup-run')).not.toBeDisabled();
  });

  it('runs the lookup, shows progress, and renders one table row per address', async () => {
    propertiesAPI.autoDeriveContext
      .mockResolvedValueOnce(samplePayload('Brigade'))
      .mockResolvedValueOnce(samplePayload('Whitefield'));

    render(<BulkAddressLookupPanel />);
    fireEvent.change(screen.getByTestId('bulk-lookup-textarea'), {
      target: { value: '100 Brigade Road\nWhitefield Main Road' },
    });
    fireEvent.click(screen.getByTestId('bulk-lookup-run'));

    await waitFor(() => expect(screen.getByTestId('bulk-lookup-table')).toBeInTheDocument(), { timeout: 3000 });
    expect(screen.getByTestId('bulk-lookup-row-0')).toBeInTheDocument();
    expect(screen.getByTestId('bulk-lookup-row-1')).toBeInTheDocument();
    expect(propertiesAPI.autoDeriveContext).toHaveBeenCalledTimes(2);
  });

  it('surfaces a failed row when the API throws for one of the addresses', async () => {
    propertiesAPI.autoDeriveContext
      .mockResolvedValueOnce(samplePayload('Brigade'))
      .mockRejectedValueOnce(new Error('Network down'));

    render(<BulkAddressLookupPanel />);
    fireEvent.change(screen.getByTestId('bulk-lookup-textarea'), {
      target: { value: '100 Brigade Road\nbroken address' },
    });
    fireEvent.click(screen.getByTestId('bulk-lookup-run'));
    await waitFor(() => expect(screen.getByTestId('bulk-lookup-table')).toBeInTheDocument(), { timeout: 3000 });
    expect(screen.getByText(/Network down/)).toBeInTheDocument();
    // 1 ok + 1 failed badge
    expect(screen.getByText(/1 ok/)).toBeInTheDocument();
    expect(screen.getByText(/1 failed/)).toBeInTheDocument();
  });

  it('writes TSV to clipboard when "Copy as Excel-ready table" is clicked', async () => {
    propertiesAPI.autoDeriveContext.mockResolvedValueOnce(samplePayload('Brigade'));
    render(<BulkAddressLookupPanel />);
    fireEvent.change(screen.getByTestId('bulk-lookup-textarea'), { target: { value: '100 Brigade Road' } });
    fireEvent.click(screen.getByTestId('bulk-lookup-run'));
    await waitFor(() => expect(screen.getByTestId('bulk-lookup-copy-tsv')).toBeInTheDocument(), { timeout: 3000 });
    fireEvent.click(screen.getByTestId('bulk-lookup-copy-tsv'));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
    const tsv = navigator.clipboard.writeText.mock.calls[0][0];
    expect(tsv).toMatch(/Address\t/);
    expect(tsv).toMatch(/100 Brigade Road/);
  });

  it('Clear button resets state', async () => {
    propertiesAPI.autoDeriveContext.mockResolvedValueOnce(samplePayload('Brigade'));
    render(<BulkAddressLookupPanel />);
    fireEvent.change(screen.getByTestId('bulk-lookup-textarea'), { target: { value: '100 Brigade Road' } });
    fireEvent.click(screen.getByTestId('bulk-lookup-run'));
    await waitFor(() => expect(screen.getByTestId('bulk-lookup-clear')).toBeInTheDocument(), { timeout: 3000 });
    fireEvent.click(screen.getByTestId('bulk-lookup-clear'));
    expect(screen.queryByTestId('bulk-lookup-table')).not.toBeInTheDocument();
    expect(screen.getByTestId('bulk-lookup-textarea')).toHaveValue('');
  });
});
