import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Search,
  Plus,
  X,
  MapPin,
  Building2,
  Ruler,
  IndianRupee,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useProperties, useCreateProperty, useDeleteProperty } from '../hooks/useProperties';
import LoadingSpinner from '../components/common/LoadingSpinner';
import EmptyState from '../components/common/EmptyState';
import PageHeader from '../components/common/PageHeader';
import Badge from '../components/common/Badge';
import { formatINR, formatArea, PROPERTY_TYPE_LABELS } from '../utils/format';
import { normalizeAreaSqft } from '../utils/landPricing';

const ZONING_OPTIONS = [
  { value: 'residential', label: 'Residential' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'industrial', label: 'Industrial' },
  { value: 'mixed_use', label: 'Mixed Use' },
  { value: 'agricultural', label: 'Agricultural' },
];

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

const ITEMS_PER_PAGE = 12;

const initialFormState = {
  name: '',
  address: '',
  city: '',
  state: '',
  pincode: '',
  propertyType: 'land',
  zoning: 'residential',
  landAreaValue: '',
  landAreaUnit: 'sqft',
  circleRatePerSqft: '',
  permissibleFsi: '',
  surveyNumber: '',
  ownerName: '',
};

const zoningLabel = (value) =>
  ZONING_OPTIONS.find((option) => option.value === value)?.label || value || '-';

