import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Building2, IndianRupee, MapPin, RefreshCw, Ruler } from 'lucide-react';
import { useProperty, useGeocodeProperty } from '../hooks/useProperties';
import { useDeals } from '../hooks/useDeals';
import LoadingSpinner from '../components/common/LoadingSpinner';
import PageHeader from '../components/common/PageHeader';
import Badge from '../components/common/Badge';
import EmptyState from '../components/common/EmptyState';
import { formatArea, formatDate, formatINR, PROPERTY_TYPE_LABELS, STAGE_CONFIG } from '../utils/format';

const GEOCODE_STATUS_META = {
  verified:          { label: 'Verified',          cls: 'bg-emerald-100 text-emerald-700' },
  manual:            { label: 'Manual',             cls: 'bg-blue-100 text-blue-700' },
  approximate:       { label: 'Approximate (city)', cls: 'bg-amber-100 text-amber-700' },
  failed:            { label: 'Failed',             cls: 'bg-red-100 text-red-700' },
  pending:           { label: 'Pending',            cls: 'bg-gray-100 text-gray-600' },
  insufficient_data: { label: 'Insufficient data',  cls: 'bg-gray-100 text-gray-600' },
};

export default function PropertyDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: property, isLoading, isError } = useProperty(id);
  const { data: dealsData } = useDeals({ limit: 200 });
  const geocodeMutation = useGeocodeProperty();

  const relatedDeals = useMemo(
    () => (dealsData?.data || []).filter((deal) => deal.property_id === id),
    [dealsData?.data, id]
  );

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

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate('/dashboard/deals')}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft size={16} /> Back to Properties
      </button>

      <PageHeader
        title={property.display_name || property.name || 'Untitled property'}
        description={[property.city, property.state].filter(Boolean).join(', ') || 'Location still being completed'}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="card lg:col-span-2">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Property Overview</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-400">Property Type</span>
              <p className="font-medium text-gray-900 mt-1">
                {property.property_type ? (PROPERTY_TYPE_LABELS[property.property_type] || property.property_type) : '-'}
              </p>
            </div>
            <div>
              <span className="text-gray-400">Address</span>
              <p className="font-medium text-gray-900 mt-1">{property.address || 'Address not captured yet'}</p>
            </div>
            <div>
              <span className="text-gray-400">Zoning</span>
              <p className="font-medium text-gray-900 mt-1 capitalize">
                {property.zoning?.replace(/_/g, ' ') || '-'}
              </p>
            </div>
            <div>
              <span className="text-gray-400">Land Area</span>
              <p className="font-medium text-gray-900 mt-1">{formatArea(property.land_area_sqft)}</p>
            </div>
            <div>
              <span className="text-gray-400">Circle Rate</span>
              <p className="font-medium text-gray-900 mt-1">
                {property.circle_rate_per_sqft ? formatINR(property.circle_rate_per_sqft) : '-'}
              </p>
            </div>
            <div>
              <span className="text-gray-400">Permissible FSI</span>
              <p className="font-medium text-gray-900 mt-1">
                {property.permissible_fsi ?? property.existing_fsi ?? '-'}
              </p>
            </div>
            <div>
              <span className="text-gray-400">Survey Number</span>
              <p className="font-medium text-gray-900 mt-1">{property.survey_number || '-'}</p>
            </div>
            <div>
              <span className="text-gray-400">Owner</span>
              <p className="font-medium text-gray-900 mt-1">{property.owner_name || '-'}</p>
            </div>
            <div>
              <span className="text-gray-400">Created</span>
              <p className="font-medium text-gray-900 mt-1">{formatDate(property.created_at)}</p>
            </div>
          </div>

          {property.notes && (
            <div className="mt-6 border-t pt-4">
              <span className="text-gray-400 text-sm">Notes</span>
              <p className="text-sm text-gray-700 mt-1 whitespace-pre-line">{property.notes}</p>
            </div>
          )}
        </section>

        <section className="card">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">At a Glance</h2>
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-primary-50 text-primary-600 shrink-0">
                <MapPin size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-gray-500">Geocode status</p>
                {(() => {
                  const status = property.geocode_status || 'pending';
                  const meta = GEOCODE_STATUS_META[status] || { label: status, cls: 'bg-gray-100 text-gray-600' };
                  return (
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.cls}`}>
                        {meta.label}
                      </span>
                      {property.lat && property.lng && (
                        <span className="text-xs text-gray-400 font-mono truncate">
                          {Number(property.lat).toFixed(5)}, {Number(property.lng).toFixed(5)}
                        </span>
                      )}
                    </div>
                  );
                })()}
                {property.geocode_message && (
                  <p className="mt-1 text-xs text-gray-400 truncate" title={property.geocode_message}>
                    {property.geocode_message}
                  </p>
                )}
                <button
                  type="button"
                  disabled={geocodeMutation.isPending}
                  onClick={() => geocodeMutation.mutate(id)}
                  className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-700 disabled:opacity-50"
                >
                  <RefreshCw size={12} className={geocodeMutation.isPending ? 'animate-spin' : ''} />
                  {geocodeMutation.isPending ? 'Re-geocoding…' : 'Re-geocode from address'}
                </button>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary-50 text-primary-600">
                <Ruler size={18} />
              </div>
              <div>
                <p className="text-xs text-gray-500">Land Area</p>
                <p className="text-sm font-medium text-gray-900">{formatArea(property.land_area_sqft)}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary-50 text-primary-600">
                <IndianRupee size={18} />
              </div>
              <div>
                <p className="text-xs text-gray-500">Circle Rate</p>
                <p className="text-sm font-medium text-gray-900">
                  {property.circle_rate_per_sqft ? formatINR(property.circle_rate_per_sqft) : '-'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary-50 text-primary-600">
                <Building2 size={18} />
              </div>
              <div>
                <p className="text-xs text-gray-500">Deals Linked</p>
                <p className="text-sm font-medium text-gray-900">{property.deal_count || 0}</p>
              </div>
            </div>
          </div>
        </section>
      </div>

      <section className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Related Deals</h2>

        {relatedDeals.length === 0 ? (
          <EmptyState
            title="No deals linked yet"
            description="Create a deal for this property from the Deals page."
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {relatedDeals.map((deal) => {
              const stageConfig = STAGE_CONFIG[deal.stage] || STAGE_CONFIG.screening;

              return (
                <Link
                  key={deal.id}
                  to={`/dashboard/deals/${deal.id}`}
                  className="rounded-xl border border-gray-200 p-4 hover:shadow-sm transition"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-gray-900">{deal.name}</p>
                      <p className="text-sm text-gray-500 mt-1">{deal.deal_type}</p>
                    </div>
                    <Badge className={stageConfig.color}>{stageConfig.label}</Badge>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
