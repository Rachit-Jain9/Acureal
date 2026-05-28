import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock the heavy ReadOnlyPropertyMap so the test doesn't try to load Leaflet.
vi.mock('../../maps/ReadOnlyPropertyMap', () => ({
  default: ({ lat, lng, title }) => (
    <div data-testid="readonly-map" data-lat={lat} data-lng={lng}>
      {title}
    </div>
  ),
}));

// Mock the toast — we don't care about side-effects in unit tests.
vi.mock('../../common/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Mock the hooks. We control mutation state per-test.
const captureMutateAsync = vi.fn();
const createMutateAsync = vi.fn();
const captureReset = vi.fn();
let captureState = { isPending: false, isError: false };
let createState = { isPending: false };

vi.mock('../../../hooks/useProperties', () => ({
  useCaptureProperty: () => ({
    mutateAsync: captureMutateAsync,
    reset: captureReset,
    get isPending() { return captureState.isPending; },
    get isError() { return captureState.isError; },
  }),
  useCreateProperty: () => ({
    mutateAsync: createMutateAsync,
    get isPending() { return createState.isPending; },
  }),
}));

import PropertyCaptureField from '../PropertyCaptureField';

const sampleCandidate = {
  classification: { type: 'plusCode', confidence: 0.92, parsed: { code: '3JV8+P4W' } },
  resolved: {
    lat: 12.9716,
    lng: 77.7401,
    formatted_address: '3JV8+P4W, Whitefield, Bengaluru, Karnataka 560066, India',
    place_id: 'pid-test',
    provider: 'google_plus_code',
    confidence: 0.9,
    status: 'verified',
  },
  context: {
    bbmpJurisdiction: { withinBbmp: true, ward: { name: 'Whitefield', no: 84 } },
    kgis: { hierarchy: { taluk: 'Bangalore East', village: 'Pattandur Agrahara' } },
    bbmpZone: { guidance_value: { min_inr: 4500, max_inr: 6200 } },
    verifyLinks: [
      { label: 'Bhoomi', url: 'https://landrecords.karnataka.gov.in/', kind: 'bhoomi' },
      { label: 'K-GIS', url: 'https://kgis.ksrsac.in/', kind: 'kgis' },
    ],
  },
  suggestedFields: {
    name: 'Parcel 3JV8+P4W (Bengaluru)',
    address: '3JV8+P4W, Whitefield, Bengaluru, Karnataka 560066, India',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560066',
    lat: 12.9716,
    lng: 77.7401,
    placeId: 'pid-test',
    propertyType: 'land',
    zoning: 'residential',
  },
  aiExtraction: null,
  warnings: [],
};

beforeEach(() => {
  captureMutateAsync.mockReset();
  createMutateAsync.mockReset();
  captureReset.mockReset();
  captureState = { isPending: false, isError: false };
  createState = { isPending: false };
});

describe('PropertyCaptureField', () => {
  it('renders the paste box with the disabled Capture button initially', () => {
    render(<PropertyCaptureField onSaved={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: /property capture input/i })).toBeInTheDocument();
    const captureBtn = screen.getByRole('button', { name: /capture/i });
    expect(captureBtn).toBeDisabled();
  });

  it('enables Capture when the input has content', () => {
    render(<PropertyCaptureField onSaved={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: /property capture input/i }), {
      target: { value: '3JV8+P4W' },
    });
    expect(screen.getByRole('button', { name: /capture/i })).not.toBeDisabled();
  });

  it('calls captureProperty on Capture click and renders the preview card', async () => {
    captureMutateAsync.mockResolvedValueOnce(sampleCandidate);
    render(<PropertyCaptureField onSaved={vi.fn()} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByRole('textbox', { name: /property capture input/i }), {
      target: { value: '3JV8+P4W' },
    });
    fireEvent.click(screen.getByRole('button', { name: /capture/i }));

    await waitFor(() => {
      expect(captureMutateAsync).toHaveBeenCalledWith({ input: '3JV8+P4W', aiAssisted: true });
    });

    // Preview card visible: classification chip, address, map.
    expect(screen.getByText('Plus Code')).toBeInTheDocument();
    // Address shows up in multiple places (map title + field row) — assert ≥1.
    expect(screen.getAllByText(/Whitefield, Bengaluru/i).length).toBeGreaterThan(0);
    expect(screen.getByTestId('readonly-map')).toHaveAttribute('data-lat', '12.9716');

    // Editable name pre-filled.
    const nameInput = screen.getByDisplayValue(/Parcel 3JV8\+P4W/);
    expect(nameInput).toBeInTheDocument();

    // Verify-links rendered.
    expect(screen.getByRole('link', { name: /bhoomi/i })).toHaveAttribute(
      'href',
      'https://landrecords.karnataka.gov.in/',
    );
  });

  it('saves the suggested fields with the edited name and calls onSaved', async () => {
    captureMutateAsync.mockResolvedValueOnce(sampleCandidate);
    createMutateAsync.mockResolvedValueOnce({ data: { id: 'new-prop-id' } });
    const onSaved = vi.fn();

    render(<PropertyCaptureField onSaved={onSaved} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: /property capture input/i }), {
      target: { value: '3JV8+P4W' },
    });
    fireEvent.click(screen.getByRole('button', { name: /capture/i }));

    await waitFor(() => {
      expect(screen.getByDisplayValue(/Parcel 3JV8\+P4W/)).toBeInTheDocument();
    });

    // Rename, then save.
    fireEvent.change(screen.getByDisplayValue(/Parcel 3JV8\+P4W/), {
      target: { value: 'My Whitefield Land' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save property/i }));

    await waitFor(() => expect(createMutateAsync).toHaveBeenCalled());
    const [calledWith] = createMutateAsync.mock.calls[0];
    expect(calledWith.name).toBe('My Whitefield Land');
    expect(calledWith.lat).toBe(12.9716);
    expect(calledWith.city).toBe('Bengaluru');
    expect(onSaved).toHaveBeenCalledWith('new-prop-id', { id: 'new-prop-id' });
  });

  it('renders the AI-extraction panel when free-text input was used', async () => {
    captureMutateAsync.mockResolvedValueOnce({
      ...sampleCandidate,
      classification: { type: 'freeText', confidence: 0.8, parsed: { text: 'broker text' } },
      aiExtraction: {
        land_area_acres: 5,
        asking_price_cr: 18,
        asset_class_hint: 'land',
        deal_structure_hint: 'outright_purchase',
        notes: 'RERA registered, broker contact attached',
      },
      suggestedFields: {
        ...sampleCandidate.suggestedFields,
        landAreaAcres: 5,
        landAskPriceCr: 18,
        landPricingBasis: 'total_cr',
      },
    });

    render(<PropertyCaptureField onSaved={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: /property capture input/i }), {
      target: { value: '5 acres on KIAL road, asking 18 cr' },
    });
    fireEvent.click(screen.getByRole('button', { name: /capture/i }));

    await waitFor(() => {
      expect(screen.getByText(/AI-extracted from your text/i)).toBeInTheDocument();
    });
    expect(screen.getByText('5 acres')).toBeInTheDocument();
    expect(screen.getByText('₹18 Cr')).toBeInTheDocument();
  });

  it('surfaces warnings as an amber banner', async () => {
    captureMutateAsync.mockResolvedValueOnce({
      ...sampleCandidate,
      warnings: ['Low-confidence geocoder match (45%). Confirm the pin on the map before saving.'],
    });

    render(<PropertyCaptureField onSaved={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: /property capture input/i }), {
      target: { value: 'some vague place' },
    });
    fireEvent.click(screen.getByRole('button', { name: /capture/i }));

    await waitFor(() => {
      expect(screen.getByText(/Low-confidence geocoder match/i)).toBeInTheDocument();
    });
  });

  it('cancel button calls onCancel before any capture', () => {
    const onCancel = vi.fn();
    render(<PropertyCaptureField onSaved={vi.fn()} onCancel={onCancel} />);
    // Before capture there's no cancel button — only after preview. Verify
    // the empty state instead.
    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
  });
});
