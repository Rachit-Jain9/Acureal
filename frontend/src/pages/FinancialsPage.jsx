import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Calculator, Building2, ChevronDown, Lock } from 'lucide-react';
import ReferenceMenu from '../components/financials/ReferenceMenu';
import AssetClassInsightBanner from '../components/financials/AssetClassInsightBanner';
import QuarterlyProformaPanel from '../components/financials/QuarterlyProformaPanel';
import { useFinancials, useCalculateFinancials } from '../hooks/useFinancials';
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
// Workstream A (Provenance Spine) — read-side model-confidence summary +
// the deterministic KPI ranges driven by the still-unverified assumptions.
import ModelConfidencePanel from '../components/financials/ModelConfidencePanel';
import ConfidenceRangePanel from '../components/financials/ConfidenceRangePanel';
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

  const existingClass = financials?.asset_class || 'residential_apartments';
  const [selectedClass, setSelectedClass] = useState(null); // null = use stored
  const activeClass = selectedClass || existingClass;

  const inputsRef = useRef(null);
  const scrollToInputs = () => {
    inputsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Prefill staged on the Zoning tab via "Apply to underwriting" lives in
  // sessionStorage until consumed. Read once; clear on first consumption so a
  // page refresh doesn't keep re-applying it over user edits.
  const [prefill, setPrefill] = useState(() => readPrefill(dealId));
  useEffect(() => {
    // If the user lands here from another deal, re-read the prefill.
    setPrefill(readPrefill(dealId));
  }, [dealId]);
  useEffect(() => {
    if (prefill) {
      toast.success('Underwriting inputs pre-filled from buildability programme. Review and hit Calculate.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);
  const handlePrefillConsumed = () => {
    if (prefill) {
      clearPrefill(dealId);
      setPrefill(null);
    }
  };

  const normalizedFinancials = useMemo(() => normalizeFinancials(financials), [financials]);
  const hasResults = !!normalizedFinancials;
  const activeFinancialModelLabel = getFinancialModelLabel(activeClass);
  const showLegacyResidentialNotice = useMemo(
    () => hasLegacyResidentialLoadingFactor(financials),
    [financials]
  );

  const handleCalculate = (data) => {
    calculateMutation.mutate({ dealId, data });
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
            <Building2 size={16} className="text-primary-600" />
            Asset Class
          </div>
          <div className="relative">
            <select
              value={activeClass}
              onChange={(e) => handleClassChange(e.target.value)}
              className="appearance-none pl-3 pr-8 py-2 border border-hairline-strong rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary-500 bg-bg-elevated"
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
            <span className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded border border-amber-200">
              Switching class — current results shown above are for {ASSET_CLASSES.find((a) => a.value === normalizedFinancials.assetClass)?.label}
            </span>
          )}
        </div>
      </div>

      {showLegacyResidentialNotice && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
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

          {/* Workstream A — how much of this model is set for the deal
              vs. running on REDIP benchmark defaults, and the deterministic
              KPI ranges those unverified assumptions imply. Both hide
              themselves when the model class is not yet catalogued. */}
          <ModelConfidencePanel dealId={dealId} />
          <ConfidenceRangePanel dealId={dealId} />

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
          <SensitivityTable sensitivity={normalizedFinancials.sensitivity} assetClass={normalizedFinancials.assetClass} />

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
                  onPrefillConsumed={handlePrefillConsumed}
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
              onPrefillConsumed={handlePrefillConsumed}
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
