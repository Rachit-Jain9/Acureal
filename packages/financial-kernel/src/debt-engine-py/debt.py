"""
Monthly facility roll-forward using Python `Decimal` arithmetic.

Mirrors the algorithm in `src/debt-engine/engine.ts`. Kept deliberately
straightforward — pandas is only used at the aggregation step where it
buys real vectorization; individual facility loops stay scalar-Decimal
because grace/moratorium/refinance branching makes vectorization more
trouble than it's worth at monthly resolution.

Core invariant (asserted in the TS tests; trusted here):

    opening + draw + interestCapitalized
        - principalPaid - prepaymentPaid
        = closingBalance
"""
from __future__ import annotations
from decimal import Decimal, getcontext
from typing import List, Dict, Any
import pandas as pd
from scipy.optimize import brentq

getcontext().prec = 50

ZERO = Decimal(0)
ONE = Decimal(1)
TWELVE = Decimal(12)
HUNDRED = Decimal(100)


def _D(v) -> Decimal:
    if v is None:
        return ZERO
    if isinstance(v, Decimal):
        return v
    return Decimal(str(v))


def emi(principal: Decimal, annual_pct: Decimal, n: int) -> Decimal:
    if n <= 0 or principal <= 0:
        return ZERO
    r = annual_pct / HUNDRED / TWELVE
    if r == 0:
        return principal / Decimal(n)
    one_plus = (ONE + r) ** n
    return principal * r * one_plus / (one_plus - ONE)


def resolve_rate(spec: Dict[str, Any], _month: int) -> Decimal:
    rate = spec['rate']
    if rate['kind'] == 'fixed':
        return _D(rate['annualPct'])
    ref = _D(rate.get('referencePct') or 0)
    spread = _D(rate['spreadPct'])
    pct = ref + spread
    if rate.get('floorPct') is not None:
        pct = max(pct, _D(rate['floorPct']))
    if rate.get('capPct') is not None:
        pct = min(pct, _D(rate['capPct']))
    return pct


def draw_cap(spec: Dict[str, Any], m: int) -> Decimal:
    dr = spec['drawRule']
    if dr['kind'] == 'bullet_at_origination':
        return _D(spec['commitment']) if m == spec['startMonth'] else ZERO
    if dr['kind'] == 'schedule':
        idx = m - spec['startMonth']
        per = dr.get('perMonth') or []
        return _D(per[idx]) if 0 <= idx < len(per) else ZERO
    caps = dr.get('capPerMonth')
    if caps is None:
        return ZERO
    idx = m - spec['startMonth']
    return _D(caps[idx]) if 0 <= idx < len(caps) else ZERO


def scheduled_principal(spec: Dict[str, Any], m: int, balance_after_draw: Decimal, interest_paid: Decimal) -> Decimal:
    k = spec['kind']
    if k == 'interest_only':
        return ZERO
    if k in ('bullet', 'balloon'):
        if k == 'balloon' and spec.get('customAmortSchedule'):
            sched = spec['customAmortSchedule']
            idx = m - spec['startMonth']
            scheduled = _D(sched[idx]) if 0 <= idx < len(sched) else ZERO
            if m == spec['maturityMonth']:
                return min(balance_after_draw, balance_after_draw)
            return scheduled
        return balance_after_draw if m == spec['maturityMonth'] else ZERO
    if k == 'amortizing_custom':
        sched = spec.get('customAmortSchedule') or []
        idx = m - spec['startMonth']
        return _D(sched[idx]) if 0 <= idx < len(sched) else ZERO
    if k == 'amortizing_emi':
        n = spec.get('amortizationTermMonths') or (spec['maturityMonth'] - spec['startMonth'])
        pmt = emi(_D(spec['commitment']), resolve_rate(spec, m), int(n))
        return max(ZERO, pmt - interest_paid)
    return ZERO


def _zero_row(fid: str, m: int, bal: Decimal) -> Dict[str, Any]:
    return {
        'facilityId': fid, 'month': m,
        'openingBalance': str(bal), 'draw': '0',
        'interestAccrued': '0', 'interestPaid': '0',
        'interestCapitalized': '0', 'principalPaid': '0',
        'prepaymentPaid': '0', 'closingBalance': str(bal),
    }


