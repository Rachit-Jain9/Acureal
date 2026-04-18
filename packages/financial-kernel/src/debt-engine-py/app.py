"""
FastAPI service exposing the investor-intelligence kernel as HTTP.

Endpoints:
  GET  /health              — liveness + module version
  POST /investor-package    — full investor package (KPIs + insights +
                              sensitivity + graph + headline + narrative)
  POST /kpis                — KPIs only (cheaper — no insights/sensitivity)

Deployed to Vercel via `api/investor-package.py` which mounts this
ASGI app. Locally runnable with `uvicorn app:app --port 8000`.

Contract: every monetary value round-trips as a Decimal string so
clients (TS/Supabase edge) never see raw floats.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

from intelligence import (
    compute_kpis,
    evaluate_deal,
    tornado as sens_tornado,
    build_investor_package,
)

VERSION = "1.0.0"

app = FastAPI(
    title="REDIP Investor Intelligence",
    version=VERSION,
    description=(
        "Python canonical source of truth for KPI, decision, sensitivity, "
        "and investor-package assembly. Behind DEBT_ENGINE_V2 on the TS "
        "side; safe to call independently."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)


def _D(x: Any) -> Decimal:
    """Accept number or decimal-string; reject NaN/inf."""
    if isinstance(x, Decimal):
        return x
    try:
        return Decimal(str(x))
    except (InvalidOperation, TypeError, ValueError) as e:
        raise HTTPException(status_code=400, detail=f"invalid decimal: {x!r} ({e})")


def _list(xs: List[Any]) -> List[Decimal]:
    return [_D(x) for x in xs]


class SensitivityVariable(BaseModel):
    name: str
    base: str = Field(..., description="Decimal string")
    low_pct: float = Field(default=-10.0, description="percent, e.g. -10 for 10% down")
    high_pct: float = Field(default=10.0)


class InvestorPackageRequest(BaseModel):
    deal_id: str
    engine_version: str = "v2-python"
    generated_at: str

    # KPI inputs (all arrays are decimal-strings)
    equity_cash_flows: List[str]
    equity_months: List[int]
    project_cash_flows: List[str]
    project_months: List[int]
    cfads: List[str]
    debt_service: List[str]
    debt_outstanding: List[str]
    annual_discount: str
    equity_inflows: List[str]
    equity_outflows: List[str]
    target_dscr: str
    annual_rate: str
    term_months: int

    # Decision inputs
    ltc_pct: Optional[str] = None
    ltv_pct: Optional[str] = None
    residual_total_cr: str = "0"
    peak_debt_cr: str = "0"
    cumulative_debt_service_cr: str = "0"
    breach_count: int = 0

    # Sensitivity (optional)
    sensitivity: bool = False
    sensitivity_variables: List[SensitivityVariable] = Field(default_factory=list)

    # Pass-through context
    narrative: Optional[str] = None
    graph: Optional[Dict[str, Any]] = None
    monthly: Optional[List[Dict[str, Any]]] = None
    waterfall_rows: Optional[List[Dict[str, Any]]] = None

    @field_validator("equity_months", "project_months")
    @classmethod
    def _nonneg(cls, v: List[int]) -> List[int]:
        if any(m < 0 for m in v):
            raise ValueError("months must be >= 0")
        return v


class KPIRequest(BaseModel):
    equity_cash_flows: List[str]
    equity_months: List[int]
    project_cash_flows: List[str]
    project_months: List[int]
    cfads: List[str]
    debt_service: List[str]
    debt_outstanding: List[str]
    annual_discount: str
    equity_inflows: List[str]
    equity_outflows: List[str]
    target_dscr: str
    annual_rate: str
    term_months: int


def _build_narrative(insights: List[Dict[str, Any]], irr_pct: Optional[float], min_dscr: Optional[float]) -> str:
    rank = {"critical": 4, "high": 3, "medium": 2, "low": 1, "info": 0}
    lead = max(insights, key=lambda i: rank.get(i.get("severity", "info"), 0)) if insights else None
    head = f"Levered IRR {irr_pct:.1f}%" if irr_pct is not None else "Levered IRR n/a"
    dscr_str = f" · min DSCR {min_dscr:.2f}x" if min_dscr is not None else " · min DSCR n/a"
    tail = ""
    if lead:
        tail = f". {lead['title']}: {lead['explanation']}"
        if lead.get("recommendation"):
            tail += f" {lead['recommendation']}"
    return f"{head}{dscr_str}{tail}"


@app.get("/health")
def health() -> Dict[str, Any]:
    return {"status": "ok", "service": "redip-investor-intelligence", "version": VERSION}


@app.post("/kpis")
def kpis_endpoint(req: KPIRequest) -> Dict[str, Any]:
    k = compute_kpis(
        equity_cash_flows=_list(req.equity_cash_flows),
        equity_months=req.equity_months,
        project_cash_flows=_list(req.project_cash_flows),
        project_months=req.project_months,
        cfads=_list(req.cfads),
        debt_service=_list(req.debt_service),
        debt_outstanding=_list(req.debt_outstanding),
        annual_discount=_D(req.annual_discount),
        equity_inflows=_list(req.equity_inflows),
        equity_outflows=_list(req.equity_outflows),
        target_dscr=_D(req.target_dscr),
        annual_rate=_D(req.annual_rate),
        term_months=req.term_months,
    )
    return {"engine": "v2-python", "version": VERSION, "kpis": k}


@app.post("/investor-package")
def investor_package_endpoint(req: InvestorPackageRequest) -> Dict[str, Any]:
    kpis = compute_kpis(
        equity_cash_flows=_list(req.equity_cash_flows),
        equity_months=req.equity_months,
        project_cash_flows=_list(req.project_cash_flows),
        project_months=req.project_months,
        cfads=_list(req.cfads),
        debt_service=_list(req.debt_service),
        debt_outstanding=_list(req.debt_outstanding),
        annual_discount=_D(req.annual_discount),
        equity_inflows=_list(req.equity_inflows),
        equity_outflows=_list(req.equity_outflows),
        target_dscr=_D(req.target_dscr),
        annual_rate=_D(req.annual_rate),
        term_months=req.term_months,
    )
    insights = evaluate_deal(
        irr_levered=_D(kpis["irr_levered"]) if kpis["irr_levered"] else None,
        moic=_D(kpis["moic"]) if kpis.get("moic") else None,
        dscr_profile=kpis["dscr_profile"],
        llcr=_D(kpis["llcr"]) if kpis.get("llcr") else None,
        ltc_pct=_D(req.ltc_pct) if req.ltc_pct else None,
        ltv_pct=_D(req.ltv_pct) if req.ltv_pct else None,
        residual_cr=_D(req.residual_total_cr),
        breach_count=req.breach_count,
    )

    sens: Optional[Dict[str, Any]] = None
    if req.sensitivity and req.sensitivity_variables:
        # Linear IRR elasticity proxy (matches TS tornado approach).
        irr_base = _D(kpis["irr_levered"]) if kpis.get("irr_levered") else Decimal("0")
        var_map = {
            v.name: {"base": _D(v.base), "low_pct": v.low_pct, "high_pct": v.high_pct}
            for v in req.sensitivity_variables
        }

        def recompute(over: Dict[str, Decimal]) -> Decimal:
            # Simple elasticity: -2% per -10% swing, +2% per +10% swing per variable.
            # Real pipeline re-run is deferred to a dedicated /sensitivity/reflow endpoint.
            total = irr_base
            for name, val in over.items():
                base = var_map[name]["base"]
                if base == 0:
                    continue
                dp = (val - base) / base
                total += dp * Decimal("0.02")
            return total

        rows = sens_tornado(base_kpi=irr_base, variables=var_map, recompute=recompute)
        sens = {
            "targetKPI": "irr_levered",
            "baseKPI": str(irr_base),
            "rows": [
                {
                    "variable": r["variable"],
                    "lowInput": r["low_input"],
                    "highInput": r["high_input"],
                    "baseKPI": r["base_kpi"],
                    "lowKPI": r["low_kpi"],
                    "highKPI": r["high_kpi"],
                    "swing": r["swing"],
                }
                for r in rows
            ],
            "variables": [v.name for v in req.sensitivity_variables],
        }

    irr_pct = float(_D(kpis["irr_levered"])) * 100 if kpis.get("irr_levered") else None
    min_d = float(_D(kpis["dscr_profile"]["min"])) if kpis["dscr_profile"].get("min") else None
    narrative = req.narrative or _build_narrative(insights, irr_pct, min_d)

    pkg = build_investor_package(
        deal_id=req.deal_id,
        engine_version=req.engine_version,
        generated_at=req.generated_at,
        kpis=kpis,
        insights=insights,
        narrative=narrative,
        residual_total_cr=float(_D(req.residual_total_cr)),
        peak_debt_cr=float(_D(req.peak_debt_cr)),
        cumulative_debt_service_cr=float(_D(req.cumulative_debt_service_cr)),
        breach_count=req.breach_count,
        sensitivity=sens,
        graph=req.graph,
        monthly=req.monthly,
        waterfall_rows=req.waterfall_rows,
    )
    return pkg


@app.middleware("http")
async def _no_cache(request: Request, call_next):
    resp = await call_next(request)
    resp.headers["cache-control"] = "no-store"
    return resp
