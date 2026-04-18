"""
KPI engine — IRR (levered / unlevered XIRR), DSCR/LLCR/PLCR profiles,
debt capacity via iterative EMI solve.

All monetary inputs/outputs round-trip as Decimal strings. Internal
math uses float for scipy.brentq; final KPIs are re-wrapped to Decimal
at the boundary so callers never see raw floats.
"""
from __future__ import annotations

from decimal import Decimal, getcontext
from typing import Dict, List, Optional, Sequence

import numpy as np
from scipy.optimize import brentq

getcontext().prec = 28


def _D(x) -> Decimal:
    if isinstance(x, Decimal):
        return x
    if x is None:
        return Decimal(0)
    return Decimal(str(x))


def xirr(
    cash_flows: Sequence[Decimal],
    months_from_origin: Sequence[int],
    lo: float = -0.99,
    hi: float = 10.0,
) -> Optional[Decimal]:
    """Annualized IRR for monthly-indexed cash flows. Returns None if
    cash flows lack a sign change or the solver cannot bracket a root."""
    if not cash_flows or len(cash_flows) != len(months_from_origin):
        return None
    cf = [float(_D(c)) for c in cash_flows]
    months = [int(m) for m in months_from_origin]
    if not any(v > 0 for v in cf) or not any(v < 0 for v in cf):
        return None

    def npv(r: float) -> float:
        if r <= -1:
            return float("inf")
        total = 0.0
        for v, m in zip(cf, months):
            total += v / ((1.0 + r) ** (m / 12.0))
        return total

    try:
        f_lo, f_hi = npv(lo), npv(hi)
        if not (np.isfinite(f_lo) and np.isfinite(f_hi)) or f_lo * f_hi > 0:
            return None
        rate = brentq(npv, lo, hi, xtol=1e-8, maxiter=200)
        return _D(f"{rate:.10f}")
    except Exception:
        return None


def moic(inflows: Sequence[Decimal], outflows: Sequence[Decimal]) -> Decimal:
    """Multiple on invested capital = sum(inflows) / sum(outflows)."""
    ti = sum((_D(x) for x in inflows), Decimal(0))
    to = sum((_D(x) for x in outflows), Decimal(0))
    if to == 0:
        return Decimal(0)
    return ti / to


def dscr_profile(cfads: Sequence[Decimal], ds: Sequence[Decimal]) -> dict:
    """Returns min/max/avg + percentiles + count_below_1.0 and count_below_1.25.
    Months with zero debt service are excluded from the distribution."""
    ratios: List[float] = []
    for c, d in zip(cfads, ds):
        dv = float(_D(d))
        if dv == 0:
            continue
        ratios.append(float(_D(c)) / dv)
    if not ratios:
        return {
            "min": None, "max": None, "avg": None,
            "p5": None, "p25": None, "p50": None, "p75": None,
            "count_below_1_0": 0, "count_below_1_25": 0,
        }
    arr = np.array(ratios, dtype=float)
    return {
        "min": str(_D(float(arr.min()))),
        "max": str(_D(float(arr.max()))),
        "avg": str(_D(float(arr.mean()))),
        "p5":  str(_D(float(np.percentile(arr, 5)))),
        "p25": str(_D(float(np.percentile(arr, 25)))),
        "p50": str(_D(float(np.percentile(arr, 50)))),
        "p75": str(_D(float(np.percentile(arr, 75)))),
        "count_below_1_0": int((arr < 1.0).sum()),
        "count_below_1_25": int((arr < 1.25).sum()),
    }


def llcr(
    cfads: Sequence[Decimal],
    debt_outstanding: Sequence[Decimal],
    annual_discount: Decimal,
) -> Optional[Decimal]:
    """Loan Life Coverage Ratio = PV(CFADS over loan life) / current debt."""
    if not cfads or not debt_outstanding:
        return None
    r = float(_D(annual_discount)) / 12.0
    pv = 0.0
    for i, c in enumerate(cfads):
        pv += float(_D(c)) / ((1.0 + r) ** (i + 1))
    cur = float(_D(debt_outstanding[0]))
    if cur <= 0:
        return None
    return _D(f"{pv / cur:.8f}")


