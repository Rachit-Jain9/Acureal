"""Intelligence layer — KPI engine, decision engine, sensitivity, report."""
from .kpi import xirr, moic, dscr_profile, llcr, plcr, debt_capacity, compute_kpis
from .decision import Insight, evaluate_deal
from .sensitivity import tornado, spider
from .report import (
    build_investor_package,
    group_insights,
    recommendations,
    sort_insights,
)

__all__ = [
    "xirr", "moic", "dscr_profile", "llcr", "plcr", "debt_capacity", "compute_kpis",
    "Insight", "evaluate_deal",
    "tornado", "spider",
    "build_investor_package", "group_insights", "recommendations", "sort_insights",
]
