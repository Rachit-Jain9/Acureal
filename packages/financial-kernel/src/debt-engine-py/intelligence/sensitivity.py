"""
Sensitivity engine — tornado and spider-chart data via bounded variable
sweeps. The caller passes a `recompute(overrides)` closure that returns
a KPI (IRR, DSCR, etc.) for a given variable overlay.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Any, Callable, Dict, List, Sequence


def _D(x) -> Decimal:
    if isinstance(x, Decimal):
        return x
    return Decimal(str(x))


def tornado(
    base_kpi: Decimal,
    variables: Dict[str, Dict[str, Any]],
    recompute: Callable[[Dict[str, Decimal]], Decimal],
) -> List[Dict[str, Any]]:
    """variables: {name: {'base': Decimal, 'low_pct': -10, 'high_pct': 10}}
    Returns rows sorted by |swing| descending:
      {variable, low_input, high_input, base_kpi, low_kpi, high_kpi, swing}"""
    base_map = {k: _D(v["base"]) for k, v in variables.items()}
    rows: List[Dict[str, Any]] = []
    for name, cfg in variables.items():
        base = _D(cfg["base"])
        low_pct = Decimal(str(cfg.get("low_pct", -10)))
        high_pct = Decimal(str(cfg.get("high_pct", 10)))
        low_input = base * (Decimal(100) + low_pct) / Decimal(100)
        high_input = base * (Decimal(100) + high_pct) / Decimal(100)
        low_kpi = recompute({**base_map, name: low_input})
        high_kpi = recompute({**base_map, name: high_input})
        if low_kpi is None or high_kpi is None:
            continue
        swing = abs(float(_D(high_kpi)) - float(_D(low_kpi)))
        rows.append({
            "variable": name,
            "low_input": str(low_input),
            "high_input": str(high_input),
            "base_kpi": str(base_kpi),
            "low_kpi": str(_D(low_kpi)),
            "high_kpi": str(_D(high_kpi)),
            "swing": swing,
        })
    rows.sort(key=lambda r: r["swing"], reverse=True)
    return rows


def spider(
    base_kpi: Decimal,
    variables: Dict[str, Dict[str, Any]],
    recompute: Callable[[Dict[str, Decimal]], Decimal],
    steps: Sequence[int] = (-20, -10, 0, 10, 20),
) -> Dict[str, List[Dict[str, Any]]]:
    """For each variable, returns a curve of KPI across percentage steps."""
    base_map = {k: _D(v["base"]) for k, v in variables.items()}
    out: Dict[str, List[Dict[str, Any]]] = {}
    for name, cfg in variables.items():
        base = _D(cfg["base"])
        curve: List[Dict[str, Any]] = []
        for s in steps:
            val = base * (Decimal(100) + Decimal(int(s))) / Decimal(100)
            kpi = recompute({**base_map, name: val})
            curve.append({
                "step_pct": int(s),
                "input": str(val),
                "kpi": None if kpi is None else str(_D(kpi)),
            })
        out[name] = curve
    return out
