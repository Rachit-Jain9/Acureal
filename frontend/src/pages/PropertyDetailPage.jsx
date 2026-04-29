import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Building2,
  Edit2,
  ExternalLink,
  IndianRupee,
  MapPin,
  RefreshCw,
  Ruler,
  X,
} from 'lucide-react';
import { useProperty, useGeocodeProperty, useUpdateProperty } from '../hooks/useProperties';
import MasterPlanZonePanel from '../components/deal/MasterPlanZonePanel';
import ParcelIntelligencePanel from '../components/deal/ParcelIntelligencePanel';
import ReadOnlyPropertyMap from '../components/maps/ReadOnlyPropertyMap';
import { useDeals } from '../hooks/useDeals';
import LoadingSpinner from '../components/common/LoadingSpinner';
import PageHeader from '../components/common/PageHeader';
import Badge from '../components/common/Badge';
import EmptyState from '../components/common/EmptyState';
import { toast } from '../components/common/Toast';
import { SectionHeader } from '../design-system';
import {
  formatArea,
  formatDate,
  formatINR,
  PROPERTY_TYPE_LABELS,
  STAGE_CONFIG,
} from '../utils/format';
import { normalizeAreaSqft } from '../utils/landPricing';

const PROPERTY_TYPE_OPTIONS = [
  { value: 'land', label: 'Land' },
  { value: 'residential', label: 'Residential' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'mixed_use', label: 'Mixed Use' },
  { value: 'industrial', label: 'Industrial' },
  { value: 'office', label: 'Office' },
  { value: 'retail', label: 'Retail' },
  { value: 'hospitality', label: 'Hospitality' },
];

const ZONING_OPTIONS = [
  { value: 'residential', label: 'Residential' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'mixed_use', label: 'Mixed Use' },
  { value: 'industrial', label: 'Industrial' },
  { value: 'agricultural', label: 'Agricultural' },
];

const GEOCODE_STATUS_META = {
  verified: { label: 'Verified', cls: 'bg-emerald-100 text-emerald-700' },
  manual: { label: 'Manual', cls: 'bg-blue-100 text-blue-700' },
  approximate: { label: 'Approximate (city)', cls: 'bg-amber-100 text-amber-700' },
  failed: { label: 'Failed', cls: 'bg-red-100 text-red-700' },
  pending: { label: 'Pending', cls: 'bg-bg-secondary text-content-secondary' },
  insufficient_data: { label: 'Insufficient data', cls: 'bg-bg-secondary text-content-secondary' },
};

const buildEditForm = (property) => ({
  name: property.name || '',
  address: property.address || '',
  city: property.city || '',
  state: property.state || '',
  pincode: property.pincode || '',
  propertyType: property.property_type || 'land',
  zoning: property.zoning || 'residential',
  landAreaValue: property.land_area_input_value ?? property.land_area_sqft ?? '',
  landAreaUnit: property.land_area_input_unit || 'sqft',
  circleRatePerSqft: property.circle_rate_per_sqft ?? '',
  permissibleFsi: property.permissible_fsi ?? '',
  surveyNumber: property.survey_number || '',
  pid: property.pid || '',
  khataNo: property.khata_no || '',
  bhoomiId: property.bhoomi_id || '',
  reraRegistrationNumber: property.rera_registration_number || '',
  ownerName: property.owner_name || '',
  roadWidthMtrs: property.road_width_mtrs ?? '',
  frontageMtrs: property.frontage_mtrs ?? '',
  depthMtrs: property.depth_mtrs ?? '',
  ownershipType: property.ownership_type || '',
  encumbranceStatus: property.encumbrance_status || '',
  notes: property.notes || '',
  lat: property.lat ?? '',
  lng: property.lng ?? '',
});

const buildEditPayload = (form) => ({
  name: form.name || undefined,
  address: form.address || undefined,
  city: form.city || undefined,
  state: form.state || undefined,
  pincode: form.pincode || undefined,
  propertyType: form.propertyType,
  zoning: form.zoning,
  landAreaValue: form.landAreaValue === '' ? undefined : Number(form.landAreaValue),
  landAreaUnit: form.landAreaUnit,
  circleRatePerSqft: form.circleRatePerSqft === '' ? undefined : Number(form.circleRatePerSqft),
  permissibleFsi: form.permissibleFsi === '' ? undefined : Number(form.permissibleFsi),
  surveyNumber: form.surveyNumber || undefined,
  pid: form.pid || undefined,
  khataNo: form.khataNo || undefined,
  bhoomiId: form.bhoomiId || undefined,
  reraRegistrationNumber: form.reraRegistrationNumber || undefined,
  ownerName: form.ownerName || undefined,
  roadWidthMtrs: form.roadWidthMtrs === '' ? undefined : Number(form.roadWidthMtrs),
  frontageMtrs: form.frontageMtrs === '' ? undefined : Number(form.frontageMtrs),
  depthMtrs: form.depthMtrs === '' ? undefined : Number(form.depthMtrs),
  ownershipType: form.ownershipType || undefined,
  encumbranceStatus: form.encumbranceStatus || undefined,
  notes: form.notes || undefined,
  lat: form.lat === '' ? undefined : Number(form.lat),
  lng: form.lng === '' ? undefined : Number(form.lng),
});

