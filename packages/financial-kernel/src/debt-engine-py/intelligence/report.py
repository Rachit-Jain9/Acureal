"""
Investor package builder — aggregates KPIs, insights, sensitivity, graph
and monthly cashflows into a flat, JSON-serializable payload.

This is the Python canonical shape. The TS mirror at
`src/exports/intelligentReport.ts` must round-trip the same keys so the
frontend and PDF/XLSX renderers stay engine-agnostic.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Any, Dict, List, Optional


def _s(x) -> Optional[str]:
    if x is None:
        return None
    if isinstance(x, Decimal):
        return str(x)
    return str(x)


def _pct_str(x) -> Optional[str]:
    if x is None:
        return None
    return str(Decimal(str(x)) * Decimal(100))


def _headline(kpis: Dict[str, Any]) -> str:
    irr = kpis.get("irr_levered")
    dscr = (kpis.get("dscr_profile") or {}).get("min")
    irr_s = "n/a" if irr is None else f"{float(Decimal(str(irr)) * 100):.2f}%"
    dscr_s = "n/a" if dscr is None else f"{float(Decimal(str(dscr))):.2f}x"
    return f"IRR {irr_s} · Min DSCR {dscr_s}"


def group_insights(insights: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    """Bucket insights by kind for grouped UI rendering."""
    buckets: Dict[str, List[Dict[str, Any]]] = {"risk": [], "opportunity": [], "observation": []}
    for i in insights:
        buckets.setdefault(i.get("kind", "observation"), []).append(i)
    return buckets


def recommendations(insights: List[Dict[str, Any]]) -> List[str]:
    """De-duplicated ordered list of actionable recommendations."""
    seen: set = set()
    out: List[str] = []
    for i in insights:
        r = i.get("recommendation")
        if not r or r in seen:
            continue
        seen.add(r)
        out.append(r)
    return out


def severity_rank(s: str) -> int:
    return {"critical": 4, "high": 3, "medium": 2, "low": 1, "info": 0}.get(s, 0)


def sort_insights(insights: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return sorted(insights, key=lambda i: -severity_rank(i.get("severity", "info")))


def build_investor_package(
    *,
    deal_id: str,
    engine_version: str,
    generated_at: str,
    kpis: Dict[str, Any],
    insights: List[Dict[str, Any]],
    narrative: str,
    residual_total_cr: float = 0.0,
    peak_debt_cr: float = 0.0,
    cumulative_debt_service_cr: float = 0.0,
    breach_count: int = 0,
    sensitivity: Optional[Dict[str, Any]] = None,
    graph: Optional[Dict[str, Any]] = None,
    monthly: Optional[List[Dict[str, Any]]] = None,
    waterfall_rows: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Assemble the investor payload. All monetary fields round-trip as
    Decimal-string to preserve precision across HTTP boundaries."""
    dscr = kpis.get("dscr_profile") or {}
    dc = kpis.get("debt_capacity") or {}
    sorted_ins = sort_insights(insights)
    return {
        "summary": {
            "dealId": deal_id,
            "engineVersion": engine_version,
            "generatedAt": generated_at,
            "headline": _headline(kpis),
            "narrative": narrative,
            "kpi": {
                "irrLeveredPct": _pct_str(kpis.get("irr_levered")),
                "irrUnleveredPct": _pct_str(kpis.get("irr_unlevered")),
                "moic": _s(kpis.get("moic")),
                "minDSCR": _s(dscr.get("min")),
                "maxDSCR": _s(dscr.get("max")),
                "avgDSCR": _s(dscr.get("avg")),
                "p5DSCR": _s(dscr.get("p5")),
                "p25DSCR": _s(dscr.get("p25")),
                "p50DSCR": _s(dscr.get("p50")),
                "p75DSCR": _s(dscr.get("p75")),
                "llcr": _s(kpis.get("llcr")),
                "plcr": _s(kpis.get("plcr")),
                "peakEquityCr": _s(kpis.get("peak_equity_cr")),
                "paybackMonth": kpis.get("payback_month"),
                "debtCapacityCr": _s(dc.get("max_debt")),
                "cumulativeDebtServiceCr": str(Decimal(str(cumulative_debt_service_cr))),
                "peakDebtCr": str(Decimal(str(peak_debt_cr))),
                "residualTotalCr": str(Decimal(str(residual_total_cr))),
                "breachCount": int(breach_count),
            },
            "insights": sorted_ins,
            "insightsByKind": group_insights(sorted_ins),
            "recommendations": recommendations(sorted_ins),
            "sensitivity": sensitivity,
            "graph": graph,
        },
        "monthly": monthly or [],
        "waterfallRows": waterfall_rows or [],
    }
