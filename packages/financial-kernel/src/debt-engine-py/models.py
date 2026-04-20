"""
Pydantic v2 models for the Python debt kernel.

Decimal values cross the wire as strings so we never lose precision
inside JSON (floats lose precision at 2^53). The HTTP boundary is the
only place we tolerate strings; inside the service we reconstitute
`decimal.Decimal` immediately.
"""
from __future__ import annotations
from typing import List, Optional, Literal, Union, Any, Dict
from pydantic import BaseModel, ConfigDict

_CFG = ConfigDict(populate_by_name=True, extra='allow')


class FixedRate(BaseModel):
    model_config = _CFG
    kind: Literal['fixed']
    annualPct: str


class FloatingRate(BaseModel):
    model_config = _CFG
    kind: Literal['floating']
    spreadPct: str
    referencePct: Optional[str] = None
    floorPct: Optional[str] = None
    capPct: Optional[str] = None


RateModel = Union[FixedRate, FloatingRate]


class DrawSchedule(BaseModel):
    model_config = _CFG
    kind: Literal['schedule']
    perMonth: List[str]


class DrawBasis(BaseModel):
    model_config = _CFG
    kind: Literal['basis_linked']
    basis: Literal['construction_progress', 'approvals_milestone']
    capPerMonth: Optional[List[str]] = None


class DrawBullet(BaseModel):
    model_config = _CFG
    kind: Literal['bullet_at_origination']


DrawRule = Union[DrawSchedule, DrawBasis, DrawBullet]


class DSRAConfig(BaseModel):
    model_config = _CFG
    monthsOfDebtService: int = 6
    initialBalance: Optional[str] = None


class CovenantSpec(BaseModel):
    model_config = _CFG
    minDSCR: Optional[str] = None
    maxLTC: Optional[str] = None
    maxLTV: Optional[str] = None
    minCash: Optional[str] = None


class PrepaymentRule(BaseModel):
    model_config = _CFG
    allowedFromMonth: int
    penaltyPct: Optional[str] = None


class RefinanceDirective(BaseModel):
    model_config = _CFG
    atMonth: int
    fromFacilityId: str
    replacementSpec: 'FacilitySpec'


class FacilitySpec(BaseModel):
    model_config = _CFG
    id: str
    kind: Literal['interest_only', 'amortizing_emi', 'amortizing_custom', 'bullet', 'balloon', 'refinance']
    currency: str = 'INR'
    commitment: str
    startMonth: int
    maturityMonth: int
    rate: RateModel
    compounding: Literal['monthly', 'quarterly', 'annual'] = 'monthly'
    drawRule: DrawRule
    amortizationTermMonths: Optional[int] = None
    customAmortSchedule: Optional[List[str]] = None
    gracePeriodMonths: Optional[int] = None
    moratoriumMonths: Optional[int] = None
    capitalizeInterestDuringGrace: Optional[bool] = None
    prepayment: Optional[PrepaymentRule] = None
    refinance: Optional[RefinanceDirective] = None
    covenants: Optional[CovenantSpec] = None
    dsra: Optional[DSRAConfig] = None
    openingBalance0: Optional[str] = None


RefinanceDirective.model_rebuild()


class Stakeholder(BaseModel):
    model_config = _CFG
    id: str
    role: str


class WaterfallTier(BaseModel):
    model_config = _CFG
    id: str
    kind: str
    label: Optional[str] = None
    priority: int
    stakeholders: List[Stakeholder]
    demandPerMonth: Optional[List[str]] = None
    cumulativeCap: Optional[str] = None


class CFADSInputs(BaseModel):
    model_config = _CFG
    revenue: List[str]
    opex: List[str]
    taxes: Optional[List[str]] = None
    maintenanceCapex: Optional[List[str]] = None
    workingCapitalDelta: Optional[List[str]] = None


class OrchestrateOptions(BaseModel):
    model_config = _CFG
    totalMonths: int
    projectCostCr: Optional[str] = None
    propertyValueCr: Optional[str] = None
    sculptTarget: Optional[str] = None


class OrchestrateRequest(BaseModel):
    model_config = _CFG
    dealId: str
    facilities: List[FacilitySpec]
    cfadsInputs: CFADSInputs
    tiers: List[WaterfallTier] = []
    availableByMonth: List[str] = []
    options: OrchestrateOptions


class FacilityRow(BaseModel):
    facilityId: str
    month: int
    openingBalance: str
    draw: str
    interestAccrued: str
    interestPaid: str
    interestCapitalized: str
    principalPaid: str
    prepaymentPaid: str
    closingBalance: str


class CFADSOut(BaseModel):
    monthly: List[str]
    annualBuckets: List[str]
    rolling12m: List[Optional[str]]


class CovenantMonth(BaseModel):
    month: int
    dscr: Optional[str] = None
    ltc: Optional[str] = None
    ltv: Optional[str] = None
    minCashOK: bool = True


class CovenantBreach(BaseModel):
    month: int
    covenant: str
    actual: str
    threshold: str


class WaterfallRow(BaseModel):
    month: int
    tierId: str
    stakeholderId: str
    amount: str


class KPIs(BaseModel):
    cumulativeDebtServiceCr: str
    minDSCR: Optional[str] = None
    avgDSCR: Optional[str] = None
    peakDebtCr: str
    residualTotalCr: str
    breachCount: int


class OrchestrateResponse(BaseModel):
    schedule: List[FacilityRow]
    cfads: CFADSOut
    covenants: List[CovenantMonth]
    covenantBreaches: List[CovenantBreach]
    waterfallRows: List[WaterfallRow]
    residualByMonth: List[str]
    kpis: KPIs
    provenance: List[Dict[str, Any]] = []
    engineVersion: str = 'python-1.0'
