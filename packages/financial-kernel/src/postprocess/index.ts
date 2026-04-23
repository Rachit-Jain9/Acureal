/**
 * Post-processors — pure shape adapters that run after kernel math.
 *
 * Each module here transforms already-computed kernel outputs into the
 * legacy JS-engine output shapes so the frontend and backend services
 * can consume kernel results without re-coding their readers. These are
 * shape-faithful: any divergence from legacy causes silent UI/export
 * regressions (see `docs/LEGACY_SHAPE_AUDIT.md`).
 */

export {
  buildConstructionLoanCapitalStack,
  buildIncomeAmortizingCapitalStack,
  buildHospitalityCapitalStack,
  buildHospitalityWaterfall,
} from './capitalStack';

export type {
  CapitalStack,
  CapitalStackConstructionLoan,
  CapitalStackIncomeAmortizing,
  CapitalStackHospitality,
  CapitalStackWaterfall,
  CapitalStackWaterfallTier,
  CapitalStackConstructionPhase,
  CapitalStackPermanentPhase,
  ConstructionLoanCapitalStackArgs,
  IncomeAmortizingCapitalStackArgs,
  HospitalityCapitalStackArgs,
  BuildWaterfallArgs,
} from './capitalStack';

export {
  buildCashFlows,
  normalizeEffectiveDate,
  addUtcDays,
  addUtcMonths,
} from './cashFlows';

export type {
  CashFlowBundle,
  CashFlowSummary,
  QuarterlyCashFlowEntry,
  YearlyCashFlowEntry,
  BuildCashFlowsTimeline,
} from './cashFlows';

export {
  buildUsaliPnl,
  buildUsaliSummary,
  hospOccRamp,
  INDIA_HOSPITALITY_PRESETS,
} from './usaliPnl';

export type {
  UsaliPnlRow,
  UsaliPnlInputs,
  UsaliStabilisedSummary,
  IndianHospitalityPresetKey,
} from './usaliPnl';

export { buildLegacyShape } from './legacyShape';

export type { LegacyShape, BuildLegacyShapeArgs } from './legacyShape';

export {
  buildSensitivityMatrix,
  buildResidentialSensitivity,
  buildPlottedSensitivity,
  buildIncomeSensitivity,
  buildHospSensitivity,
} from './sensitivity';

export type {
  SensitivityMatrix,
  HospSensitivity,
  BuildSensitivityArgs,
} from './sensitivity';

export {
  buildScenarios,
  applyScenarioPreset,
  SCENARIO_PRESETS,
} from './scenarios';

export type {
  ScenarioCell,
  ScenarioBundle,
  BuildScenariosArgs,
} from './scenarios';

export { buildQuarterlyProforma } from './proforma';

export type {
  ProformaQuarterCell,
  ProformaRow,
  ProformaSection,
  ProformaSummary,
} from './proforma';
