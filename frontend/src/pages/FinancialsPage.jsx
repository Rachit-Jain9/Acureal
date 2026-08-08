import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Calculator, Building2, ChevronDown, Lock } from 'lucide-react';
import ReferenceMenu from '../components/financials/ReferenceMenu';
import AssetClassInsightBanner from '../components/financials/AssetClassInsightBanner';
import QuarterlyProformaPanel from '../components/financials/QuarterlyProformaPanel';
import { useFinancials, useCalculateFinancials } from '../hooks/useFinancials';
import { scrollIntoView } from '../utils/motion';
import InputForm from '../components/financials/InputForm';
import WhatIfSliders from '../components/financials/WhatIfSliders';
import SensitivityTornado from '../components/financials/SensitivityTornado';
// PR-NX48 (2026-05-19) — AI sensitivity narrative panel that surfaces
// the same OpenAI-synthesized driver decomposition + recommended
// stress tests that ships in the DOCX Financials section (PR-NX44).
import SensitivityNarrativePanel from '../components/financials/SensitivityNarrativePanel';
// PR-NX56 (2026-05-19) — Post-Calculate panel that compares the actual
// kernel-computed DSCR + YoC/Exit-Cap spread against the same RBI + IC
// thresholds the XLSX-export validators (PR-NX28 / NX33) enforce. Closes
// the loop with the input-time predictive warnings from PR-NX52.
import PostCalcBenchmarkPanel from '../components/financials/PostCalcBenchmarkPanel';
// Workstream A (Provenance Spine) — read-side model-confidence summary.
import ModelConfidencePanel from '../components/financials/ModelConfidencePanel';
import ScenarioComparison from '../components/financials/ScenarioComparison';
import AuditTrailChip from '../components/financials/AuditTrailChip';
import JDAWaterfallPanel from '../components/financials/JDAWaterfallPanel';
import JVWaterfallPanel from '../components/financials/JVWaterfallPanel';
import DebtSchedulePanel from '../components/financials/DebtSchedulePanel';
import { KPICards, AreaBreakdown, CostBreakdown, RevenuePanel } from '../components/financials/ResultPanels';
import SensitivityTable from '../components/financials/SensitivityTable';
import {
  ASSET_CLASSES,
  getModelAssetClass,
  getFinancialModelLabel,
} from '../components/financials/fieldDefs';
import { useDeal } from '../hooks/useDeals';
import { useCanEdit } from '../hooks/useCanEdit';
import { readPrefill, clearPrefill } from '../utils/programmeToInputs';
import { toast } from '../components/common/Toast';
import EmptyState from '../components/common/EmptyState';
import PageHeader from '../components/common/PageHeader';
import { SkeletonKpi, SkeletonCard } from '../design-system';
import { normalizeFinancials, hasLegacyResidentialLoadingFactor } from '../components/financials/normalizeFinancials';
// P1-PR3 (2026-05-26) — scroll-on-mount when an evidence-ref click lands
// on this page. The hook reads `?scroll=<id>` from the URL, scrolls the
// matching element into view, and flashes it briefly.
import { useScrollOnMount } from '../hooks/useEvidenceNavigate';


// Recharts-backed result visuals — lazy-loaded so the ~115 KB gz recharts
// vendor chunk only fetches once a model is computed and the result view
// mounts. The input-first view (form + reference data) never pays the tax.
// Mirrors the dashboard chart-widget lazy pattern (DashboardPage.jsx).
const FinancialVisualizationLayer = lazy(() => import('../components/financials/FinancialVisualizationLayer'));
const HospitalityProformaSection = lazy(() => import('../components/financials/HospitalityProformaSection'));
const CashFlowChart = lazy(() => import('../components/financials/CashFlowChart'));

// ─── MAIN PAGE ─────────────────────────────────────────────────────────────