def roll_forward(spec: Dict[str, Any], total_months: int) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    balance = _D(spec.get('openingBalance0') or 0)
    grace = int(spec.get('gracePeriodMonths') or 0)
    moratorium = int(spec.get('moratoriumMonths') or 0)
    cap_during_grace = bool(spec.get('capitalizeInterestDuringGrace'))
    start = int(spec['startMonth'])
    mat = int(spec['maturityMonth'])
    commitment = _D(spec['commitment'])
    for m in range(total_months):
        if m < start or m > mat:
            rows.append(_zero_row(spec['id'], m, balance))
            continue
        drawn_already = balance
        draw = ZERO
        if drawn_already < commitment:
            cap = draw_cap(spec, m)
            draw = min(cap, commitment - drawn_already)
        balance_after_draw = balance + draw
        rate_pct = resolve_rate(spec, m)
        interest_accrued = balance_after_draw * (rate_pct / HUNDRED / TWELVE)
        offset = m - start
        in_grace = offset < grace
        in_mora = grace <= offset < grace + moratorium
        if in_grace and cap_during_grace:
            interest_paid = ZERO
            interest_cap = interest_accrued
        elif in_mora:
            interest_paid = ZERO
            interest_cap = interest_accrued
        else:
            interest_paid = interest_accrued
            interest_cap = ZERO
        principal = ZERO
        if not in_grace and not in_mora:
            principal = scheduled_principal(spec, m, balance_after_draw, interest_paid)
        principal = min(principal, balance_after_draw + interest_cap)
        prepayment = ZERO
        closing = balance_after_draw + interest_cap - principal - prepayment
        rows.append({
            'facilityId': spec['id'], 'month': m,
            'openingBalance': str(balance),
            'draw': str(draw),
            'interestAccrued': str(interest_accrued),
            'interestPaid': str(interest_paid),
            'interestCapitalized': str(interest_cap),
            'principalPaid': str(principal),
            'prepaymentPaid': str(prepayment),
            'closingBalance': str(closing),
        })
        balance = closing
    return rows


def roll_forward_all(specs: List[Dict[str, Any]], total_months: int) -> List[Dict[str, Any]]:
    """Apply refinance linkage. Same logic as TS `attachRefinanceTakeout`."""
    by_id = {s['id']: dict(s) for s in specs}
    ordered = [s['id'] for s in specs]
    # Truncate originators with refinance directives; seed replacement opening balance.
    for sid in list(ordered):
        s = by_id.get(sid)
        if not s:
            continue
        refi = s.get('refinance')
        if not refi or not refi.get('replacementSpec'):
            continue
        at_m = int(refi['atMonth'])
        trunc = dict(s)
        trunc['maturityMonth'] = at_m
        trunc_rows = roll_forward(trunc, total_months)
        by_id[sid] = {'_baked': trunc_rows}
        repl = dict(refi['replacementSpec'])
        bal = Decimal(trunc_rows[at_m]['closingBalance']) if at_m < total_months else ZERO
        repl['openingBalance0'] = str(bal)
        by_id[repl['id']] = repl
        if repl['id'] not in ordered:
            ordered.append(repl['id'])
    rows: List[Dict[str, Any]] = []
    for sid in ordered:
        entry = by_id[sid]
        if isinstance(entry, dict) and '_baked' in entry:
            rows.extend(entry['_baked'])
        else:
            rows.extend(roll_forward(entry, total_months))
    return rows


def aggregate(rows: List[Dict[str, Any]], total_months: int) -> Dict[str, Any]:
    if not rows:
        zeros = ['0'] * total_months
        return {
            'monthlyDebtService': zeros,
            'monthlyInterestPaid': zeros,
            'monthlyPrincipalPaid': zeros,
            'totalOutstandingByMonth': zeros,
        }
    df = pd.DataFrame(rows)
    for c in ('interestPaid', 'principalPaid', 'prepaymentPaid', 'closingBalance'):
        df[c] = df[c].map(lambda v: Decimal(v))
    ds = [ZERO] * total_months
    ip = [ZERO] * total_months
    pp = [ZERO] * total_months
    bal = [ZERO] * total_months
    for _, r in df.iterrows():
        m = int(r['month'])
        if m >= total_months:
            continue
        ip[m] += r['interestPaid']
        pp[m] += r['principalPaid'] + r['prepaymentPaid']
        ds[m] += r['interestPaid'] + r['principalPaid'] + r['prepaymentPaid']
        bal[m] += r['closingBalance']
    return {
        'monthlyDebtService': [str(x) for x in ds],
        'monthlyInterestPaid': [str(x) for x in ip],
        'monthlyPrincipalPaid': [str(x) for x in pp],
        'totalOutstandingByMonth': [str(x) for x in bal],
    }


