import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useDealContext, useDealRecord } from '../../hooks/useDealContext';
import { ExternalLink, MapPin, Search, X, Plus, Link2, CheckCircle2 } from 'lucide-react';
import { formatArea, formatDate } from '../../utils/format';
import { SQFT_PER_ACRE } from '../../config/india';
import { useProperties, useCreateProperty, useUpdateProperty } from '../../hooks/useProperties';
import { useUpdateDeal } from '../../hooks/useDeals';
import { toast } from '../common/Toast';
import SiteWeatherCard from './SiteWeatherCard';
import { SectionHeader, ErrorState } from '../../design-system';
import ReadOnlyPropertyMap from '../maps/ReadOnlyPropertyMap';
import AutoFillParcelContextCard from './AutoFillParcelContextCard';

function FieldRow({ label, value, span = false }) {
  if (!value && value !== 0) return null;
  return (
    <div className={span ? 'col-span-2 sm:col-span-3' : ''}>
      <dt className="text-xs text-content-muted mb-0.5">{label}</dt>
      <dd className="text-sm font-medium text-content-primary">{value}</dd>
    </div>
  );
}

function PropertyPickerModal({ dealId, onClose }) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [mode, setMode] = useState('search'); // 'search' | 'create'
  const [createForm, setCreateForm] = useState({
    name: '', address: '', city: 'Bengaluru', state: 'Karnataka', pincode: '',
    propertyType: 'land', zoning: 'residential',
  });
  const searchRef = useRef(null);
  const updateDeal = useUpdateDeal();
  const createProperty = useCreateProperty();

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (mode === 'search') searchRef.current?.focus();
  }, [mode]);

  const params = debouncedSearch.length >= 2
    ? { search: debouncedSearch, limit: 20 }
    : { limit: 20, orderBy: 'updated_at' };

  const { data, isLoading } = useProperties(params);
  const properties = data?.data || [];

  const handleLink = async () => {
    if (!selected) return;
    try {
      await updateDeal.mutateAsync({ id: dealId, data: { propertyId: selected.id } });
      onClose();
    } catch {
      // handled by mutation hook
    }
  };

  const handleCreateAndLink = async (e) => {
    e.preventDefault();
    try {
      const result = await createProperty.mutateAsync(createForm);
      const newPropertyId = result.data?.id || result.data;
      if (newPropertyId) {
        await updateDeal.mutateAsync({ id: dealId, data: { propertyId: newPropertyId } });
      }
      onClose();
    } catch {
      // handled by mutation hooks
    }
  };

  const displayName = (p) =>
    p.name || p.address || [p.city, p.state].filter(Boolean).join(', ') || 'Unnamed property';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 py-8 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 my-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-hairline">
          <h3 className="text-base font-bold text-content-primary flex items-center gap-2">
            <Link2 size={16} className="text-primary-600" /> Link Property to Deal
          </h3>
          <button onClick={onClose} className="text-content-muted hover:text-content-secondary p-1">
            <X size={18} />
          </button>
        </div>

        {/* Mode toggle */}
        <div className="flex gap-2 px-5 pt-4">
          <button
            onClick={() => setMode('search')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              mode === 'search'
                ? 'bg-primary-50 text-primary-700'
                : 'text-content-secondary hover:text-content-secondary'
            }`}
          >
            Search existing
          </button>
          <button
            onClick={() => setMode('create')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1 ${
              mode === 'create'
                ? 'bg-primary-50 text-primary-700'
                : 'text-content-secondary hover:text-content-secondary'
            }`}
          >
            <Plus size={13} /> Create new
          </button>
        </div>

        {mode === 'search' ? (
          <div className="px-5 py-4 space-y-3">
            {/* Search input */}
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, address, city..."
                className="input pl-9 text-sm"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-content-muted hover:text-content-secondary"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            {/* Results list */}
            <div className="max-h-64 overflow-y-auto divide-y divide-hairline border border-hairline rounded-lg">
              {isLoading ? (
                <div className="py-8 text-center text-sm text-content-muted">Loading...</div>
              ) : properties.length === 0 ? (
                <div className="py-8 text-center text-sm text-content-muted">
                  {debouncedSearch.length >= 2
                    ? 'No properties match your search'
                    : 'Type to search properties'}
                </div>
              ) : (
                properties.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelected(selected?.id === p.id ? null : p)}
                    className={`w-full text-left px-4 py-3 hover:bg-bg-secondary transition-colors ${
                      selected?.id === p.id ? 'bg-primary-50' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-content-primary truncate">
                          {displayName(p)}
                        </p>
                        <p className="text-xs text-content-muted mt-0.5">
                          {[p.city, p.state].filter(Boolean).join(', ')}
                          {p.land_area_sqft
                            ? ` · ${Number(p.land_area_sqft).toLocaleString('en-IN')} sqft`
                            : ''}
                          {p.zoning ? ` · ${p.zoning}` : ''}
                        </p>
                      </div>
                      {selected?.id === p.id && (
                        <CheckCircle2 size={16} className="text-primary-600 flex-shrink-0" />
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>

            {/* Selected property summary */}
            {selected && (
              <div className="bg-primary-50 border border-primary-100 rounded-lg px-4 py-3 text-sm">
                <p className="font-medium text-primary-900">{displayName(selected)}</p>
                {selected.address && (
                  <p className="text-primary-700 text-xs mt-0.5">{selected.address}</p>
                )}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-1">
              <button onClick={onClose} className="btn btn-secondary text-sm">Cancel</button>
              <button
                onClick={handleLink}
                disabled={!selected || updateDeal.isPending}
                className="btn btn-primary text-sm disabled:opacity-50"
              >
                {updateDeal.isPending ? 'Linking...' : 'Link Property'}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleCreateAndLink} className="px-5 py-4 space-y-3">
            <p className="text-xs text-content-secondary">
              Create a new property record and link it to this deal in one step.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-content-secondary mb-1">
                  Property Name (optional)
                </label>
                <input
                  type="text"
                  value={createForm.name}
                  onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                  className="input text-sm"
                  placeholder="e.g. Devanahalli Land Parcel"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-content-secondary mb-1">
                  Street Address (optional)
                </label>
                <input
                  type="text"
                  value={createForm.address}
                  onChange={(e) => setCreateForm((f) => ({ ...f, address: e.target.value }))}
                  className="input text-sm"
                  placeholder="Sy No., Village, Hobli..."
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-content-secondary mb-1">City</label>
                <input
                  type="text"
                  value={createForm.city}
                  onChange={(e) => setCreateForm((f) => ({ ...f, city: e.target.value }))}
                  className="input text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-content-secondary mb-1">State</label>
                <input
                  type="text"
                  value={createForm.state}
                  onChange={(e) => setCreateForm((f) => ({ ...f, state: e.target.value }))}
                  className="input text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-content-secondary mb-1">Pincode</label>
                <input
                  type="text"
                  value={createForm.pincode}
                  onChange={(e) => setCreateForm((f) => ({ ...f, pincode: e.target.value }))}
                  className="input text-sm"
                  placeholder="560001"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-content-secondary mb-1">Zoning</label>
                <select
                  value={createForm.zoning}
                  onChange={(e) => setCreateForm((f) => ({ ...f, zoning: e.target.value }))}
                  className="input text-sm"
                >
                  <option value="residential">Residential</option>
                  <option value="commercial">Commercial</option>
                  <option value="mixed_use">Mixed Use</option>
                  <option value="industrial">Industrial</option>
                  <option value="agricultural">Agricultural</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-1">
              <button type="button" onClick={onClose} className="btn btn-secondary text-sm">
                Cancel
              </button>
              <button
                type="submit"
                disabled={createProperty.isPending || updateDeal.isPending}
                className="btn btn-primary text-sm disabled:opacity-50"
              >
                {createProperty.isPending || updateDeal.isPending
                  ? 'Creating...'
                  : 'Create & Link'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default function ParcelTab({ canEdit }) {
  const { dealId } = useDealContext();
  const deal = useDealRecord();
  const [showPicker, setShowPicker] = useState(false);
  const updateProperty = useUpdateProperty();
  const hasProperty = !!deal.property_id;
  const hasLatLng = deal.lat != null && deal.lng != null;

  // Auto-derive Apply handler — for any field we have a column for on
  // `properties` today, persist via useUpdateProperty. For fields we don't
  // (BBMP zone code, PD code, ward — these need a follow-up migration to
  // get dedicated columns), surface what was picked so the user knows
  // they're acknowledged without lying about persistence.
  const handleAutoFillApply = async ({ pickedFields }) => {
    if (!deal.property_id) {
      toast.error('Link a property record before applying auto-derived values.');
      return;
    }
    const updates = {};
    if (pickedFields.coordinates?.lat != null && pickedFields.coordinates?.lng != null) {
      updates.lat = pickedFields.coordinates.lat;
      updates.lng = pickedFields.coordinates.lng;
    }
    const persistedCount = Object.keys(updates).length;
    const acknowledgedCount = Object.keys(pickedFields).length - persistedCount;

    if (persistedCount > 0) {
      try {
        await updateProperty.mutateAsync({ id: deal.property_id, data: updates });
        // useUpdateProperty's onSuccess fires 'Property updated' toast.
      } catch {
        // useUpdateProperty's onError fires the error toast.
        return;
      }
    }
    if (acknowledgedCount > 0) {
      toast.success(
        `${persistedCount} field${persistedCount === 1 ? '' : 's'} written to property · ` +
          `${acknowledgedCount} additional field${acknowledgedCount === 1 ? '' : 's'} acknowledged (full persistence in follow-up PR).`,
      );
    }
  };

  const landAreaAcres =
    deal.land_area_sqft != null
      ? (deal.land_area_sqft / SQFT_PER_ACRE).toFixed(3) + ' acres'
      : null;

  const geocodeLabel = deal.geocode_status
    ? deal.geocode_status.replace(/_/g, ' ')
    : 'Not geocoded';

  return (
    <div className="space-y-6">
      {/* Auto-Derive Parcel Context — the new killer feature. Renders only
          when a property is linked AND the user has edit rights, since the
          Apply handler writes to the linked property record. */}
      {hasProperty && canEdit && (
        <AutoFillParcelContextCard
          defaultAddress={deal.property_address || deal.address || ''}
          defaultLat={deal.lat || ''}
          defaultLng={deal.lng || ''}
          onApply={handleAutoFillApply}
        />
      )}

      {/* Property Link Banner */}
      {hasProperty ? (
        <div className="flex items-center justify-between bg-primary-50 border border-primary-100 rounded-xl px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-primary-800">
            <MapPin size={14} />
            <span>Property record linked</span>
          </div>
          <div className="flex items-center gap-3">
            {canEdit && (
              <button
                onClick={() => setShowPicker(true)}
                className="text-xs text-primary-600 hover:text-primary-700 font-medium"
              >
                Change
              </button>
            )}
            <Link
              to={`/dashboard/properties/${deal.property_id}`}
              className="text-sm text-primary-700 font-medium hover:text-primary-800 flex items-center gap-1"
            >
              View / Edit Property Record <ExternalLink size={13} />
            </Link>
          </div>
        </div>
      ) : (
        <ErrorState
          tone="warn"
          title="No property record linked"
          action={canEdit && (
            <button
              onClick={() => setShowPicker(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-700"
            >
              <Link2 size={13} /> Link Property
            </button>
          )}
        >
          Link a property to unlock geocoding, site details, and nearby comps.
        </ErrorState>
      )}

      {/* Site Details Grid */}
      <div className="card-editorial">
        <SectionHeader size="sm" icon={MapPin} title="Site Information" />
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4">
          <FieldRow label="Property Name" value={deal.property_name} />
          <FieldRow label="City" value={deal.city} />
          <FieldRow label="State" value={deal.state} />
          <FieldRow label="Pincode" value={deal.pincode} />
          <FieldRow label="Survey Number" value={deal.survey_number} />
          <FieldRow label="PID" value={deal.pid} />
          <FieldRow label="Khata No." value={deal.khata_no} />
          <FieldRow label="Bhoomi ID" value={deal.bhoomi_id} />
          <FieldRow label="Property RERA" value={deal.rera_registration_number} />
          <FieldRow label="Zoning" value={deal.zoning} />
          <FieldRow
            label="Land Area (sqft)"
            value={
              deal.land_area_sqft != null
                ? Number(deal.land_area_sqft).toLocaleString('en-IN') + ' sqft'
                : null
            }
          />
          <FieldRow label="Land Area (acres)" value={landAreaAcres} />
          <FieldRow label="Road Width (mtrs)" value={deal.road_width_mtrs} />
          <FieldRow
            label="Plot Dimensions"
            value={
              deal.frontage_mtrs || deal.depth_mtrs
                ? `${deal.frontage_mtrs || '-'} m frontage x ${deal.depth_mtrs || '-'} m depth`
                : null
            }
          />
          <FieldRow label="Owner Name" value={deal.owner_name} />
          <FieldRow label="Ownership Type" value={deal.ownership_type} />
          <FieldRow label="Encumbrance Status" value={deal.encumbrance_status} />
          <FieldRow
            label="Circle Rate"
            value={
              deal.circle_rate_per_sqft
                ? `₹${Number(deal.circle_rate_per_sqft).toLocaleString('en-IN')} / sqft`
                : null
            }
          />
          <FieldRow label="Existing FSI" value={deal.existing_fsi} />
          <FieldRow label="Permissible FSI" value={deal.permissible_fsi} />
          <FieldRow label="Geocode Status" value={geocodeLabel} />
          {deal.property_address && (
            <FieldRow label="Full Address" value={deal.property_address} span />
          )}
        </dl>
      </div>

      {/* Map Section */}
      <div className="card-editorial">
        <SectionHeader size="sm" icon={MapPin} title="Location Map" />
        {hasLatLng ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-4 text-sm text-content-secondary">
              <span>
                Lat: <strong className="font-mono">{Number(deal.lat).toFixed(6)}</strong>
              </span>
              <span>
                Lng: <strong className="font-mono">{Number(deal.lng).toFixed(6)}</strong>
              </span>
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${deal.lat},${deal.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 flex items-center gap-1"
              >
                Open in Google Maps <ExternalLink size={12} />
              </a>
              <a
                href={`https://www.google.com/maps/@${deal.lat},${deal.lng},17z/data=!3m1!1e3`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 flex items-center gap-1"
              >
                Satellite view <ExternalLink size={12} />
              </a>
            </div>
            <ReadOnlyPropertyMap
              lat={deal.lat}
              lng={deal.lng}
              title="Linked property reference point"
              propertyId={deal.property_id || deal.propertyId || null}
              canEdit={canEdit}
            />
            <p className="text-xs text-content-secondary">
              Pin at exact lat/lng. If the location looks off, re-geocode the property or enter manual coordinates on the Property Record.
            </p>
          </div>
        ) : (
          <div className="h-40 rounded-lg border-2 border-dashed border-hairline-strong flex flex-col items-center justify-center gap-2 text-content-muted">
            <MapPin size={28} />
            <p className="text-sm">Geocode pending</p>
            {hasProperty && (
              <p className="text-xs text-content-muted">
                Trigger geocoding from the Property record to show the map here.
              </p>
            )}
            {!hasProperty && canEdit && (
              <button
                onClick={() => setShowPicker(true)}
                className="mt-1 text-xs text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1"
              >
                <Link2 size={12} /> Link a property to enable geocoding
              </button>
            )}
          </div>
        )}
      </div>

      {/* Site weather (Open-Meteo) — only if geocoded */}
      {hasLatLng && (
        <SiteWeatherCard lat={deal.lat} lng={deal.lng} city={deal.city} />
      )}

      {/* Additional Technical Details */}
      {(deal.rera_number || deal.target_launch_date || deal.expected_close_date) && (
        <div className="card-editorial">
          <SectionHeader size="sm" title="Project Details" />
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4">
            <FieldRow label="RERA Number" value={deal.rera_number} />
            <FieldRow
              label="Target Launch Date"
              value={formatDate(deal.target_launch_date)}
            />
            <FieldRow
              label="Expected Close Date"
              value={formatDate(deal.expected_close_date)}
            />
          </dl>
        </div>
      )}

      {/* Property Picker Modal */}
      {showPicker && (
        <PropertyPickerModal
          dealId={dealId}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}
