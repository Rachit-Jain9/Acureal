import ParcelIntelligencePanel from './ParcelIntelligencePanel';
import MasterPlanZonePanel from './MasterPlanZonePanel';
import DealPlanningContextCard from './DealPlanningContextCard';
import DealStreetLookupCard from './DealStreetLookupCard';
import { ErrorState, Skeleton } from '../../design-system';
import { useProperty } from '../../hooks/useProperties';
import { useDealContext, useDealRecord } from '../../hooks/useDealContext';

const resolveLinkedProperty = (deal) => {
  if (deal?.property?.id) return deal.property;
  if (deal?.property_id) {
    return {
      id: deal.property_id,
      name: deal.property_name,
      address: deal.property_address,
      city: deal.property_city,
      state: deal.property_state,
    };
  }
  return null;
};

export default function ZoningTab({ setTab }) {
  const { dealId } = useDealContext();
  const deal = useDealRecord();
  const propertyStub = resolveLinkedProperty(deal);
  const { data: hydratedProperty, isLoading: propertyLoading } = useProperty(propertyStub?.id);
  const property = hydratedProperty ? { ...propertyStub, ...hydratedProperty } : propertyStub;

  if (!property?.id) {
    return (
      <ErrorState
        title="Link a property first"
        tone="info"
        action={
          setTab ? (
            <button
              type="button"
              onClick={() => setTab('parcel')}
              className="rounded-editorial bg-accent px-3 py-2 text-xs font-semibold text-content-inverse hover:bg-accent"
            >
              Open Parcel
            </button>
          ) : null
        }
      >
        Parcel Intelligence needs a linked property record so zoning, buildability, guidance value, and K-GIS context can be sourced from one place.
      </ErrorState>
    );
  }

  // While the full property record (zone_id, parcel fields) is still hydrating,
  // hold a skeleton — otherwise MasterPlanZonePanel briefly flashes
  // "Not assigned / Needs review" against the bare stub before the real zone
  // resolves on a zone-assigned deal.
  if (propertyStub?.id && propertyLoading && !hydratedProperty) {
    return (
      <div className="space-y-5" role="status" aria-busy="true" aria-label="Loading zoning context">
        <Skeleton className="h-44 w-full rounded-editorial border border-hairline" />
        <Skeleton className="h-32 w-full rounded-editorial border border-hairline" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <MasterPlanZonePanel property={property} />
      <DealStreetLookupCard property={property} deal={deal} />
      <DealPlanningContextCard />
      <ParcelIntelligencePanel
        property={property}
        deal={deal}
        dealId={dealId}
        onUploadClick={setTab ? () => setTab('documents') : undefined}
      />
    </div>
  );
}
