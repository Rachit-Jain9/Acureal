import { Link } from 'react-router-dom';
import { ExternalLink, MapPin, AlertCircle } from 'lucide-react';
import { formatArea, formatDate } from '../../utils/format';

function FieldRow({ label, value, span = false }) {
  if (!value && value !== 0) return null;
  return (
    <div className={span ? 'col-span-2 sm:col-span-3' : ''}>
      <dt className="text-xs text-gray-400 mb-0.5">{label}</dt>
      <dd className="text-sm font-medium text-gray-900">{value}</dd>
    </div>
  );
}

export default function ParcelTab({ deal }) {
  const hasProperty = !!deal.property_id;
  const hasLatLng = deal.lat != null && deal.lng != null;

  const landAreaAcres =
    deal.land_area_sqft != null
      ? (deal.land_area_sqft / 43560).toFixed(3) + ' acres'
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
          <Link
            to={`/properties/${deal.property_id}`}
            className="text-sm text-primary-700 font-medium hover:text-primary-800 flex items-center gap-1"
          >
            View / Edit Property Record <ExternalLink size={13} />
          </Link>
        </div>
      ) : (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
          <AlertCircle size={16} className="text-amber-500 flex-shrink-0" />
          <p className="text-sm text-amber-800">
            No property record linked to this deal. Link a property to unlock geocoding, site
            details, and nearby comps.
          </p>
        </div>
      )}

      {/* Site Details Grid */}
      <div className="card">
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
      <div className="card">
        <h3 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <MapPin size={16} className="text-gray-400" />
          Location Map
        </h3>
        {hasLatLng ? (
          <div className="space-y-3">
            <div className="flex items-center gap-4 text-sm text-gray-600">
              <span>
                Lat: <strong>{Number(deal.lat).toFixed(6)}</strong>
              </span>
              <span>
                Lng: <strong>{Number(deal.lng).toFixed(6)}</strong>
              </span>
              <a
                href={`https://www.google.com/maps?q=${deal.lat},${deal.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-600 hover:text-primary-700 flex items-center gap-1"
              >
                Open in Google Maps <ExternalLink size={12} />
              </a>
            </div>
            <div className="h-56 rounded-lg overflow-hidden border border-gray-200 bg-gray-100 flex items-center justify-center">
              <iframe
                title="property-map"
                width="100%"
                height="100%"
                style={{ border: 0 }}
                loading="lazy"
                src={`https://maps.google.com/maps?q=${deal.lat},${deal.lng}&z=15&output=embed`}
              />
            </div>
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
          </div>
        )}
      </div>

      {/* Additional Technical Details */}
      {(deal.rera_number || deal.target_launch_date || deal.expected_close_date) && (
        <div className="card">
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
    </div>
  );
}
