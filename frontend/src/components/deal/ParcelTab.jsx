import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, MapPin, AlertCircle, Search, X, Plus, Link2, CheckCircle2 } from 'lucide-react';
import { formatArea, formatDate } from '../../utils/format';
import { SQFT_PER_ACRE } from '../../config/india';
import { useProperties, useCreateProperty } from '../../hooks/useProperties';
import { useUpdateDeal } from '../../hooks/useDeals';
import SiteWeatherCard from './SiteWeatherCard';

function FieldRow({ label, value, span = false }) {
  if (!value && value !== 0) return null;
  return (
    <div className={span ? 'col-span-2 sm:col-span-3' : ''}>
      <dt className="text-xs text-gray-400 mb-0.5">{label}</dt>
      <dd className="text-sm font-medium text-gray-900">{value}</dd>
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
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <Link2 size={16} className="text-primary-600" /> Link Property to Deal
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
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
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Search existing
          </button>
          <button
            onClick={() => setMode('create')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1 ${
              mode === 'create'
                ? 'bg-primary-50 text-primary-700'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Plus size={13} /> Create new
          </button>
        </div>

        {mode === 'search' ? (
          <div className="px-5 py-4 space-y-3">
            {/* Search input */}
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
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
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            {/* Results list */}
            <div className="max-h-64 overflow-y-auto divide-y divide-gray-50 border border-gray-100 rounded-lg">
              {isLoading ? (
                <div className="py-8 text-center text-sm text-gray-400">Loading...</div>
              ) : properties.length === 0 ? (
                <div className="py-8 text-center text-sm text-gray-400">
                  {debouncedSearch.length >= 2
                    ? 'No properties match your search'
                    : 'Type to search properties'}
                </div>
              ) : (
                properties.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelected(selected?.id === p.id ? null : p)}
                    className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${
                      selected?.id === p.id ? 'bg-primary-50' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {displayName(p)}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">
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
            <p className="text-xs text-gray-500">
              Create a new property record and link it to this deal in one step.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-700 mb-1">
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
                <label className="block text-xs font-medium text-gray-700 mb-1">
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
                <label className="block text-xs font-medium text-gray-700 mb-1">City</label>
                <input
                  type="text"
                  value={createForm.city}
                  onChange={(e) => setCreateForm((f) => ({ ...f, city: e.target.value }))}
                  className="input text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">State</label>
                <input
                  type="text"
                  value={createForm.state}
                  onChange={(e) => setCreateForm((f) => ({ ...f, state: e.target.value }))}
                  className="input text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Pincode</label>
                <input
                  type="text"
                  value={createForm.pincode}
                  onChange={(e) => setCreateForm((f) => ({ ...f, pincode: e.target.value }))}
                  className="input text-sm"
                  placeholder="560001"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Zoning</label>
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

export default function ParcelTab({ deal, dealId, canEdit }) {
  const [showPicker, setShowPicker] = useState(false);
  const hasProperty = !!deal.property_id;
  const hasLatLng = deal.lat != null && deal.lng != null;

  const landAreaAcres =
    deal.land_area_sqft != null
      ? (deal.land_area_sqft / SQFT_PER_ACRE).toFixed(3) + ' acres'
      : null;

  const geocodeLabel = deal.geocode_status
    ? deal.geocode_status.replace(/_/g, ' ')
    : 'Not geocoded';

  return (
    <div className="space-y-6">
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
        <div className="flex items-center justify-between gap-3 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
          <div className="flex items-center gap-3">
            <AlertCircle size={16} className="text-amber-500 flex-shrink-0" />
            <p className="text-sm text-amber-800">
              No property record linked. Link a property to unlock geocoding, site details, and nearby comps.
            </p>
          </div>
          {canEdit && (
            <button
              onClick={() => setShowPicker(true)}
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white text-xs font-medium rounded-lg hover:bg-amber-700 transition-colors"
            >
              <Link2 size={13} /> Link Property
            </button>
          )}
        </div>
      )}

      {/* Site Details Grid */}
      <div className="card-editorial">
        <h3 className="text-base font-semibold text-gray-900 mb-4">Site Information</h3>
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4">
          <FieldRow label="Property Name" value={deal.property_name} />
          <FieldRow label="City" value={deal.city} />
          <FieldRow label="State" value={deal.state} />
          <FieldRow label="Pincode" value={deal.pincode} />
          <FieldRow label="Survey Number" value={deal.survey_number} />
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
        <h3 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <MapPin size={16} className="text-gray-400" />
          Location Map
        </h3>
        {hasLatLng ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600 dark:text-gray-300">
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
            <div className="h-72 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-900">
              <iframe
                title="property-map"
                width="100%"
                height="100%"
                style={{ border: 0 }}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                src={`https://maps.google.com/maps?q=${deal.lat},${deal.lng}&z=17&t=k&output=embed&iwloc=near`}
              />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Pin at exact lat/lng. If the location looks off, re-geocode the property or enter manual coordinates on the Property Record.
            </p>
          </div>
        ) : (
          <div className="h-40 rounded-lg border-2 border-dashed border-gray-200 flex flex-col items-center justify-center gap-2 text-gray-400">
            <MapPin size={28} />
            <p className="text-sm">Geocode pending</p>
            {hasProperty && (
              <p className="text-xs text-gray-400">
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
          <h3 className="text-base font-semibold text-gray-900 mb-4">Project Details</h3>
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
