"""
Reconciliation tests — pin the Python investor-package output shape to
what the TS kernel emits, so both runtimes are observably interchangeable
on the wire.

Shape contract (must match packages/financial-kernel/src/exports/types.ts):
  summary.dealId
  summary.engineVersion
  summary.generatedAt
  summary.headline            — "IRR X% · Min DSCR Yx"
  summary.narrative
  summary.kpi                  — keyed camelCase, all decimal-strings
    .irrLeveredPct, .irrUnleveredPct, .moic,
    .minDSCR, .maxDSCR, .avgDSCR, .p5DSCR, .p25DSCR, .p50DSCR, .p75DSCR,
    .llcr, .plcr, .peakEquityCr, .paybackMonth,
    .debtCapacityCr, .cumulativeDebtServiceCr, .peakDebtCr,
    .residualTotalCr, .breachCount
  summary.insights             — severity-sorted desc
  summary.insightsByKind       — {risk, opportunity, observation}
  summary.recommendations      — deduped, preserves insight order
  summary.sensitivity          — nullable
  summary.graph                — nullable pass-through
  monthly                      — list pass-through
  waterfallRows                — list pass-through
"""
from decimal import Decimal

from intelligence import (
    build_investor_package,
    compute_kpis,
    evaluate_deal,
    group_insights,
    recommendations,
    sort_insights,
)


def _D(x):
    return Decimal(str(x))


def _sample_kpis():
    """Minimal 12-month deal: equity out month 0, even income month 1-12."""
    eq_months = list(range(13))
    eq_cf = [_D(-40)] + [_D(5)] * 12
    proj_months = eq_months
    proj_cf = [_D(-60)] + [_D(7)] * 12
    cfads = [_D(6)] * 12
    ds = [_D(4)] * 12
    debt_out = [_D(20 - i * 2) for i in range(12)]
    return compute_kpis(
        equity_cash_flows=eq_cf,
        equity_months=eq_months,
        project_cash_flows=proj_cf,
        project_months=proj_months,
        cfads=cfads,
        debt_service=ds,
        debt_outstanding=debt_out,
        annual_discount=_D(0.1),
        equity_inflows=[_D(5)] * 12,
        equity_outflows=[_D(40)],
        target_dscr=_D(1.25),
        annual_rate=_D(0.09),
        term_months=12,
    )


def _expected_summary_keys():
    return {
        "dealId", "engineVersion", "generatedAt", "headline", "narrative",
        "kpi", "insights", "insightsByKind", "recommendations",
        "sensitivity", "graph",
    }


def _expected_kpi_keys():
    return {
        "irrLeveredPct", "irrUnleveredPct", "moic",
        "minDSCR", "maxDSCR", "avgDSCR",
        "p5DSCR", "p25DSCR", "p50DSCR", "p75DSCR",
        "llcr", "plcr",
        "peakEquityCr", "paybackMonth",
        "debtCapacityCr", "cumulativeDebtServiceCr", "peakDebtCr",
        "residualTotalCr", "breachCount",
    }


def test_envelope_has_summary_monthly_waterfall():
    pkg = build_investor_package(
        deal_id="deal-1",
        engine_version="v2-python",
        generated_at="2026-04-18T00:00:00Z",
        kpis=_sample_kpis(),
        insights=[],
        narrative="test",
    )
    assert set(pkg.keys()) == {"summary", "monthly", "waterfallRows"}
    assert isinstance(pkg["monthly"], list)
    assert isinstance(pkg["waterfallRows"], list)


def test_summary_has_complete_key_set():
    pkg = build_investor_package(
        deal_id="deal-1",
        engine_version="v2-python",
        generated_at="2026-04-18T00:00:00Z",
        kpis=_sample_kpis(),
        insights=[],
        narrative="test",
    )
    missing = _expected_summary_keys() - set(pkg["summary"].keys())
    assert not missing, f"summary missing keys: {missing}"


