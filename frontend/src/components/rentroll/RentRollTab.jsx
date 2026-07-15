import { EmptyState } from '../../design-system';
import { useDealContext, useDealRecord } from '../../hooks/useDealContext';
import { registerFamilyFor, REGISTER_TAB_LABELS } from './rentRollColumns';
import LeaseRegisterView from './LeaseRegisterView';
import SalesRegisterView from './SalesRegisterView';
import HotelRegisterView from './HotelRegisterView';
import OccupantRegisterView from './OccupantRegisterView';

// Deal Register tab — a thin dispatcher. Each asset class routes to its
// register family's view; the shared scaffolding (settings autosave, staleness
// banner, Apply-to-Financials) lives in registerShared.jsx.

export default function RentRollTab({ canEdit = false }) {
  const { dealId } = useDealContext();
  const deal = useDealRecord();
  const assetClass = deal?.asset_class || 'commercial_office';
  const family = registerFamilyFor(assetClass);

  if (family === 'lease_income') {
    return <LeaseRegisterView dealId={dealId} assetClass={assetClass} canEdit={canEdit} />;
  }
  if (family === 'sales_collections') {
    return <SalesRegisterView dealId={dealId} assetClass={assetClass} canEdit={canEdit} />;
  }
  if (family === 'hotel_operating') {
    return <HotelRegisterView dealId={dealId} assetClass={assetClass} canEdit={canEdit} />;
  }
  if (family === 'redevelopment') {
    return <OccupantRegisterView dealId={dealId} assetClass={assetClass} canEdit={canEdit} />;
  }

  return (
    <EmptyState
      title={`${REGISTER_TAB_LABELS[family]} register is on its way`}
      description="This deal type gets its own register format in an upcoming update. Nothing here is simulated in the meantime."
    />
  );
}
