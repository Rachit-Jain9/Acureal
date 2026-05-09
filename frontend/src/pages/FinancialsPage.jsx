import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Calculator, Building2, ChevronDown, LifeBuoy } from 'lucide-react';
import ReferenceMenu from '../components/financials/ReferenceMenu';
import AssetClassInsightBanner from '../components/financials/AssetClassInsightBanner';
import FinancialVisualizationLayer from '../components/financials/FinancialVisualizationLayer';
import HospitalityProformaSection from '../components/financials/HospitalityProformaSection';
import QuarterlyProformaPanel from '../components/financials/QuarterlyProformaPanel';
import { useFinancials, useCalculateFinancials } from '../hooks/useFinancials';
import InputForm from '../components/financials/InputForm';
import WhatIfSliders from '../components/financials/WhatIfSliders';
import SensitivityTornado from '../components/financials/SensitivityTornado';
import ScenarioComparison from '../components/financials/ScenarioComparison';
import AuditTimelineView from '../components/financials/AuditTimelineView';
import JDAWaterfallPanel from '../components/financials/JDAWaterfallPanel';
import JVWaterfallPanel from '../components/financials/JVWaterfallPanel';
import DebtSchedulePanel from '../components/financials/DebtSchedulePanel';
import { KPICards, AreaBreakdown, CostBreakdown, RevenuePanel } from '../components/financials/ResultPanels';
import CashFlowChart from '../components/financials/CashFlowChart';
import SensitivityTable from '../components/financials/SensitivityTable';
import {
  ASSET_CLASSES,
  getModelAssetClass,
  getFinancialModelLabel,
} from '../components/financials/fieldDefs';
import { useDeal } from '../hooks/useDeals';
import { readPrefill, clearPrefill } from '../utils/programmeToInputs';
import { toast } from '../components/common/Toast';
import EmptyState from '../components/common/EmptyState';
import PageHeader from '../components/common/PageHeader';
import { EvidenceChip, HelpDrawer, SkeletonKpi, SkeletonCard, SmartEmptyState } from '../design-system';
import { normalizeFinancials, hasLegacyResidentialLoadingFactor } from '../components/financials/normalizeFinancials';
import { useUserPreferences } from '../hooks/useUserPreferences';

const FINANCIALS_HELP_SECTIONS = [
  {
    title: 'Model Purpose',
    body: 'This page runs deterministic underwriting for the selected asset class. It calculates from explicit inputs and saved assumptions, not AI estimates.',
  },
  {
    title: 'Assumptions',
    body: 'Use Base, Downside, and Upside scenarios to make judgment visible. Flagged assumptions should link to comps, approvals, or reviewer notes before IC use.',
  },
  {
    title: 'KPIs and Sensitivity',
    body: 'IRR, equity multiple, DSCR, yield on cost, waterfall, and tornado views should be read with the input trail. High-impact variables belong in the IC risk discussion.',
  },
  {
    title: 'Audit Trail',
    body: 'Saved model versions are intended to show what changed, who changed it, and which assumptions drove the output. AI-written narratives still require human review.',
  },
];


// ─── MAIN PAGE ─────────────────────────────────────────────────────────────

