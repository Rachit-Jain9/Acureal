"""
Multi-tier waterfall allocator with pref return, catch-up, and promote.

Monthly cash `available` is distributed top-down by `priority`. Within a
priority group, demand is served pari-passu. Unfilled supply flows to
the next priority. Leftover after all tiers is `residual`.

Pref/catch-up/promote tiers carry state (cumulative contributions and
distributions) across months; we express that via closure-state demand
functions so the engine core stays ordering-only.
"""
from __future__ import annotations
from decimal import Decimal
from typing import List, Dict, Any, Tuple, Optional

ZERO = Decimal(0)


def _D(v) -> Decimal:
    if v is None:
        return ZERO
    if isinstance(v, Decimal):
        return v
    return Decimal(str(v))


def _demand_at(tier: Dict[str, Any], m: int, cumulative: Decimal) -> Decimal:
    """Demand for a simple-demand tier: per-month array minus already-paid."""
    demands = tier.get('demandPerMonth')
    if not demands:
        base = ZERO
    else:
        base = _D(demands[m]) if m < len(demands) else ZERO
    cap = tier.get('cumulativeCap')
    if cap is not None:
        remaining_cap = max(ZERO, _D(cap) - cumulative)
        base = min(base, remaining_cap)
    return base


def run_waterfall(tiers: List[Dict[str, Any]], available_by_month: List[str]) -> Dict[str, Any]:
    months = len(available_by_month)
    cumulative: Dict[str, Decimal] = {t['id']: ZERO for t in tiers}
    rows: List[Dict[str, Any]] = []
    residual: List[Decimal] = []
    # Group tiers by priority.
    groups: Dict[int, List[Dict[str, Any]]] = {}
    for t in tiers:
        groups.setdefault(int(t['priority']), []).append(t)
    priorities = sorted(groups.keys())
    for m in range(months):
        avail = _D(available_by_month[m])
        for p in priorities:
            if avail <= 0:
                break
            group = groups[p]
            demands = [_demand_at(t, m, cumulative[t['id']]) for t in group]
            total = sum(demands, ZERO)
            if total <= 0:
                continue
            alloc: List[Decimal] = []
            if avail >= total:
                alloc = demands
            else:
                # pari-passu
                alloc = [(d * avail / total) if total > 0 else ZERO for d in demands]
            for t, amt in zip(group, alloc):
                if amt <= 0:
                    continue
                cumulative[t['id']] += amt
                # Distribute among stakeholders evenly if no allocate hook.
                stk = t['stakeholders']
                if not stk:
                    continue
                share = amt / Decimal(len(stk))
                for s in stk:
                    rows.append({
                        'month': m, 'tierId': t['id'],
                        'stakeholderId': s['id'], 'amount': str(share),
                    })
            avail -= sum(alloc, ZERO)
        residual.append(avail)
    return {
        'rows': rows,
        'residualByMonth': [str(r) for r in residual],
        'cumulativeByTier': {k: str(v) for k, v in cumulative.items()},
    }


def build_pref_catch_promote_tiers(
    lp_id: str, sponsor_id: str,
    lp_capital_cr: Decimal, sponsor_capital_cr: Decimal,
    pref_rate_pct: Decimal, catch_up_pct: Decimal,
    promote_pct: Decimal, horizon_months: int,
) -> List[Dict[str, Any]]:
    """Constructs four tiers: ROC → Pref → Catch-up → Promote/residual split.

    Note: these are demand-stub specs for the TS side to hydrate into
    closure-demand tiers. This Python representation captures intent; the
    concrete closure runs TS-side in `pref_catch_promote.ts` where state
    tracking is cheap to express. Here we emit equivalent static demands
    that upper-bound the call on each tier.
    """
    total_capital = lp_capital_cr + sponsor_capital_cr
    monthly_pref = total_capital * pref_rate_pct / Decimal(100) / Decimal(12)
    # Emit monthly demand arrays upper-bounded; TS side recomputes with state.
    tiers: List[Dict[str, Any]] = [
        {
            'id': 'roc',
            'kind': 'preferred_equity',
            'priority': 20,
            'stakeholders': [
                {'id': lp_id, 'role': 'lp'},
                {'id': sponsor_id, 'role': 'sponsor'},
            ],
            'demandPerMonth': [str(total_capital / Decimal(horizon_months))] * horizon_months,
            'cumulativeCap': str(total_capital),
        },
        {
            'id': 'pref',
            'kind': 'preferred_equity',
            'priority': 30,
            'stakeholders': [{'id': lp_id, 'role': 'lp'}],
            'demandPerMonth': [str(monthly_pref)] * horizon_months,
        },
        {
            'id': 'catchup',
            'kind': 'promote',
            'priority': 40,
            'stakeholders': [{'id': sponsor_id, 'role': 'sponsor'}],
            'demandPerMonth': [str(monthly_pref * catch_up_pct / Decimal(100))] * horizon_months,
        },
        {
            'id': 'promote',
            'kind': 'promote',
            'priority': 50,
            'stakeholders': [
                {'id': lp_id, 'role': 'lp'},
                {'id': sponsor_id, 'role': 'sponsor'},
            ],
            'demandPerMonth': [str(total_capital)] * horizon_months,
        },
    ]
    return tiers
