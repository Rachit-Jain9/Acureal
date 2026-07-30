import { Map } from 'lucide-react';
import MasterPlanExplorer from '../components/masterplan/MasterPlanExplorer';

/**
 * Master Plan Explorer — a city-wide, analyst-visible view of the Bengaluru
 * RMP 2015 Proposed-Land-Use overlay, with the team's deals pinned on top.
 * Read-only reference (the overlay is community-georeferenced government maps,
 * not an authoritative zone determination); the exact zone/FAR for any parcel
 * comes from the deterministic kernel on a linked property.
 */
export default function MasterPlanExplorerPage() {
  return (
    // DEFINITE viewport height — mirrors the deals MapPage/MapCanvas pattern
    // (`h-[calc(100vh-180px)] min-h-[720px]`). The dashboard shell is
    // `min-h-screen` (not `h-screen`), so no ancestor has a definite height; an
    // `h-full` chain here would collapse the inner Leaflet map to 0px (blank
    // tiles + no zoom controls). A fixed calc height gives the flex-1 map host
    // real space; `min-h-0` lets it shrink, `min-h-[720px]` guards short screens.
    <div className="flex h-[calc(100vh-180px)] min-h-[720px] flex-col gap-3">
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 rounded-md bg-accent-soft p-1.5 text-accent">
            <Map size={18} />
          </span>
          <div>
            <h1 className="font-serif text-xl font-semibold tracking-tight text-content-primary">
              Master Plan Explorer
            </h1>
            <p className="mt-0.5 max-w-2xl text-sm text-content-secondary">
              The BDA Revised Master Plan 2015 land use, georeferenced over the city — fade it over satellite, search a location, and click a deal for its regulatory context. It&apos;s one layer of Acureal&apos;s regulatory coverage: the airport-belt (BIAAPA) and Anekal rulebooks are loaded too, applied on each deal.
            </p>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1">
        <MasterPlanExplorer />
      </div>

      <p className="shrink-0 text-[11px] leading-snug text-content-muted">
        Reference overlay only — RMP 2015 Proposed Land Use (BDA, base year 2007), community-georeferenced via Map Warper. Verify against the official sheet; the authoritative zone, FAR and guidance for a parcel are resolved deterministically on its linked property.
      </p>
    </div>
  );
}