def test_kpi_block_has_complete_key_set():
    pkg = build_investor_package(
        deal_id="deal-1",
        engine_version="v2-python",
        generated_at="2026-04-18T00:00:00Z",
        kpis=_sample_kpis(),
        insights=[],
        narrative="test",
    )
    missing = _expected_kpi_keys() - set(pkg["summary"]["kpi"].keys())
    assert not missing, f"kpi missing keys: {missing}"


def test_headline_format():
    pkg = build_investor_package(
        deal_id="d", engine_version="v2-python", generated_at="t",
        kpis=_sample_kpis(), insights=[], narrative="",
    )
    headline = pkg["summary"]["headline"]
    # "IRR X% · Min DSCR Yx" or "IRR n/a · Min DSCR n/a"
    assert headline.startswith("IRR ")
    assert " · Min DSCR " in headline
    assert headline.endswith("x") or headline.endswith("n/a")


def test_insights_sorted_by_severity_desc():
    insights = [
        {"kind": "observation", "severity": "low", "title": "a", "explanation": "", "recommendation": "r1"},
        {"kind": "risk", "severity": "critical", "title": "b", "explanation": "", "recommendation": "r2"},
        {"kind": "opportunity", "severity": "medium", "title": "c", "explanation": "", "recommendation": "r3"},
        {"kind": "risk", "severity": "high", "title": "d", "explanation": "", "recommendation": "r2"},
    ]
    sorted_ins = sort_insights(insights)
    sevs = [i["severity"] for i in sorted_ins]
    assert sevs == ["critical", "high", "medium", "low"]


def test_recommendations_are_deduped_and_ordered():
    insights = [
        {"severity": "critical", "recommendation": "r2"},
        {"severity": "high",     "recommendation": "r2"},
        {"severity": "medium",   "recommendation": "r1"},
        {"severity": "low",      "recommendation": "r3"},
        {"severity": "low",      "recommendation": "r1"},
    ]
    sorted_ins = sort_insights(insights)
    recs = recommendations(sorted_ins)
    assert recs == ["r2", "r1", "r3"]


def test_insights_by_kind_partitions_exhaustively():
    insights = [
        {"kind": "risk", "severity": "high"},
        {"kind": "opportunity", "severity": "medium"},
        {"kind": "observation", "severity": "low"},
    ]
    groups = group_insights(sort_insights(insights))
    assert set(groups.keys()) >= {"risk", "opportunity", "observation"}
    assert len(groups["risk"]) == 1
    assert len(groups["opportunity"]) == 1
    assert len(groups["observation"]) == 1


def test_kpi_values_round_trip_as_strings_not_floats():
    pkg = build_investor_package(
        deal_id="d", engine_version="v2-python", generated_at="t",
        kpis=_sample_kpis(), insights=[], narrative="",
    )
    k = pkg["summary"]["kpi"]
    # Decimal-string invariant — if the value exists, it must be a string
    for field in ("moic", "minDSCR", "maxDSCR", "avgDSCR", "llcr", "plcr",
                  "peakEquityCr", "debtCapacityCr", "cumulativeDebtServiceCr",
                  "peakDebtCr", "residualTotalCr"):
        v = k.get(field)
        if v is not None:
            assert isinstance(v, str), f"{field} should be decimal-string, got {type(v)}"


def test_end_to_end_insight_surface_firing():
    kpis = _sample_kpis()
    insights = evaluate_deal(
        irr_levered=_D(kpis["irr_levered"]) if kpis.get("irr_levered") else None,
        moic=_D(kpis["moic"]) if kpis.get("moic") else None,
        dscr_profile=kpis["dscr_profile"],
        llcr=_D(kpis["llcr"]) if kpis.get("llcr") else None,
        ltc_pct=None, ltv_pct=None, residual_cr=_D(0), breach_count=0,
    )
    assert isinstance(insights, list)
    for ins in insights:
        assert "kind" in ins and ins["kind"] in {"risk", "opportunity", "observation"}
        assert "severity" in ins
