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
