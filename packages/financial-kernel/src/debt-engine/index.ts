/**
 * @redip/financial-kernel/debt-engine
 *
 * Facility-based debt engine. Pure TypeScript, BigInt-backed Decimal math,
 * canonical monthly time grain. No DB/network/Date.now/randomness/UI.
 */

export {
  rollForwardFacility,
  rollForwardFacilities,
  addFacilitySeries,
} from './engine';
export { computeCFADS } from './cfads';
export { computeCovenants } from './covenants';
export { sculptDSCR } from './sculpt';
export { resolveRateAt, drawCapAt, scheduledPrincipalAt, accrueAt } from './facilities';
export {
  emi,
  emiPrincipalComponent,
  accrueInterestMonthly,
  monthlyRate,
  capPositive,
  subClampZero,
  addSeries,
  zeros,
  clamp,
} from './math';

export type {
  FacilityKind,
  FacilitySpec,
  FacilitySchedule,
  FacilityPeriodRow,
  DebtScheduleAggregate,
  CompoundingBasis,
  RateModel,
  DrawRule,
  DrawStopCondition,
  CustomAmortization,
  DSRAConfig,
  FeeDef,
  PrepaymentRule,
  RefinanceDirective,
  CovenantSpec,
  CFADSInputs,
  CFADSOutputs,
  CovenantResult,
  SculptRequest,
  SculptResult,
} from './types';

export type { CovenantInputs } from './covenants';
export type { RollForwardOptions } from './engine';