const DetailField = ({ label, value }) => (
  <div>
    <span className="text-content-muted">{label}</span>
    <p className="mt-1 font-medium text-content-primary">{value || '-'}</p>
  </div>
);

export default function PropertyDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState(null);

  const { data: property, isLoading, isError } = useProperty(id);
  const { data: dealsData } = useDeals({ limit: 500 });
  const geocodeMutation = useGeocodeProperty();
  const updateProperty = useUpdateProperty();

  const relatedDeals = useMemo(
    () => (dealsData?.data || []).filter((deal) => deal.property_id === id),
    [dealsData?.data, id]
  );

  const hasCoordinates =
    property?.lat !== null &&
    property?.lat !== undefined &&
    property?.lng !== null &&
    property?.lng !== undefined;
  const googleMapsUrl = hasCoordinates
    ? `https://www.google.com/maps?q=${property.lat},${property.lng}`
    : null;
  const editAreaSqft = editForm
    ? normalizeAreaSqft(editForm.landAreaValue, editForm.landAreaUnit)
    : null;

  const openEditModal = () => {
    if (!property) {
      return;
    }

    setEditForm(buildEditForm(property));
    setShowEditModal(true);
  };

  const handleEditSubmit = async (event) => {
    event.preventDefault();
    if (!editForm) {
      return;
    }

    const hasLat = editForm.lat !== '';
    const hasLng = editForm.lng !== '';

    if (hasLat !== hasLng) {
      toast.error('Enter both latitude and longitude, or leave both blank.');
      return;
    }

    try {
      await updateProperty.mutateAsync({ id, data: buildEditPayload(editForm) });
      setShowEditModal(false);
    } catch {
      // handled by mutation hook
    }
  };

  if (isLoading) {
    return <LoadingSpinner className="py-24" />;
  }

  if (isError || !property) {
    return (
      <div className="py-24">
        <EmptyState
          title="Property not found"
          description="The property details could not be loaded."
          action={
            <button onClick={() => navigate('/dashboard/deals')} className="btn btn-secondary">
              Back to Properties
            </button>
          }
        />
      </div>
    );
  }

  const geocodeMeta = GEOCODE_STATUS_META[property.geocode_status || 'pending'] || {
    label: property.geocode_status || 'Pending',
    cls: 'bg-bg-secondary text-content-secondary',
  };

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate('/dashboard/deals')}
        className="flex items-center gap-1 text-sm text-content-secondary hover:text-content-secondary dark:hover:text-content-muted"
      >
        <ArrowLeft size={16} /> Back to Properties
      </button>

      <PageHeader
        title={property.display_name || property.name || 'Untitled property'}
        description={[property.city, property.state].filter(Boolean).join(', ') || 'Location still being completed'}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {googleMapsUrl && (
              <a
                href={googleMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary inline-flex items-center gap-2 text-sm"
              >
                <ExternalLink size={14} />
                Open in Google Maps
              </a>
            )}
            <button
              type="button"
              onClick={openEditModal}
              className="btn btn-primary inline-flex items-center gap-2 text-sm"
            >
              <Edit2 size={14} />
              Edit Property
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="card-editorial lg:col-span-2">
          <SectionHeader size="sm" title="Property Overview" />
          <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            <DetailField
              label="Property Type"
              value={property.property_type ? PROPERTY_TYPE_LABELS[property.property_type] || property.property_type : '-'}
            />
            <DetailField label="Address" value={property.address || 'Address not captured yet'} />
            <DetailField label="Zoning" value={property.zoning?.replace(/_/g, ' ') || '-'} />
            <DetailField label="Land Area" value={formatArea(property.land_area_sqft)} />
            <DetailField
              label="Circle Rate"
              value={property.circle_rate_per_sqft ? `${formatINR(property.circle_rate_per_sqft)}/sqft` : '-'}
            />
            <DetailField label="Permissible FSI" value={property.permissible_fsi ?? property.existing_fsi ?? '-'} />
            <DetailField label="Survey Number" value={property.survey_number || '-'} />
            <DetailField label="PID" value={property.pid || '-'} />
            <DetailField label="Khata No." value={property.khata_no || '-'} />
            <DetailField label="Bhoomi ID" value={property.bhoomi_id || '-'} />
            <DetailField label="RERA Registration" value={property.rera_registration_number || '-'} />
            <DetailField label="Owner" value={property.owner_name || '-'} />
            <DetailField label="Road Width" value={property.road_width_mtrs ? `${property.road_width_mtrs} m` : '-'} />
            <DetailField
              label="Plot Dimensions"
              value={
                property.frontage_mtrs || property.depth_mtrs
                  ? `${property.frontage_mtrs || '-'} m frontage x ${property.depth_mtrs || '-'} m depth`
                  : '-'
              }
            />
            <DetailField label="Ownership Type" value={property.ownership_type || '-'} />
            <DetailField label="Encumbrance Status" value={property.encumbrance_status || '-'} />
            <DetailField label="Created" value={formatDate(property.created_at)} />
          </div>

          {property.notes && (
            <div className="mt-6 border-t pt-4">
              <span className="text-sm text-content-muted">Notes</span>
              <p className="mt-1 whitespace-pre-line text-sm text-content-secondary">{property.notes}</p>
            </div>
          )}
        </section>

        <section className="card-editorial space-y-5">
          <div>
            <SectionHeader size="sm" title="At a Glance" />
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="shrink-0 rounded-lg bg-primary-50 p-2 text-primary-600">
                  <MapPin size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-content-secondary">Geocode status</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${geocodeMeta.cls}`}>
                      {geocodeMeta.label}
                    </span>
                    {hasCoordinates && (
                      <span className="truncate font-mono text-xs text-content-muted">
                        {Number(property.lat).toFixed(5)}, {Number(property.lng).toFixed(5)}
                      </span>
                    )}
                  </div>
                  {property.geocode_message && (
                    <p className="mt-1 text-xs text-content-muted">{property.geocode_message}</p>
                  )}
                  <button
                    type="button"
                    disabled={geocodeMutation.isPending}
                    onClick={() => geocodeMutation.mutate(id)}
                    className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-700 disabled:opacity-50"
                  >
                    <RefreshCw size={12} className={geocodeMutation.isPending ? 'animate-spin' : ''} />
                    {geocodeMutation.isPending ? 'Re-geocoding...' : 'Re-geocode from address'}
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-primary-50 p-2 text-primary-600">
                  <Ruler size={18} />
                </div>
                <div>
                  <p className="text-xs text-content-secondary">Land Area</p>
                  <p className="text-sm font-medium text-content-primary">{formatArea(property.land_area_sqft)}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-primary-50 p-2 text-primary-600">
                  <IndianRupee size={18} />
                </div>
                <div>
                  <p className="text-xs text-content-secondary">Circle Rate</p>
                  <p className="text-sm font-medium text-content-primary">
                    {property.circle_rate_per_sqft ? `${formatINR(property.circle_rate_per_sqft)}/sqft` : '-'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-primary-50 p-2 text-primary-600">
                  <Building2 size={18} />
                </div>
                <div>
                  <p className="text-xs text-content-secondary">Deals Linked</p>
                  <p className="text-sm font-medium text-content-primary">{property.deal_count || 0}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-hairline-strong bg-bg-secondary p-4/80">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary-600">Location Confidence</p>
                <h3 className="mt-2 text-base font-semibold text-content-primary">
                  {property.geocode_status === 'manual'
                    ? 'Manual coordinates override geocoding'
                    : property.geocode_status === 'approximate'
                      ? 'This pin is approximate'
                      : 'Map-ready location'}
                </h3>
                <p className="mt-1 text-sm text-content-secondary">
                  {property.geocode_status === 'approximate'
                    ? 'This property is excluded from precision map overlays until you tighten the address or save exact coordinates.'
                    : 'Verified and manual coordinates are trusted for nearby comps, land coverage, and deal heat layers.'}
                </p>
              </div>
              <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${geocodeMeta.cls}`}>
                {geocodeMeta.label}
              </span>
            </div>

            {hasCoordinates ? (
              <div className="mt-4 overflow-hidden rounded-2xl border border-hairline-strong">
                <div className="flex items-center justify-between border-b border-hairline-strong bg-white px-4 py-3 text-sm">
                  <div className="text-content-secondary">
                    Lat {Number(property.lat).toFixed(6)} | Lng {Number(property.lng).toFixed(6)}
                  </div>
                  {googleMapsUrl && (
                    <a
                      href={googleMapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-primary-600 hover:text-primary-700"
                    >
                      Open map
                      <ExternalLink size={13} />
                    </a>
                  )}
                </div>
                <ReadOnlyPropertyMap
                  lat={property.lat}
                  lng={property.lng}
                  title="Property reference point"
                  heightClassName="h-72"
                  propertyId={property.id}
                  canEdit
                />
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-hairline-strong px-4 py-8 text-center text-sm text-content-secondary">
                No coordinates yet. Save a more precise address or enter manual lat/lng below to make this property map-ready.
              </div>
            )}
          </div>
        </section>
      </div>

      <MasterPlanZonePanel property={property} />

      <ParcelIntelligencePanel property={property} />

      <section className="card-editorial">
        <SectionHeader size="sm" title="Related Deals" />

        {relatedDeals.length === 0 ? (
          <EmptyState
            title="No deals linked yet"
            description="Create a deal for this property from the Deals page."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {relatedDeals.map((deal) => {
              const stageConfig = STAGE_CONFIG[deal.stage] || STAGE_CONFIG.screening;

              return (
                <Link
                  key={deal.id}
                  to={`/dashboard/deals/${deal.id}`}
                  className="rounded-xl border border-hairline-strong p-4 transition hover:shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-content-primary">{deal.name}</p>
                      <p className="mt-1 text-sm text-content-secondary">{deal.deal_type}</p>
                    </div>
                    <Badge tone={stageConfig.tone}>{stageConfig.label}</Badge>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {showEditModal && editForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 py-8">
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-hairline-strong px-6 py-4">
              <div>
                <h3 className="text-lg font-semibold text-content-primary">Edit Property</h3>
                <p className="mt-1 text-sm text-content-secondary">
                  Update address intelligence, commercial fields, and manual coordinates from one place.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                className="rounded-lg p-2 text-content-muted transition hover:bg-bg-secondary hover:text-content-secondary dark:hover:bg-bg-primary dark:hover:text-content-muted"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="flex min-h-0 flex-1 flex-col">
              <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-sm font-medium text-content-secondary">Property Name</label>
                    <input
                      type="text"
                      value={editForm.name}
                      onChange={(event) => setEditForm((current) => ({ ...current, name: event.target.value }))}
                      className="input"
                      placeholder="Optional if the site is still unnamed"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="mb-1 block text-sm font-medium text-content-secondary">Address</label>
                    <input
                      type="text"
                      value={editForm.address}
                      onChange={(event) => setEditForm((current) => ({ ...current, address: event.target.value }))}
                      className="input"
                      placeholder="Village, survey number, road, landmark..."
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-content-secondary">City</label>
                    <input
                      type="text"
                      value={editForm.city}
                      onChange={(event) => setEditForm((current) => ({ ...current, city: event.target.value }))}
                      className="input"
                      placeholder="Bengaluru"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-content-secondary">State</label>
                    <input
                      type="text"
                      value={editForm.state}
                      onChange={(event) => setEditForm((current) => ({ ...current, state: event.target.value }))}
                      className="input"
                      placeholder="Karnataka"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-content-secondary">Pincode</label>
                    <input
                      type="text"
                      value={editForm.pincode}
                      onChange={(event) => setEditForm((current) => ({ ...current, pincode: event.target.value }))}
                      className="input"
                      placeholder="560001"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-content-secondary">Property Type</label>
                    <select
                      value={editForm.propertyType}
                      onChange={(event) => setEditForm((current) => ({ ...current, propertyType: event.target.value }))}
                      className="input"
                    >
                      {PROPERTY_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-content-secondary">Zoning</label>
                    <select
                      value={editForm.zoning}
                      onChange={(event) => setEditForm((current) => ({ ...current, zoning: event.target.value }))}
                      className="input"
                    >
                      {ZONING_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-content-secondary">Land Extent</label>
                    <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={editForm.landAreaValue}
                        onChange={(event) => setEditForm((current) => ({ ...current, landAreaValue: event.target.value }))}
                        className="input"
                        placeholder="Enter area"
                      />
                      <select
                        value={editForm.landAreaUnit}
                        onChange={(event) => setEditForm((current) => ({ ...current, landAreaUnit: event.target.value }))}
                        className="input"
                      >
                        <option value="sqft">sq ft</option>
                        <option value="acre">acre</option>
                      </select>
                    </div>
                    <p className="mt-2 text-xs text-content-secondary">
                      {editAreaSqft
                        ? `Normalized area: ${formatArea(editAreaSqft)}`
                        : 'Enter whichever land unit you have. REDIP will normalize it for calculations and map coverage.'}
                    </p>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-content-secondary">Circle Rate (INR / sqft)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={editForm.circleRatePerSqft}
                      onChange={(event) => setEditForm((current) => ({ ...current, circleRatePerSqft: event.target.value }))}
                      className="input"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-content-secondary">Permissible FSI</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={editForm.permissibleFsi}
                      onChange={(event) => setEditForm((current) => ({ ...current, permissibleFsi: event.target.value }))}
                      className="input"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-content-secondary">Road Width (m)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={editForm.roadWidthMtrs}
                      onChange={(event) => setEditForm((current) => ({ ...current, roadWidthMtrs: event.target.value }))}
                      className="input"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-content-secondary">Frontage (m)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={editForm.frontageMtrs}
                      onChange={(event) => setEditForm((current) => ({ ...current, frontageMtrs: event.target.value }))}
                      className="input"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-content-secondary">Depth (m)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={editForm.depthMtrs}
                      onChange={(event) => setEditForm((current) => ({ ...current, depthMtrs: event.target.value }))}
                      className="input"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-content-secondary">Survey Number</label>
                    <input
                      type="text"
                      value={editForm.surveyNumber}
                      onChange={(event) => setEditForm((current) => ({ ...current, surveyNumber: event.target.value }))}
                      className="input"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-content-secondary">PID</label>
                    <input
                      type="text"
                      value={editForm.pid}
                      onChange={(event) => setEditForm((current) => ({ ...current, pid: event.target.value }))}
                      className="input"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-content-secondary">Khata No.</label>
                    <input
                      type="text"
                      value={editForm.khataNo}
                      onChange={(event) => setEditForm((current) => ({ ...current, khataNo: event.target.value }))}
                      className="input"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-content-secondary">Bhoomi ID</label>
                    <input
                      type="text"
                      value={editForm.bhoomiId}
                      onChange={(event) => setEditForm((current) => ({ ...current, bhoomiId: event.target.value }))}
                      className="input"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-content-secondary">RERA Registration No.</label>
                    <input
                      type="text"
                      value={editForm.reraRegistrationNumber}
                      onChange={(event) => setEditForm((current) => ({ ...current, reraRegistrationNumber: event.target.value }))}
                      className="input"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-content-secondary">Owner Name</label>
                    <input
                      type="text"
                      value={editForm.ownerName}
                      onChange={(event) => setEditForm((current) => ({ ...current, ownerName: event.target.value }))}
                      className="input"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-content-secondary">Ownership Type</label>
                    <input
                      type="text"
                      value={editForm.ownershipType}
                      onChange={(event) => setEditForm((current) => ({ ...current, ownershipType: event.target.value }))}
                      className="input"
                      placeholder="Freehold, leasehold..."
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="mb-1 block text-sm font-medium text-content-secondary">Encumbrance Status</label>
                    <input
                      type="text"
                      value={editForm.encumbranceStatus}
                      onChange={(event) => setEditForm((current) => ({ ...current, encumbranceStatus: event.target.value }))}
                      className="input"
                      placeholder="Clear, under review..."
                    />
                  </div>
                </div>

                <div className="rounded-2xl border border-hairline-strong bg-bg-secondary p-4/80">
                  <h4 className="text-sm font-semibold text-content-primary">Map Precision Controls</h4>
                  <p className="mt-1 text-sm text-content-secondary">
                    Leave coordinates blank to geocode from the address. Enter both lat and lng only if you want to set an exact manual pin.
                  </p>
                  <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-content-secondary">Latitude</label>
                      <input
                        type="number"
                        min="-90"
                        max="90"
                        step="0.000001"
                        value={editForm.lat}
                        onChange={(event) => setEditForm((current) => ({ ...current, lat: event.target.value }))}
                        className="input"
                        placeholder="12.971599"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-content-secondary">Longitude</label>
                      <input
                        type="number"
                        min="-180"
                        max="180"
                        step="0.000001"
                        value={editForm.lng}
                        onChange={(event) => setEditForm((current) => ({ ...current, lng: event.target.value }))}
                        className="input"
                        placeholder="77.594566"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-content-secondary">Notes</label>
                  <textarea
                    rows={4}
                    value={editForm.notes}
                    onChange={(event) => setEditForm((current) => ({ ...current, notes: event.target.value }))}
                    className="input"
                    placeholder="Capture site nuance, broker context, or diligence notes..."
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-hairline-strong px-6 py-4">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updateProperty.isPending}
                  className="btn btn-primary"
                >
                  {updateProperty.isPending ? 'Saving...' : 'Save Property'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
