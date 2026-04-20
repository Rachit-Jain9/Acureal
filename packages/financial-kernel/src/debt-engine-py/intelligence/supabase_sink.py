"""
Supabase persistence for the investor-intelligence pipeline.

All writes are best-effort: if SUPABASE_URL / SUPABASE_KEY aren't set,
or the client throws, we log and swallow. The compute path must never
block on monitoring.

Tables touched:
  investor_packages          — latest projection per deal (upsert by deal_id)
  investor_package_snapshots — append-only history
  monitoring_logs            — append-only event log

`feature_flag_cohorts` is retained in schema for legacy dashboards but is
no longer written from the Python path — the debt engine is unconditional
so there is no rollout cohort to persist. The legacy `upsert_cohort`
helper is kept as a no-op shim for deploy-time backward compatibility.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
from decimal import Decimal
from typing import Any, Dict, List, Optional

_logger = logging.getLogger(__name__)

_client_cache: Any = None


def _client():
    """Lazy Supabase client — returns None if env not configured."""
    global _client_cache
    if _client_cache is not None:
        return _client_cache
    url = os.environ.get("SUPABASE_URL", "").strip()
    # Prefer service-role key if present; fall back to anon SUPABASE_KEY.
    key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("SUPABASE_KEY")
        or ""
    ).strip()
    if not url or not key:
        return None
    try:
        from supabase import create_client  # type: ignore
    except ImportError:
        _logger.warning("supabase-py not installed; persistence disabled")
        return None
    try:
        _client_cache = create_client(url, key)
    except Exception as exc:  # pragma: no cover
        _logger.warning("supabase client init failed: %s", exc)
        _client_cache = None
    return _client_cache


def _num(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(Decimal(str(v)))
    except Exception:
        return None


def sha256_hex(body: Any) -> str:
    raw = json.dumps(body, sort_keys=True, default=str).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _flatten_for_row(pkg: Dict[str, Any]) -> Dict[str, Any]:
    """Project the investor-package JSON into a columnar row for
    `investor_packages` so the frontend can filter by IRR/DSCR without
    parsing JSON each time."""
    summary = pkg.get("summary", {}) or {}
    kpi = summary.get("kpi", {}) or {}
    irr_pct = _num(kpi.get("irrLeveredPct"))
    return {
        "headline": summary.get("headline"),
        "narrative": summary.get("narrative"),
        "irr_levered_pct": irr_pct,
        "min_dscr": _num(kpi.get("minDSCR")),
        "moic": _num(kpi.get("moic")),
        "llcr": _num(kpi.get("llcr")),
        "peak_equity_cr": _num(kpi.get("peakEquityCr")),
        "peak_debt_cr": _num(kpi.get("peakDebtCr")),
        "residual_total_cr": _num(kpi.get("residualTotalCr")),
        "breach_count": int(kpi.get("breachCount") or 0),
        "insights_count": len(summary.get("insights") or []),
    }


def persist_investor_package(
    *,
    deal_id: str,
    engine_version: str,
    body: Dict[str, Any],
    organization_id: Optional[str] = None,
    input_hash: Optional[str] = None,
    source: str = "python",
) -> Dict[str, Any]:
    """Upsert the latest-per-deal projection, append a snapshot, log the
    event. Returns a small status dict; never raises on Supabase errors."""
    result = {"projected": False, "snapshotted": False, "logged": False}
    client = _client()
    if client is None:
        return {**result, "reason": "supabase_not_configured"}

    flat = _flatten_for_row(body)
    ih = input_hash or sha256_hex(body)

    # 1. Upsert latest projection.
    try:
        client.table("investor_packages").upsert(
            {
                "deal_id": deal_id,
                "organization_id": organization_id,
                "engine_version": engine_version,
                "source": source,
                **flat,
                "body": body,
                "input_hash": ih,
            },
            on_conflict="deal_id",
        ).execute()
        result["projected"] = True
    except Exception as exc:
        _logger.warning("investor_packages upsert failed: %s", exc)
        result["projection_error"] = str(exc)

    # 2. Append a snapshot.
    try:
        client.table("investor_package_snapshots").insert(
            {
                "deal_id": deal_id,
                "organization_id": organization_id,
                "engine_version": engine_version,
                "source": source,
                "input_hash": ih,
                "body": body,
            }
        ).execute()
        result["snapshotted"] = True
    except Exception as exc:
        _logger.warning("investor_package_snapshots insert failed: %s", exc)
        result["snapshot_error"] = str(exc)

    # 3. Monitoring event.
    try:
        client.table("monitoring_logs").insert(
            {
                "deal_id": deal_id,
                "organization_id": organization_id,
                "source": "python-fastapi",
                "event": "investor_package_ok",
                "severity": "info",
                "engine_version": engine_version,
                "payload": {
                    "headline": flat["headline"],
                    "insightsCount": flat["insights_count"],
                    "inputHash": ih,
                },
            }
        ).execute()
        result["logged"] = True
    except Exception as exc:
        _logger.warning("monitoring_logs insert failed: %s", exc)
        result["log_error"] = str(exc)

    return result


def upsert_cohort(
    *,
    subject_id: str,
    cohort: str,
    flag_key: str = "DEBT_ENGINE",
    subject_kind: str = "deal",
    rollout_pct: int = 0,
    bucket: Optional[int] = None,
    kill_switch: bool = False,
    reason: str = "cohort_persistence_removed",
) -> Dict[str, Any]:
    """Deprecated no-op. Cohort persistence was removed when the debt
    engine became unconditional — there is no rollout to record. Kept as
    a stable import target so existing callers don't break during rollout.
    Silently returns a persisted=False status; callers should not depend
    on side effects.
    """
    # Reference inputs to keep lint quiet without persisting.
    _ = (subject_id, cohort, flag_key, subject_kind, rollout_pct, bucket, kill_switch)
    return {"persisted": False, "reason": reason}


def read_latest_snapshot(deal_id: str) -> Optional[Dict[str, Any]]:
    """Read the most-recent snapshot for a deal — used by reconciliation."""
    client = _client()
    if client is None:
        return None
    try:
        resp = (
            client.table("investor_package_snapshots")
            .select("body, engine_version, input_hash, created_at")
            .eq("deal_id", deal_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return rows[0] if rows else None
    except Exception as exc:
        _logger.warning("read_latest_snapshot failed: %s", exc)
        return None
