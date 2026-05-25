import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ZoneModal from '../ZoneModal';

// Focused tests for ZoneModal payload normalization. The zone form has
// three subtle behaviours that would silently corrupt RMP zone records
// if regressed:
//
//   1. Permissible / prohibited uses serialize via parseList (comma split,
//      trim, drop blanks).
//   2. Setback values + numeric fields are coerced via toNum, so an empty
//      string emits null (not 0) and "not a number" emits null too.
//   3. FSI road-width tiers are filtered: rows with a null road_width_m
//      OR a null fsi are dropped before submit so the backend never sees
//      half-filled tiers.

const existingZone = {
  id: 'zone-1',
  zone_code: 'R1',
  zone_name: 'Residential (Main)',
  plan_version: 'RMP 2031 Draft',
  city: 'Bengaluru',
  permissible_fsi_base: 1.75,
  permissible_fsi_max: 2.5,
  ground_coverage_pct: 50,
  building_height_max_m: 18,
  road_width_min_m: 9,
  permissible_uses: ['Residential', 'Retail', 'Parks'],
  prohibited_uses: ['Industrial'],
  notes: 'Existing zoning regulation clause.',
  source_page: 42,
  source_section: 'Part II — Zoning Regulations',
  fsi_road_width_rules: [
    { road_width_m: 12, fsi: 2.0 },
    { road_width_m: 24, fsi: 2.5 },
  ],
  setback_rules: { front_m: 3, rear_m: 1.5, side_m: 1 },
  effective_from: '2017-05-15T00:00:00.000Z',
  effective_to: null,
  review_status: 'approved',
};

beforeEach(() => {
  cleanup();
});

function openModal(props = {}) {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  const result = render(
    <ZoneModal isOpen onClose={onClose} onSubmit={onSubmit} submitting={false} {...props} />,
  );
  return { ...result, onSubmit, onClose };
}

function submit() {
  // The submit button is the affirmative one; in create mode it says
  // "Create zone", in edit mode "Save changes". Match either.
  const btn = screen.getByRole('button', { name: /(Create zone|Save changes)/ });
  fireEvent.click(btn);
}

describe('ZoneModal — create mode', () => {
  it('renders nothing when isOpen=false', () => {
    const { container } = render(
      <ZoneModal isOpen={false} onClose={vi.fn()} onSubmit={vi.fn()} />,
    );
    expect(container.querySelector('[role="dialog"], h2')).toBeNull();
  });

  it('shows the Add Zone heading when no zone prop is supplied', () => {
    openModal({ zone: null });
    expect(screen.getByRole('heading', { name: /Add Zone/i })).toBeInTheDocument();
  });

  it('starts with the EMPTY_ZONE seed (RMP 2031 Draft, Bengaluru, pending review)', () => {
    openModal({ zone: null });
    expect(screen.getByLabelText(/Zone Code/i)).toHaveValue('');
    expect(screen.getByLabelText(/Zone Name/i)).toHaveValue('');
    expect(screen.getByLabelText(/Plan Version/i)).toHaveValue('RMP 2031 Draft');
    expect(screen.getByLabelText(/City/i)).toHaveValue('Bengaluru');
    expect(screen.getByLabelText(/Review Status/i)).toHaveValue('pending');
  });

  it('blocks submit when required fields (zone_code / zone_name) are empty', () => {
    const { onSubmit } = openModal({ zone: null });
    submit();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits a normalised payload with parseList for permissible / prohibited uses', () => {
    const { onSubmit } = openModal({ zone: null });
    fireEvent.change(screen.getByLabelText(/Zone Code/i), { target: { value: '  R2  ' } });
    fireEvent.change(screen.getByLabelText(/Zone Name/i), { target: { value: '  Residential (Mixed)  ' } });
    fireEvent.change(screen.getByLabelText(/Permissible Uses/i), {
      target: { value: 'Residential, Retail , Parks,' },
    });
    submit();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.zone_code).toBe('R2');
    expect(payload.zone_name).toBe('Residential (Mixed)');
    expect(payload.permissible_uses).toEqual(['Residential', 'Retail', 'Parks']);
    expect(payload.prohibited_uses).toEqual([]);
  });

  it('coerces empty numeric inputs to null (not 0)', () => {
    const { onSubmit } = openModal({ zone: null });
    fireEvent.change(screen.getByLabelText(/Zone Code/i), { target: { value: 'R3' } });
    fireEvent.change(screen.getByLabelText(/Zone Name/i), { target: { value: 'Res 3' } });
    submit();
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.permissible_fsi_base).toBeNull();
    expect(payload.permissible_fsi_max).toBeNull();
    expect(payload.ground_coverage_pct).toBeNull();
    expect(payload.building_height_max_m).toBeNull();
    expect(payload.road_width_min_m).toBeNull();
    expect(payload.source_page).toBeNull();
    expect(payload.setback_rules).toEqual({ front_m: null, rear_m: null, side_m: null });
  });

  it('emits null effective dates when the date inputs are empty', () => {
    const { onSubmit } = openModal({ zone: null });
    fireEvent.change(screen.getByLabelText(/Zone Code/i), { target: { value: 'R4' } });
    fireEvent.change(screen.getByLabelText(/Zone Name/i), { target: { value: 'Res 4' } });
    submit();
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.effective_from).toBeNull();
    expect(payload.effective_to).toBeNull();
  });
});

