import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import PageHeader from '../components/common/PageHeader';
import ParcelEvidenceExplorer from '../components/parcel/ParcelEvidenceExplorer';
import { useStreetLookup } from '../hooks/useMasterPlan';

/**
 * Parcel Evidence Room — the authenticated home of the gazette-cited BBMP
 * street register. The explorer itself (search, results, evidence chain,
 * Kaveri verify, disclaimers) lives in ParcelEvidenceExplorer and is shared
 * verbatim with the public /parcel front door; what this page owns is the
 * app chrome and the deal-gated terminal CTA — FAR/buildable is resolved
 * deterministically only inside a deal, from an analyst-verified RMP zone.
 */
export default function ParcelEvidenceRoomPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Bengaluru · Gazette-verified reference"
        title="Parcel Evidence Room"
        description="Type any Bengaluru street and trace its evidence chain — ward, BBMP-UAV zone, and IGR guidance-value band — each read from, and cited to, the exact page of the 686-page BBMP Guidance-Value gazette. This is Acureal's own indexed register of every street inside BBMP limits: reference intelligence you can check against the source, not a black box."
      />
      <ParcelEvidenceExplorer
        useLookup={useStreetLookup}
        limit={40}
        terminalCta={(
          <>
            <p className="mt-1 text-sm text-content-secondary leading-relaxed max-w-[52ch]">
              Resolved deterministically <span className="text-content-primary font-medium">inside a deal</span>, from an
              analyst-verified RMP-2015 zone — never auto-asserted from a street name. Link this parcel to a deal to
              compute buildable potential with full provenance.
            </p>
            <Link
              to="/dashboard/deals"
              className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-accent text-white hover:bg-accent-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              Start a deal to underwrite this parcel
              <ArrowRight size={13} />
            </Link>
          </>
        )}
      />
    </div>
  );
}
