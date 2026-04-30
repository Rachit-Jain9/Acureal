import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let importMutationMock;

vi.mock('../../../hooks/useMasterPlan', () => ({
  useImportZoneGeoJSON: () => importMutationMock,
}));

const { toastSpies } = vi.hoisted(() => ({
  toastSpies: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('../../common/Toast', () => ({
  toast: toastSpies,
  default: () => null,
}));

import ZoneGeoJsonImportButton from '../ZoneGeoJsonImportButton';

const SAMPLE_FEATURE_COLLECTION = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { zone_code: 'R1' },
      geometry: { type: 'Polygon', coordinates: [[[77, 12], [77.1, 12], [77.1, 12.1], [77, 12]]] },
    },
  ],
};

function makeFile(content, name = 'zones.geojson') {
  return new File([content], name, { type: 'application/geo+json' });
}

describe('ZoneGeoJsonImportButton', () => {
  beforeEach(() => {
    importMutationMock = {
      mutateAsync: vi.fn().mockResolvedValue({
        received: 1,
        updated: 1,
        skipped_existing_geom: 0,
        skipped_unknown_zone: 0,
        rejected: 0,
        updates: [{ zone_code: 'R1' }],
        errors: [],
      }),
      isPending: false,
    };
    toastSpies.success.mockClear();
    toastSpies.error.mockClear();
    toastSpies.info.mockClear();
  });

  it('renders an Import GeoJSON button', () => {
    render(<ZoneGeoJsonImportButton />);
    expect(screen.getByRole('button', { name: /import geojson/i })).toBeInTheDocument();
  });

  it('exposes an overwrite-existing-geometry checkbox', () => {
    render(<ZoneGeoJsonImportButton />);
    expect(screen.getByLabelText(/overwrite existing geometry/i)).toBeInTheDocument();
  });

  it('uploads a valid FeatureCollection and renders the summary panel', async () => {
    const user = userEvent.setup();
    render(<ZoneGeoJsonImportButton />);

    const file = makeFile(JSON.stringify(SAMPLE_FEATURE_COLLECTION));
    const fileInput = screen.getByLabelText(/geojson file/i);
    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(importMutationMock.mutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(importMutationMock.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      featureCollection: expect.objectContaining({ type: 'FeatureCollection' }),
      overwriteGeom: false,
    }));

    expect(await screen.findByText('zones.geojson')).toBeInTheDocument();
    expect(screen.getByText('Received')).toBeInTheDocument();
    expect(screen.getByText('Updated')).toBeInTheDocument();
  });

  it('rejects malformed JSON before calling the API', async () => {
    const user = userEvent.setup();
    render(<ZoneGeoJsonImportButton />);

    const fileInput = screen.getByLabelText(/geojson file/i);
    await user.upload(fileInput, makeFile('{broken'));

    await waitFor(() => {
      expect(toastSpies.error).toHaveBeenCalled();
    });
    expect(importMutationMock.mutateAsync).not.toHaveBeenCalled();
  });

  it('rejects JSON that is not a FeatureCollection', async () => {
    const user = userEvent.setup();
    render(<ZoneGeoJsonImportButton />);

    const fileInput = screen.getByLabelText(/geojson file/i);
    await user.upload(fileInput, makeFile(JSON.stringify({ type: 'Polygon', coordinates: [] })));

    await waitFor(() => {
      expect(toastSpies.error).toHaveBeenCalledWith(expect.stringMatching(/FeatureCollection/));
    });
    expect(importMutationMock.mutateAsync).not.toHaveBeenCalled();
  });

  it('rejects FeatureCollection with empty features', async () => {
    const user = userEvent.setup();
    render(<ZoneGeoJsonImportButton />);

    const fileInput = screen.getByLabelText(/geojson file/i);
    await user.upload(fileInput, makeFile(JSON.stringify({ type: 'FeatureCollection', features: [] })));

    await waitFor(() => {
      expect(toastSpies.error).toHaveBeenCalledWith(expect.stringMatching(/no features/i));
    });
    expect(importMutationMock.mutateAsync).not.toHaveBeenCalled();
  });

  it('passes overwriteGeom=true when the checkbox is selected', async () => {
    const user = userEvent.setup();
    render(<ZoneGeoJsonImportButton />);

    await user.click(screen.getByLabelText(/overwrite existing geometry/i));

    const fileInput = screen.getByLabelText(/geojson file/i);
    await user.upload(fileInput, makeFile(JSON.stringify(SAMPLE_FEATURE_COLLECTION)));

    await waitFor(() => {
      expect(importMutationMock.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
        overwriteGeom: true,
      }));
    });
  });

  it('renders the first few errors with a "+ N more" tail', async () => {
    importMutationMock.mutateAsync = vi.fn().mockResolvedValue({
      received: 8,
      updated: 0,
      skipped_existing_geom: 0,
      skipped_unknown_zone: 8,
      rejected: 0,
      updates: [],
      errors: Array.from({ length: 7 }, (_, i) => ({
        index: i,
        zone_code: `Z${i}`,
        reason: 'no reviewed zone matches this zone_code + plan_version',
      })),
    });

    const user = userEvent.setup();
    render(<ZoneGeoJsonImportButton />);

    const fileInput = screen.getByLabelText(/geojson file/i);
    await user.upload(fileInput, makeFile(JSON.stringify(SAMPLE_FEATURE_COLLECTION)));

    expect(await screen.findByText('+ 2 more')).toBeInTheDocument();
    expect(screen.getAllByText(/no reviewed zone matches/).length).toBeGreaterThanOrEqual(1);
  });
});