export default function PropertiesPage() {
  const [search, setSearch] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [propertyTypeFilter, setPropertyTypeFilter] = useState('');
  const [zoningFilter, setZoningFilter] = useState('');
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(initialFormState);

  const queryParams = useMemo(() => {
    const params = { page, limit: ITEMS_PER_PAGE };
    if (search) params.search = search;
    if (cityFilter) params.city = cityFilter;
    if (propertyTypeFilter) params.propertyType = propertyTypeFilter;
    if (zoningFilter) params.zoning = zoningFilter;
    return params;
  }, [cityFilter, page, propertyTypeFilter, search, zoningFilter]);

  const { data, isLoading, isError } = useProperties(queryParams);
  const createProperty = useCreateProperty();
  const deleteProperty = useDeleteProperty();

  const properties = data?.data || [];
  const pagination = data?.pagination || { total: 0, page: 1, totalPages: 1 };
  const cities = [...new Set(properties.map((property) => property.city).filter(Boolean))];
  const landAreaPreviewSqft = normalizeAreaSqft(form.landAreaValue, form.landAreaUnit);
  const landAreaPreviewAcres = landAreaPreviewSqft ? landAreaPreviewSqft / 43560 : null;

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      await createProperty.mutateAsync({
        ...form,
        circleRatePerSqft: form.circleRatePerSqft ? Number(form.circleRatePerSqft) : undefined,
        permissibleFsi: form.permissibleFsi ? Number(form.permissibleFsi) : undefined,
        pincode: form.pincode || undefined,
        surveyNumber: form.surveyNumber || undefined,
        ownerName: form.ownerName || undefined,
        name: form.name || undefined,
        address: form.address || undefined,
        city: form.city || undefined,
        state: form.state || undefined,
        landAreaValue: form.landAreaValue ? Number(form.landAreaValue) : undefined,
        landAreaUnit: form.landAreaUnit,
      });
      setForm(initialFormState);
      setShowModal(false);
    } catch {
      // Mutation hook handles the toast.
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this property?')) {
      return;
    }

    try {
      await deleteProperty.mutateAsync(id);
    } catch {
      // Mutation hook handles the toast.
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        title="Properties"
        description={`${pagination.total} propert${pagination.total === 1 ? 'y' : 'ies'} in the land bank`}
      />

      <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search properties..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-4 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>

        <div className="flex items-center gap-3">
          <select
            value={cityFilter}
            onChange={(e) => {
              setCityFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            <option value="">All Cities</option>
            {cities.map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </select>

          <select
            value={propertyTypeFilter}
            onChange={(e) => {
              setPropertyTypeFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            <option value="">All Types</option>
            {PROPERTY_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            value={zoningFilter}
            onChange={(e) => {
              setZoningFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            <option value="">All Zoning</option>
            {ZONING_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <button
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
          >
            <Plus className="h-4 w-4" />
            Add Property
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <LoadingSpinner />
        </div>
      ) : isError ? (
        <div className="py-20 text-center text-sm text-red-500">
          Failed to load properties. Please try again.
        </div>
      ) : properties.length === 0 ? (
        <div className="py-20">
          <EmptyState
            title="No properties found"
            description="Get started by adding your first property."
            action={
              <button
                onClick={() => setShowModal(true)}
                className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
              >
                <Plus className="h-4 w-4" />
                Add Property
              </button>
            }
          />
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {properties.map((property) => (
              <div
                key={property.id}
                className="group relative rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:shadow-md"
              >
                <div className="mb-3 flex items-start justify-between">
                  <Link
                    to={`/dashboard/properties/${property.id}`}
                    className="text-lg font-semibold text-gray-900 hover:text-primary-600"
                  >
                    {property.display_name || property.name || 'Untitled property'}
                  </Link>
                  <div className="flex items-center gap-2">
                    {property.property_type && (
                      <Badge className="bg-slate-100 text-slate-700">
                        {PROPERTY_TYPE_LABELS[property.property_type] || property.property_type}
                      </Badge>
                    )}
                    {property.zoning && <Badge>{zoningLabel(property.zoning)}</Badge>}
                  </div>
                </div>

                <div className="mb-4 flex items-center gap-1 text-sm text-gray-500">
                  <MapPin className="h-3.5 w-3.5" />
                  <span className="truncate">
                    {property.address || 'Address pending'}
                    {property.city && `, ${property.city}`}
                    {property.state && `, ${property.state}`}
                  </span>
                </div>

                {property.geocode_status && (
                  <p className="mb-4 text-xs text-gray-500">
                    Map sync: {property.geocode_status.replace(/_/g, ' ')}
                    {property.geocode_message ? ` - ${property.geocode_message}` : ''}
                  </p>
                )}

                <div className="grid grid-cols-3 gap-3 border-t border-gray-100 pt-3">
                  <div className="flex flex-col items-center gap-1">
                    <Ruler className="h-4 w-4 text-gray-400" />
                    <span className="text-xs text-gray-500">Area</span>
                    <span className="text-sm font-medium text-gray-900">
                      {property.land_area_sqft ? formatArea(property.land_area_sqft) : '-'}
                    </span>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <IndianRupee className="h-4 w-4 text-gray-400" />
                    <span className="text-xs text-gray-500">Circle Rate</span>
                    <span className="text-sm font-medium text-gray-900">
                      {property.circle_rate_per_sqft ? formatINR(property.circle_rate_per_sqft) : '-'}
                    </span>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <Building2 className="h-4 w-4 text-gray-400" />
                    <span className="text-xs text-gray-500">FSI</span>
                    <span className="text-sm font-medium text-gray-900">
                      {property.permissible_fsi ?? property.existing_fsi ?? '-'}
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => handleDelete(property.id)}
                  className="absolute right-2 top-2 hidden rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 group-hover:block"
                  title="Delete property"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          {pagination.totalPages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-2">
              <button
                onClick={() => setPage((currentPage) => Math.max(1, currentPage - 1))}
                disabled={page <= 1}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </button>
              <span className="text-sm text-gray-600">
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <button
                onClick={() => setPage((currentPage) => Math.min(pagination.totalPages, currentPage + 1))}
                disabled={page >= pagination.totalPages}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
              <h2 className="text-xl font-semibold text-gray-900">Add Property</h2>
              <button
                onClick={() => {
                  setShowModal(false);
                  setForm(initialFormState);
                }}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="mb-1 block text-sm font-medium text-gray-700">Property Name</label>
                  <input
                    type="text"
                    name="name"
                    value={form.name}
                    onChange={handleFormChange}
                    placeholder="Optional if you only know the location for now"
                    className="input"
                  />
                </div>

                <div className="col-span-2">
                  <label className="mb-1 block text-sm font-medium text-gray-700">Address</label>
                  <input
                    type="text"
                    name="address"
                    value={form.address}
                    onChange={handleFormChange}
                    placeholder="Optional. The map will geocode this automatically when enough detail is available."
                    className="input"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">City</label>
                  <input
                    type="text"
                    name="city"
                    value={form.city}
                    onChange={handleFormChange}
                    placeholder="Bengaluru, Mumbai..."
                    className="input"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">State</label>
                  <input
                    type="text"
                    name="state"
                    value={form.state}
                    onChange={handleFormChange}
                    placeholder="Karnataka, Maharashtra..."
                    className="input"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Pincode</label>
                  <input
                    type="text"
                    name="pincode"
                    value={form.pincode}
                    onChange={handleFormChange}
                    className="input"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Property Type</label>
                  <select
                    name="propertyType"
                    value={form.propertyType}
                    onChange={handleFormChange}
                    className="input"
                  >
                    {PROPERTY_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Zoning *</label>
                  <select
                    name="zoning"
                    value={form.zoning}
                    onChange={handleFormChange}
                    className="input"
                  >
                    {ZONING_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="col-span-2">
                  <label className="mb-1 block text-sm font-medium text-gray-700">Land Extent</label>
                  <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
                    <input
                      type="number"
                      name="landAreaValue"
                      value={form.landAreaValue}
                      onChange={handleFormChange}
                      min="0"
                      step="0.01"
                      placeholder="Enter acres or sqft"
                      className="input"
                    />
                    <select
                      name="landAreaUnit"
                      value={form.landAreaUnit}
                      onChange={handleFormChange}
                      className="input"
                    >
                      <option value="sqft">sq ft</option>
                      <option value="acre">acre</option>
                    </select>
                  </div>
                  <p className="mt-2 text-xs text-gray-500">
                    {landAreaPreviewSqft
                      ? `Normalized area: ${formatArea(landAreaPreviewSqft)} (${landAreaPreviewAcres?.toFixed(4)} acres)`
                      : 'Enter whichever unit you have. REDIP converts and stores the normalized sqft area automatically.'}
                  </p>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Circle Rate (INR / sqft)</label>
                  <input
                    type="number"
                    name="circleRatePerSqft"
                    value={form.circleRatePerSqft}
                    onChange={handleFormChange}
                    min="0"
                    step="0.01"
                    className="input"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Permissible FSI</label>
                  <input
                    type="number"
                    name="permissibleFsi"
                    value={form.permissibleFsi}
                    onChange={handleFormChange}
                    min="0"
                    step="0.01"
                    className="input"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Survey Number</label>
                  <input
                    type="text"
                    name="surveyNumber"
                    value={form.surveyNumber}
                    onChange={handleFormChange}
                    className="input"
                  />
                </div>

                <div className="col-span-2">
                  <label className="mb-1 block text-sm font-medium text-gray-700">Owner Name</label>
                  <input
                    type="text"
                    name="ownerName"
                    value={form.ownerName}
                    onChange={handleFormChange}
                    className="input"
                  />
                </div>
              </div>

              </div>
              <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 flex-shrink-0 rounded-b-xl">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    setForm(initialFormState);
                  }}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createProperty.isPending}
                  className="btn btn-primary"
                >
                  {createProperty.isPending ? 'Creating...' : 'Create Property'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