def plcr(
    cfads: Sequence[Decimal],
    current_debt: Decimal,
    annual_discount: Decimal,
) -> Optional[Decimal]:
    """Project Life Coverage Ratio = PV(CFADS over project life) / current debt."""
    cur = float(_D(current_debt))
    if not cfads or cur <= 0:
        return None
    r = float(_D(annual_discount)) / 12.0
    pv = 0.0
    for i, c in enumerate(cfads):
        pv += float(_D(c)) / ((1.0 + r) ** (i + 1))
    return _D(f"{pv / cur:.8f}")


def debt_capacity(
    cfads: Sequence[Decimal],
    target_dscr: Decimal,
    annual_rate: Decimal,
    term_months: int,
) -> dict:
    """Max level EMI debt such that min DSCR >= target.
    Analytical close: max_EMI = min(positive CFADS) / target; max_debt
    = max_EMI / annuity factor. Binding month is the CFADS trough."""
    if not cfads or term_months <= 0:
        return {"max_debt": str(Decimal(0)), "binding_month": None, "achieved_min_dscr": None}
    target = float(_D(target_dscr))
    r = float(_D(annual_rate)) / 12.0
    n = min(term_months, len(cfads))
    positive = [(i, float(_D(c))) for i, c in enumerate(cfads[:n]) if float(_D(c)) > 0]
    if not positive:
        return {"max_debt": str(Decimal(0)), "binding_month": None, "achieved_min_dscr": None}
    binding_month, min_cfads = min(positive, key=lambda t: t[1])
    emi_factor = (1.0 / n) if r == 0 else r / (1.0 - (1.0 + r) ** (-n))
    max_emi = min_cfads / target
    max_debt = max_emi / emi_factor
    return {
        "max_debt": str(_D(f"{max_debt:.6f}")),
        "binding_month": binding_month,
        "achieved_min_dscr": str(_D(f"{target:.4f}")),
    }


def payback_month(cash_flows: Sequence[Decimal]) -> Optional[int]:
    cum = 0.0
    for i, c in enumerate(cash_flows):
        cum += float(_D(c))
        if cum >= 0:
            return i
    return None


def peak_equity_outflow(equity_flows: Sequence[Decimal]) -> Decimal:
    cum, peak = 0.0, 0.0
    for c in equity_flows:
        cum += float(_D(c))
        if cum < peak:
            peak = cum
    return _D(f"{abs(peak):.6f}")


def compute_kpis(
    equity_cash_flows: Sequence[Decimal],
    equity_months: Sequence[int],
    project_cash_flows: Sequence[Decimal],
    project_months: Sequence[int],
    cfads: Sequence[Decimal],
    debt_service: Sequence[Decimal],
    debt_outstanding: Sequence[Decimal],
    annual_discount: Decimal,
    equity_inflows: Sequence[Decimal],
    equity_outflows: Sequence[Decimal],
    target_dscr: Decimal,
    annual_rate: Decimal,
    term_months: int,
) -> Dict:
    """Top-level KPI assembly used by the /orchestrate intelligence path."""
    irr_lev = xirr(equity_cash_flows, equity_months)
    irr_un = xirr(project_cash_flows, project_months)
    m = moic(equity_inflows, equity_outflows)
    profile = dscr_profile(cfads, debt_service)
    ll = llcr(cfads, debt_outstanding, annual_discount)
    pl = plcr(cfads, debt_outstanding[0], annual_discount) if debt_outstanding else None
    peak = peak_equity_outflow(equity_cash_flows)
    pb = payback_month(equity_cash_flows)
    dc = debt_capacity(cfads, target_dscr, annual_rate, term_months)
    return {
        "irr_levered": str(irr_lev) if irr_lev is not None else None,
        "irr_unlevered": str(irr_un) if irr_un is not None else None,
        "moic": str(m),
        "equity_multiple": str(m),
        "dscr_profile": profile,
        "llcr": str(ll) if ll is not None else None,
        "plcr": str(pl) if pl is not None else None,
        "peak_equity_cr": str(peak),
        "payback_month": pb,
        "debt_capacity": dc,
    }