export default function FinancialsPage() {
  const { dealId } = useParams();
  const { data: financials, isLoading, error } = useFinancials(dealId);
  const { data: deal } = useDeal(dealId);
  const calculateMutation = useCalculateFinancials();
  // Viewer (read-only) members can see every computed panel — KPIs, what-if,
  // sensitivity, scenarios, charts all render from the client kernel — but the
  // Calculate/Recalculate write path is editor+ only (mirrors the backend's
  // requireRole('admin','analyst') gate on POST /financials/:id/calculate).
  const canEdit = useCanEdit();
  useScrollOnMount();

  // Prefill staged by "Apply to underwriting" (Zoning) or "Apply to
  // Financials" (Rent Roll) lives in sessionStorage. Read-and-clear ONCE at
  // mount: the value then lives in page state for the whole visit, so a
  // refresh never re-applies it over user edits, and nothing downstream can
  // wipe it mid-render (the old consume-callback pattern nulled the state one
  // effect-tick after applying, erasing the seeded values from the form).
  const [prefill, setPrefill] = useState(() => {
    const staged = readPrefill(dealId);
    if (staged) clearPrefill(dealId);
    return staged;
  });
  // Snapshot citation rides the eventual Calculate (one-shot, class-gated).
  const [rentRollProvenance, setRentRollProvenance] = useState(
    () => prefill?.__rentRollProvenance || null,
  );
  // Class resolution order: explicit user choice → the class the prefill was
  // built for (an Apply flow must land on ITS model, not whatever an older
  // saved row says) → the saved model's class → the deal's own asset class.
  // Defaulting to residential on a first-time model silently discarded the
  // register prefill through InputForm's class-mismatch guard.
  const existingClass = financials?.asset_class || deal?.asset_class || 'residential_apartments';
  const [selectedClass, setSelectedClass] = useState(
    () => prefill?.__prefilledAssetClass || null,
  ); // null = use stored/deal class
  const activeClass = selectedClass || existingClass;

  // Cross-deal navigation only — the mount case is handled by the
  // initializers above (re-running the read here would find the storage
  // already cleared and null out the state we just captured).
  const prevDealIdRef = useRef(dealId);
  useEffect(() => {
    if (prevDealIdRef.current === dealId) return;
    prevDealIdRef.current = dealId;
    const next = readPrefill(dealId);
    if (next) clearPrefill(dealId);
    setPrefill(next);
    setRentRollProvenance(next?.__rentRollProvenance || null);
    setSelectedClass(next?.__prefilledAssetClass || null);
  }, [dealId]);

  const inputsRef = useRef(null);
  const scrollToInputs = () => {
    scrollIntoView(inputsRef.current, { block: 'start' });
  };
  useEffect(() => {
    if (!prefill) return;
    if (prefill.__prefilledFrom === 'rent_roll') {
      const p = prefill.__rentRollProvenance || {};
      toast.success(
        `Income assumptions pre-filled from the rent roll (${p.contractedLeases ?? '—'} lease(s), as of ${p.asOfDate ?? '—'}). Review and hit Calculate.`,
      );
    } else {
      toast.success('Underwriting inputs pre-filled from buildability programme. Review and hit Calculate.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);
  const normalizedFinancials = useMemo(() => normalizeFinancials(financials), [financials]);
  const hasResults = !!normalizedFinancials;
  const activeFinancialModelLabel = getFinancialModelLabel(activeClass);
  const showLegacyResidentialNotice = useMemo(
    () => hasLegacyResidentialLoadingFactor(financials),
    [financials]
  );

  const handleCalculate = (data) => {
    // Attach the register-snapshot citation ONLY when calculating the class
    // the seeding was built for, and only once — after a successful save the
    // server's reconciliation rule owns the citation (it carries it forward
    // while the accepted values still hold, drops it on hand-edits).
    const attachProvenance = Boolean(
      rentRollProvenance && prefill?.__prefilledAssetClass === activeClass,
    );
    calculateMutation.mutate(
      {
        dealId,
        data: attachProvenance ? { ...data, rentRollProvenance } : data,
      },
      { onSuccess: () => { if (attachProvenance) setRentRollProvenance(null); } },
    );
  };

  const handleClassChange = (cls) => {
    setSelectedClass(cls);
  };

  // Skeleton: page chrome + KPI strip + DCF inputs panel + summary card. The
  // financials page mounts a heavy bundle (Recharts + tornado), so a skeleton
  // anchors the user's eye while the chunk loads.
  if (isLoading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <PageHeader title="DCF Underwriting" description="Multi-asset-class financial modeling" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <SkeletonKpi />
          <SkeletonKpi />
          <SkeletonKpi />
          <SkeletonKpi />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <SkeletonCard height="h-80" />
          <SkeletonCard height="h-80" className="lg:col-span-2" />
        </div>
      </div>
    );
  }

  const shouldShowError = error && error?.response?.status !== 404;

  return (
    <div className="space-y-6">
      <PageHeader
        title="DCF Underwriting"
        description="Multi-asset-class financial modeling"
        actions={
          <div className="flex items-center gap-2">
            <ReferenceMenu assetClass={activeClass} />
            <Link to={`/dashboard/deals/${dealId}`} className="btn btn-secondary flex items-center gap-1.5">
              <ArrowLeft size={16} /> Back to Deal
            </Link>
          </div>
        }
      />

      <AssetClassInsightBanner assetClass={activeClass} />

      {/* Asset Class Selector */}
      <div className="bg-bg-elevated rounded-xl shadow-sm border border-hairline-strong p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-sm font-medium text-content-secondary">
            <Building2 size={16} className="text-accent" />
            Asset Class
          </div>
          <div className="relative">
            <select
              value={activeClass}
              onChange={(e) => handleClassChange(e.target.value)}
              className="appearance-none pl-3 pr-8 py-2 border border-hairline-strong rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-accent bg-bg-elevated"
            >
              {ASSET_CLASSES.map((ac) => (
                <option key={ac.value} value={ac.value}>{ac.label}</option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-content-muted pointer-events-none" />
          </div>
          <span className="text-xs text-content-secondary">
            Underwriting model: {activeFinancialModelLabel}
          </span>
          {hasResults && normalizedFinancials.assetClass !== activeClass && (
            <span className="text-xs text-premium bg-premium-soft px-2 py-1 rounded border border-hairline">
              Switching class — current results shown above are for {ASSET_CLASSES.find((a) => a.value === normalizedFinancials.assetClass)?.label}
            </span>
          )}
        </div>
      </div>

      {showLegacyResidentialNotice && (
        <div className="rounded-xl border border-hairline bg-premium-soft px-4 py-3 text-sm text-premium">
          This residential model was saved under the legacy loading-factor logic. The recalculate form below now normalizes the loading factor to the corrected additive format, but the KPI cards above remain the previously saved output until you click `Calculate`.
        </div>
      )}

      {/* Results for existing financials */}
      {hasResults && (
        <>
          <KPICards kpis={normalizedFinancials.kpis} assetClass={normalizedFinancials.assetClass} inputs={normalizedFinancials.inputs} />

          {/* PR-NX56 (2026-05-19) — Underwriting-benchmark panel sits
              directly under the KPI tile strip. Surfaces DSCR-below-floor
              and YoC-vs-Exit-Cap-spread warnings from the same thresholds
              the XLSX export validates against — but live, on the screen,
              the moment Calculate completes. Hidden when bands not yet
              loaded; renders quiet "all clear" green pill when within band. */}
          <PostCalcBenchmarkPanel
            dealId={dealId}
            kpis={normalizedFinancials.kpis}
            inputs={normalizedFinancials.inputs}
          />

          {/* Workstream A — how much of this model is set for the deal vs.
              running on Acureal benchmark defaults. Hides itself when the model
              class is not yet catalogued. */}
          <ModelConfidencePanel dealId={dealId} />

          <WhatIfSliders
            assetClass={normalizedFinancials.assetClass}
            baseInputs={normalizedFinancials.inputs}
            baseKpis={normalizedFinancials.kpis}
            onEditInputs={scrollToInputs}
          />

          {/* PR-NX48 (2026-05-19) — AI sensitivity narrative. Renders
              ABOVE the tornado so the operator sees "which drivers
              matter most + recommended stress tests" before the visual.
              Hidden entirely when sensitivity grid is sparse / no
              financial model exists (matches DOCX behavior). */}
          <SensitivityNarrativePanel dealId={dealId} />

          <SensitivityTornado
            assetClass={normalizedFinancials.assetClass}
            baseInputs={normalizedFinancials.inputs}
            baseKpis={normalizedFinancials.kpis}
            onEditInputs={scrollToInputs}
          />

          <ScenarioComparison
            assetClass={normalizedFinancials.assetClass}
            baseInputs={normalizedFinancials.inputs}
            baseKpis={normalizedFinancials.kpis}
            onEditInputs={scrollToInputs}
          />

          <Suspense fallback={<SkeletonCard height="h-[420px]" />}>
            <FinancialVisualizationLayer
              financials={normalizedFinancials}
              inputs={normalizedFinancials.inputs}
            />
          </Suspense>

          {normalizedFinancials.assetClass === 'hospitality' && (
            <Suspense fallback={<SkeletonCard height="h-[300px]" />}>
              <HospitalityProformaSection financials={normalizedFinancials} />
            </Suspense>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <AreaBreakdown areas={normalizedFinancials.areas} assetClass={normalizedFinancials.assetClass} />
            <CostBreakdown costs={normalizedFinancials.costs} assetClass={normalizedFinancials.assetClass} />
            <RevenuePanel revenue={normalizedFinancials.revenue} kpis={normalizedFinancials.kpis} assetClass={normalizedFinancials.assetClass} />
          </div>

          <Suspense fallback={<SkeletonCard height="h-[360px]" />}>
            <CashFlowChart cashFlows={normalizedFinancials.cashFlows} yearlyCashFlows={normalizedFinancials.yearlyCashFlows} assetClass={normalizedFinancials.assetClass} />
          </Suspense>
          <QuarterlyProformaPanel proforma={normalizedFinancials.proforma} />
          <SensitivityTable
            sensitivity={normalizedFinancials.sensitivity}
            assetClass={normalizedFinancials.assetClass}
            headlineIrr={normalizedFinancials.kpis?.irr ?? null}
          />

          {/* Structure waterfall panels */}
          <JDAWaterfallPanel financials={normalizedFinancials} deal={deal} />
          <JVWaterfallPanel financials={normalizedFinancials} deal={deal} />
          <DebtSchedulePanel financials={financials} />

          {/* Page-footer audit chip — one-line credibility signal that opens
              the full HMAC timeline + Verify/Replay primitives in a modal.
              Pre-2026-05-28 this was an inline ~80px collapsed card; now it's
              a tiny chip at the bottom of the page, click-to-expand. */}
          <div className="flex justify-end pt-1">
            <AuditTrailChip dealId={dealId} />
          </div>

          <div className="border-t pt-6" ref={inputsRef}>
            {canEdit ? (
              <>
                <h3 className="text-sm font-semibold text-content-primary mb-3">Recalculate</h3>
                <InputForm
                  initialValues={financials}
                  assetClass={activeClass}
                  deal={deal}
                  onSubmit={handleCalculate}
                  isLoading={calculateMutation.isPending}
                  prefill={prefill}
                />
              </>
            ) : (
              <div className="flex items-start gap-2.5 text-sm text-content-muted">
                <Lock size={15} className="mt-0.5 shrink-0 text-content-muted" />
                <p>
                  You have <span className="font-medium text-content-secondary">view-only</span> access
                  to this workspace. The figures above are live and exportable — ask an editor or admin
                  to update the underwriting model.
                </p>
              </div>
            )}
          </div>
        </>
      )}

      {/* First-time form — editors build the model; viewers see a read-only
          empty state (the write path is gated, so showing them a form they
          cannot submit would only 403 on Calculate). */}
      {!hasResults && !shouldShowError && (
        canEdit ? (
          <>
            <InputForm
              initialValues={null}
              assetClass={activeClass}
              deal={deal}
              onSubmit={handleCalculate}
              isLoading={calculateMutation.isPending}
              prefill={prefill}
            />
            {/* Waterfall panels available even before DCF is run */}
            <JDAWaterfallPanel financials={null} deal={deal} />
            <JVWaterfallPanel financials={null} deal={deal} />
          </>
        ) : (
          <EmptyState
            title="No financial model yet"
            description="An editor or admin needs to build the underwriting model for this deal. Once it's saved, the full DCF, sensitivity, and scenario analysis will appear here."
            icon={Calculator}
          />
        )
      )}

      {shouldShowError && !hasResults && (
        <EmptyState
          title="Could not load financials"
          description={error?.message || 'Something went wrong. Please try again.'}
          icon={Calculator}
        />
      )}
    </div>
  );
}
