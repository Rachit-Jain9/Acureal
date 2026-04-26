import ParcelIntelligencePanel from './ParcelIntelligencePanel';
import MasterPlanZonePanel from './MasterPlanZonePanel';
import { ErrorState } from '../../design-system';
import { useProperty } from '../../hooks/useProperties';

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

export default function ZoningTab({ deal, dealId, setTab }) {
  const propertyStub = resolveLinkedProperty(deal);
  const { data: hydratedProperty } = useProperty(propertyStub?.id);
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
              className="rounded-editorial bg-primary-600 px-3 py-2 text-xs font-semibold text-white hover:bg-primary-700"
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

  return (
    <div className="space-y-5">
      <MasterPlanZonePanel property={property} />
      <ParcelIntelligencePanel
        property={property}
        deal={deal}
        dealId={dealId}
        onUploadClick={setTab ? () => setTab('documents') : undefined}
      />
    </div>
  );
}
