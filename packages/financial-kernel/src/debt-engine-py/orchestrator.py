"""
Python-side orchestrator.

Wires debt roll-forward + CFADS + covenants + waterfall into a single
`orchestrate(request)` call. Returns a response that matches
`OrchestrateResponse`.
"""
from __future__ import annotations
from decimal import Decimal
from typing import List, Dict, Any, Optional

from . import debt, waterfall
from .models import OrchestrateRequest, OrchestrateResponse

ZERO = Decimal(0)


def _to_dict(model):
    if hasattr(model, 'model_dump'):
        return model.model_dump(by_alias=True)
    return model


def orchestrate(req: OrchestrateRequest) -> OrchestrateResponse:
    total_months = req.options.totalMonths
    facs = [_to_dict(f) for f in req.facilities]
    rows = debt.roll_forward_all(facs, total_months)
    agg = debt.aggregate(rows, total_months)
    cfads = debt.compute_cfads(_to_dict(req.cfadsInputs))
    pc = Decimal(req.options.projectCostCr) if req.options.projectCostCr else None
    pv = Decimal(req.options.propertyValueCr) if req.options.propertyValueCr else None
    cov = debt.compute_covenants(agg, cfads['monthly'], pc, pv, facs)
    wf_tiers = [_to_dict(t) for t in req.tiers] if req.tiers else []
    wf = waterfall.run_waterfall(wf_tiers, req.availableByMonth) if wf_tiers else {'rows': [], 'residualByMonth': req.availableByMonth, 'cumulativeByTier': {}}
    # KPIs
    cum_ds = sum((Decimal(x) for x in agg['monthlyDebtService']), ZERO)
    peak_debt = max((Decimal(x) for x in agg['totalOutstandingByMonth']), default=ZERO)
    residual_total = sum((Decimal(x) for x in wf['residualByMonth']), ZERO)
    kpis = {
        'cumulativeDebtServiceCr': str(cum_ds),
        'peakDebtCr': str(peak_debt),
        'residualTotalCr': str(residual_total),
        'breachCount': len(cov['breaches']),
    }
    if cov.get('minDSCR') is not None:
        kpis['minDSCR'] = str(cov['minDSCR'])
    if cov.get('avgDSCR') is not None:
        kpis['avgDSCR'] = str(cov['avgDSCR'])
    return OrchestrateResponse(
        schedule=rows,
        cfads=cfads,
        covenants=cov['monthly'],
        covenantBreaches=cov['breaches'],
        waterfallRows=wf['rows'],
        residualByMonth=wf['residualByMonth'],
        kpis=kpis,
        provenance=[{'engine': 'python-1.0', 'dealId': req.dealId}],
    )
