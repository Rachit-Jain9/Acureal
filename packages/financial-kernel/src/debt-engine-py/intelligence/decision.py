"""
Decision engine — rule-based investor insights.

Every output item carries (kind, severity, title, explanation,
recommendation, metrics). Thresholds are calibrated to Indian CRE
institutional practice (12%/18% IRR bands, 1.25x/1.5x DSCR, 75% LTC).
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from decimal import Decimal
from typing import Any, Dict, List, Optional


def _f(x) -> Optional[float]:
    if x is None:
        return None
    if isinstance(x, Decimal):
        return float(x)
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


@dataclass
class Insight:
    kind: str                # 'risk' | 'opportunity' | 'observation'
    severity: str            # 'low' | 'medium' | 'high' | 'critical'
    title: str
    explanation: str
    recommendation: Optional[str] = None
    metrics: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def evaluate_deal(
    irr_levered: Optional[Decimal],
    moic: Optional[Decimal],
    dscr_profile: Dict[str, Any],
    llcr: Optional[Decimal],
    ltc_pct: Optional[Decimal],
    ltv_pct: Optional[Decimal],
    residual_cr: Decimal,
    breach_count: int,
) -> List[Dict[str, Any]]:
    out: List[Insight] = []

    irr_pct_f = (_f(irr_levered) * 100) if irr_levered is not None else None
    if irr_pct_f is None:
        out.append(Insight(
            "risk", "high", "IRR not computable",
            "Equity cash flows do not cross zero — cannot solve for a rate of return.",
            "Verify equity contribution timing and exit proceeds.",
            {"irr_levered": None},
        ))
    elif irr_pct_f < 12:
        out.append(Insight(
            "risk", "high", "Low levered IRR",
            f"Levered IRR {irr_pct_f:.1f}% is below the 12% institutional threshold for Indian CRE.",
            "Increase rent growth, reduce acquisition price, or raise leverage within covenant limits.",
            {"irr_pct": irr_pct_f},
        ))
    elif irr_pct_f < 18:
        out.append(Insight(
            "observation", "medium", "Acceptable IRR",
            f"Levered IRR {irr_pct_f:.1f}% sits in the core-plus range (12–18%).",
            "Consider whether incremental leverage could lift return without breaching covenants.",
            {"irr_pct": irr_pct_f},
        ))
    else:
        out.append(Insight(
            "opportunity", "low", "Strong IRR profile",
            f"Levered IRR {irr_pct_f:.1f}% exceeds the 18% value-add threshold.",
            "Pressure-test exit cap and rent-growth assumptions before IC.",
            {"irr_pct": irr_pct_f},
        ))

    md = _f(dscr_profile.get("min"))
    below_10 = int(dscr_profile.get("count_below_1_0") or 0)
    below_125 = int(dscr_profile.get("count_below_1_25") or 0)
    if md is not None:
        if md < 1.0:
            out.append(Insight(
                "risk", "critical", "DSCR breach",
                f"Minimum DSCR {md:.2f}x falls below 1.0x in {below_10} month(s) — cash flow cannot service debt.",
                "Reduce leverage, extend amortization, or pre-fund a 12-month DSRA.",
                {"min_dscr": md, "count_below_1_0": below_10},
            ))
        elif md < 1.25:
            out.append(Insight(
                "risk", "high", "Thin DSCR cushion",
                f"Minimum DSCR {md:.2f}x is below the 1.25x institutional floor ({below_125} months under 1.25x).",
                "Consider a DSRA top-up, longer interest-only period, or reducing quantum by 5–10%.",
                {"min_dscr": md, "count_below_1_25": below_125},
            ))
        elif md < 1.5:
            out.append(Insight(
                "observation", "low", "Adequate DSCR",
                f"Minimum DSCR {md:.2f}x sits above the institutional floor with modest cushion.",
                None,
                {"min_dscr": md},
            ))
        else:
            out.append(Insight(
                "opportunity", "low", "Strong DSCR cushion",
                f"Minimum DSCR {md:.2f}x leaves room for additional leverage.",
                "Run a higher-LTV scenario to test whether IRR lifts meaningfully.",
                {"min_dscr": md},
            ))

    llcr_f = _f(llcr)
    if llcr_f is not None and llcr_f < 1.1:
        out.append(Insight(
            "risk", "high", "Weak LLCR",
            f"LLCR {llcr_f:.2f}x — PV of CFADS barely covers outstanding debt.",
            "Reduce debt quantum or negotiate a longer tenor.",
            {"llcr": llcr_f},
        ))

    ltc_f = _f(ltc_pct)
    if ltc_f is not None and ltc_f > 75:
        out.append(Insight(
            "risk", "high", "High LTC",
            f"LTC {ltc_f:.1f}% exceeds the 75% conservative threshold.",
            "Bring in more equity or restructure into senior + mezzanine.",
            {"ltc_pct": ltc_f},
        ))

    ltv_f = _f(ltv_pct)
    if ltv_f is not None and ltv_f > 70:
        out.append(Insight(
            "risk", "medium", "High LTV",
            f"LTV {ltv_f:.1f}% is above 70%.",
            "Validate property valuation — stressed LTV could breach 75%.",
            {"ltv_pct": ltv_f},
        ))

    res_f = _f(residual_cr) or 0.0
    if res_f < 0:
        out.append(Insight(
            "risk", "critical", "Distribution shortfall",
            f"Residual pool is negative (₹{res_f:.2f} Cr) — waterfall under-delivers.",
            "Verify fee/reserve assumptions and reduce promote targets.",
            {"residual_cr": res_f},
        ))

    if breach_count > 0:
        out.append(Insight(
            "risk", "high", "Covenant breaches",
            f"{breach_count} covenant-breach month(s) detected.",
            "Review cure periods and waiver likelihood with lender.",
            {"breach_count": breach_count},
        ))

    return [i.to_dict() for i in out]