describe('ZoneModal — edit mode', () => {
  it('shows the Edit Zone heading with the zone code', () => {
    openModal({ zone: existingZone });
    expect(screen.getByRole('heading', { name: /Edit Zone — R1/i })).toBeInTheDocument();
  });

  it('pre-fills the form with the existing zone (joins permissible_uses with commas)', () => {
    openModal({ zone: existingZone });
    expect(screen.getByLabelText(/Zone Code/i)).toHaveValue('R1');
    expect(screen.getByLabelText(/Zone Name/i)).toHaveValue('Residential (Main)');
    expect(screen.getByLabelText(/Plan Version/i)).toHaveValue('RMP 2031 Draft');
    expect(screen.getByLabelText(/Permissible Uses/i)).toHaveValue('Residential, Retail, Parks');
    expect(screen.getByLabelText(/Prohibited Uses/i)).toHaveValue('Industrial');
    expect(screen.getByLabelText(/FSI Base/i)).toHaveValue(1.75);
    // effective_from is sliced to YYYY-MM-DD for the date input.
    expect(screen.getByLabelText(/Effective From/i)).toHaveValue('2017-05-15');
  });

  it('passes the existing FSI road-width tiers through unchanged when submitted as-is', () => {
    const { onSubmit } = openModal({ zone: existingZone });
    submit();
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.fsi_road_width_rules).toEqual([
      { road_width_m: 12, fsi: 2 },
      { road_width_m: 24, fsi: 2.5 },
    ]);
  });

  it('drops tiers that have a null road_width_m or null fsi before submit', () => {
    const zoneWithBlankTier = {
      ...existingZone,
      fsi_road_width_rules: [
        { road_width_m: 12, fsi: 2.0 },
        { road_width_m: '', fsi: 2.5 }, // missing width — should drop
        { road_width_m: 24, fsi: '' }, // missing fsi — should drop
      ],
    };
    const { onSubmit } = openModal({ zone: zoneWithBlankTier });
    submit();
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.fsi_road_width_rules).toEqual([{ road_width_m: 12, fsi: 2 }]);
  });

  it('Add tier button appends an empty tier and Remove drops it', () => {
    const { onSubmit } = openModal({ zone: existingZone });
    fireEvent.click(screen.getByRole('button', { name: /Add tier/i }));
    // Now there are 3 tier rows in the DOM. The new one is empty, so it
    // will be filtered out on submit (toNum('') === null).
    submit();
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.fsi_road_width_rules).toHaveLength(2);
  });

  it('Cancel calls onClose without onSubmit', () => {
    const { onSubmit, onClose } = openModal({ zone: existingZone });
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