export default function FinancialsPage() {
  const { dealId } = useParams();
  const { data: financials, isLoading, error } = useFinancials(dealId);
  const { data: deal } = useDeal(dealId);
  const { data: preferences } = useUserPreferences();
  const calculateMutation = useCalculateFinancials();

  const existingClass = financials?.asset_class || 'residential_apartments';
  const [selectedClass, setSelectedClass] = useState(null); // null = use stored
  const [helpOpen, setHelpOpen] = useState(false);
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
  const showGuidance = preferences?.showContextualHelp !== false;
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
            {showGuidance && (
              <button
                type="button"
                onClick={() => setHelpOpen(true)}
                className="btn btn-secondary flex items-center gap-1.5"
              >
                <LifeBuoy size={16} /> Guide
              </button>
            )}
            <ReferenceMenu assetClass={activeClass} />
            <Link to={`/dashboard/deals/${dealId}`} className="btn btn-secondary flex items-center gap-1.5">
              <ArrowLeft size={16} /> Back to Deal
            </Link>
          </div>
        }
      />

      <HelpDrawer
        open={helpOpen}
        title="Financials"
        sections={FINANCIALS_HELP_SECTIONS}
        onClose={() => setHelpOpen(false)}
      />

      <AssetClassInsightBanner assetClass={activeClass} />

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-hairline bg-bg-elevated px-4 py-3 shadow-sm">
        <span className="text-eyebrow uppercase text-content-muted">Traceability</span>
        <EvidenceChip
          label={hasResults ? 'Saved model inputs' : 'Assumption trail pending'}
          source={hasResults ? 'Financial model version' : 'No model saved yet'}
          freshness={financials?.updated_at ? `Updated ${new Date(financials.updated_at).toLocaleDateString('en-IN')}` : 'Not refreshed'}
          confidence={hasResults ? 'Input-linked' : 'Pending'}
          reviewer="AI-assisted narratives require human review"
          onClick={showGuidance ? () => setHelpOpen(true) : undefined}
        />
        <EvidenceChip
          label="Human review"
          source="Reviewer sign-off"
          freshness="Required before IC use"
          confidence="Manual verification"
          reviewer="Human review required"
          onClick={showGuidance ? () => setHelpOpen(true) : undefined}
        />
      </div>

      {/* Asset Class Selector */}
      <div className="rounded-xl border border-hairline bg-bg-elevated p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-sm font-medium text-content-secondary">
            <Building2 size={16} className="text-accent" />
            Asset Class
          </div>
          <div className="relative">
            <select
              value={activeClass}
              onChange={(e) => handleClassChange(e.target.value)}
              className="appearance-none rounded-lg border border-hairline bg-bg-elevated py-2 pl-3 pr-8 text-sm font-medium text-content-primary focus:outline-none focus:ring-2 focus:ring-accent/30"
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

          <WhatIfSliders
            assetClass={normalizedFinancials.assetClass}
            baseInputs={normalizedFinancials.inputs}
            baseKpis={normalizedFinancials.kpis}
            onEditInputs={scrollToInputs}
          />

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

          <FinancialVisualizationLayer
            financials={normalizedFinancials}
            inputs={normalizedFinancials.inputs}
          />

          {normalizedFinancials.assetClass === 'hospitality' && (
            <HospitalityProformaSection financials={normalizedFinancials} />
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <AreaBreakdown areas={normalizedFinancials.areas} assetClass={normalizedFinancials.assetClass} />
            <CostBreakdown costs={normalizedFinancials.costs} assetClass={normalizedFinancials.assetClass} />
            <RevenuePanel revenue={normalizedFinancials.revenue} kpis={normalizedFinancials.kpis} assetClass={normalizedFinancials.assetClass} />
          </div>

          <CashFlowChart cashFlows={normalizedFinancials.cashFlows} yearlyCashFlows={normalizedFinancials.yearlyCashFlows} assetClass={normalizedFinancials.assetClass} />
          <QuarterlyProformaPanel proforma={normalizedFinancials.proforma} />
          <SensitivityTable sensitivity={normalizedFinancials.sensitivity} assetClass={normalizedFinancials.assetClass} />

          {/* Structure waterfall panels */}
          <JDAWaterfallPanel financials={normalizedFinancials} deal={deal} />
          <JVWaterfallPanel financials={normalizedFinancials} deal={deal} />
          <DebtSchedulePanel financials={financials} />

          {/* Signed audit trail — HMAC-SHA256 log of every kernel run with
              verify + kernel-replay primitives. Proves reproducibility of
              the numbers above from first principles. */}
          <AuditTimelineView dealId={dealId} />

          <div className="border-t pt-6" ref={inputsRef}>
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
          </div>
        </>
      )}

      {/* First-time form */}
      {!hasResults && !shouldShowError && (
        <>
          <SmartEmptyState
            title="No financial model saved yet"
            body="Start with the selected asset-class template, then save a deterministic model that can feed sensitivity, waterfall, IC readiness, and the audit trail."
            action={
              <button
                type="button"
                onClick={scrollToInputs}
                className="btn btn-secondary"
              >
                Review assumptions
              </button>
            }
          />
          <div ref={inputsRef}>
            <InputForm
              initialValues={null}
              assetClass={activeClass}
              deal={deal}
              onSubmit={handleCalculate}
              isLoading={calculateMutation.isPending}
              prefill={prefill}
              onPrefillConsumed={handlePrefillConsumed}
            />
          </div>
          {/* Waterfall panels available even before DCF is run */}
          <JDAWaterfallPanel financials={null} deal={deal} />
          <JVWaterfallPanel financials={null} deal={deal} />
        </>
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