def compute_cfads(inp: Dict[str, Any]) -> Dict[str, Any]:
    rev = [_D(x) for x in inp.get('revenue') or []]
    n = len(rev)

    def padded(name: str) -> List[Decimal]:
        arr = inp.get(name) or []
        out = [_D(x) for x in arr]
        return out + [ZERO] * max(0, n - len(out))

    opex = padded('opex')
    tax = padded('taxes')
    mc = padded('maintenanceCapex')
    wc = padded('workingCapitalDelta')
    monthly = [rev[i] - opex[i] - tax[i] - mc[i] - wc[i] for i in range(n)]
    rolling: List[Any] = []
    for i in range(n):
        if i < 11:
            rolling.append(None)
        else:
            rolling.append(str(sum(monthly[i - 11:i + 1])))
    annual: List[str] = []
    for y in range(0, n, 12):
        annual.append(str(sum(monthly[y:y + 12])))
    return {
        'monthly': [str(m) for m in monthly],
        'annualBuckets': annual,
        'rolling12m': rolling,
    }


def sculpt_dscr_target(cfads: List[Decimal], interest: List[Decimal], balance: List[Decimal], target: Decimal) -> List[Decimal]:
    """Direct sizing — closed form. Matches TS sculptDSCR."""
    out: List[Decimal] = []
    n = len(cfads)
    for m in range(n):
        cf = cfads[m]
        i_m = interest[m] if m < len(interest) else ZERO
        bal_m = balance[m] if m < len(balance) else ZERO
        if target <= 0 or cf <= 0:
            out.append(ZERO)
            continue
        allowed_ds = cf / target
        principal = max(ZERO, min(bal_m, allowed_ds - i_m))
        out.append(principal)
    return out


def sculpt_multi_covenant(cfads: List[Decimal], interest: List[Decimal], balance: List[Decimal],
                          dscr_target: Decimal, max_ltc: Decimal | None, project_cost: Decimal | None) -> List[Decimal]:
    """Apply DSCR sculpt, then clamp principal so balance respects max LTC each month."""
    base = sculpt_dscr_target(cfads, interest, balance, dscr_target)
    if max_ltc is None or project_cost is None or project_cost <= 0:
        return base
    cap_balance = project_cost * max_ltc
    running = balance[0] if balance else ZERO
    out: List[Decimal] = []
    for m, principal in enumerate(base):
        new_bal = running - principal
        if new_bal > cap_balance:
            principal_needed = running - cap_balance
            principal = max(principal, min(running, principal_needed))
        out.append(principal)
        running = running - principal
    return out


def compute_covenants(agg: Dict[str, Any], cfads_monthly: List[str], project_cost: Decimal | None,
                      property_value: Decimal | None, facilities: List[Dict[str, Any]]) -> Dict[str, Any]:
    ds = [Decimal(x) for x in agg['monthlyDebtService']]
    bal = [Decimal(x) for x in agg['totalOutstandingByMonth']]
    cf = [Decimal(x) for x in cfads_monthly]
    n = max(len(ds), len(cf))
    monthly: List[Dict[str, Any]] = []
    breaches: List[Dict[str, Any]] = []
    min_dscrs: List[Decimal] = []
    for m in range(n):
        d = ds[m] if m < len(ds) else ZERO
        b = bal[m] if m < len(bal) else ZERO
        c = cf[m] if m < len(cf) else ZERO
        dscr: Decimal | None = None
        if d > 0:
            dscr = c / d
            min_dscrs.append(dscr)
        ltc = None
        if project_cost and project_cost > 0:
            ltc = b / project_cost
        ltv = None
        if property_value and property_value > 0:
            ltv = b / property_value
        row = {'month': m, 'minCashOK': True}
        if dscr is not None:
            row['dscr'] = str(dscr)
        if ltc is not None:
            row['ltc'] = str(ltc)
        if ltv is not None:
            row['ltv'] = str(ltv)
        monthly.append(row)
        # Per-facility covenants
        for f in facilities:
            cov = f.get('covenants') or {}
            if cov.get('minDSCR') and dscr is not None:
                thr = Decimal(cov['minDSCR'])
                if dscr < thr:
                    breaches.append({'month': m, 'covenant': 'minDSCR', 'actual': str(dscr), 'threshold': str(thr)})
            if cov.get('maxLTC') and ltc is not None:
                thr = Decimal(cov['maxLTC'])
                if ltc > thr:
                    breaches.append({'month': m, 'covenant': 'maxLTC', 'actual': str(ltc), 'threshold': str(thr)})
            if cov.get('maxLTV') and ltv is not None:
                thr = Decimal(cov['maxLTV'])
                if ltv > thr:
                    breaches.append({'month': m, 'covenant': 'maxLTV', 'actual': str(ltv), 'threshold': str(thr)})
    return {'monthly': monthly, 'breaches': breaches, 'minDSCR': min(min_dscrs) if min_dscrs else None,
            'avgDSCR': (sum(min_dscrs) / len(min_dscrs)) if min_dscrs else None}
