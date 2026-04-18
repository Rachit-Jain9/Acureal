/**
 * Waterfall engine — skeleton. Applies cash by priority tier per month.
 * Debt-before-equity ordering enforced by priority. Allocation bodies
 * are delegated to per-tier hooks; default behavior is proportional
 * split across stakeholders up to the tier's monthly demand and
 * cumulative cap.
 */

import { Decimal } from '../decimal';
import { prov } from '../provenance';
import type { ProvenanceEntry } from '../types';
import type {
  AllocationHookOutput,
  WaterfallAllocationRow,
  WaterfallInputs,
  WaterfallOutputs,
  WaterfallTier,
} from './types';

export function runWaterfall(inputs: WaterfallInputs): WaterfallOutputs {
  const tiers = [...inputs.tiers].sort((a, b) => a.priority - b.priority);
  const totalMonths = inputs.context.totalMonths;
  const rows: WaterfallAllocationRow[] = [];
  const perTierByMonth = new Map<string, Decimal[]>();
  const cumulativeByTier = new Map<string, Decimal>();
  const residual: Decimal[] = new Array(totalMonths).fill(null).map(() => Decimal.zero());

  for (const t of tiers) {
    perTierByMonth.set(t.id, new Array(totalMonths).fill(null).map(() => Decimal.zero()));
    cumulativeByTier.set(t.id, Decimal.zero());
  }

  for (let m = 0; m < totalMonths; m++) {
    let available = m < inputs.availableByMonth.length ? inputs.availableByMonth[m] : Decimal.zero();
    if (available.isNegative()) available = Decimal.zero();

    // Tiers of the same priority are paid pari-passu: sum demands, scale down.
    const priorityGroups = groupByPriority(tiers);
    for (const group of priorityGroups) {
      if (available.isZero()) break;
      const demands = group.map((t) => demandAtMonth(t, m, cumulativeByTier.get(t.id)!));
      const totalDemand = demands.reduce<Decimal>((a, d) => a.add(d), Decimal.zero());
      if (totalDemand.isZero()) continue;

      const scale = available.compare(totalDemand) < 0
        ? available.toNumber() / totalDemand.toNumber()
        : 1;

      for (let i = 0; i < group.length; i++) {
        const tier = group[i];
        const demand = demands[i];
        if (demand.isZero()) continue;
        const allocToTier = scale < 1 ? demand.mulNumber(scale) : demand;
        const hook = tier.allocate ?? defaultAllocation;
        const out = hook({ amount: allocToTier, month: m, tier, context: inputs.context });
        for (const s of out.perStakeholder) {
          rows.push({ month: m, tierId: tier.id, stakeholderId: s.stakeholderId, amount: s.amount });
        }
        const tierSum = sumAlloc(out);
        const monthly = perTierByMonth.get(tier.id)!;
        monthly[m] = monthly[m].add(tierSum);
        cumulativeByTier.set(tier.id, cumulativeByTier.get(tier.id)!.add(tierSum));
        available = available.sub(tierSum);
        if (available.isNegative()) available = Decimal.zero();
      }
    }

    residual[m] = available;
  }

  const perTierMonthly = Array.from(perTierByMonth.entries()).map(([tierId, byMonth]) => ({
    tierId,
    byMonth,
  }));

  const provenance: ProvenanceEntry[] = [
    prov('waterfall.rows', 'kernel.waterfall.run', 'priority ordering with pari-passu within priority'),
  ];

  return { rows, perTierMonthly, residualByMonth: residual, provenance };
}

function groupByPriority(tiers: readonly WaterfallTier[]): WaterfallTier[][] {
  const groups: WaterfallTier[][] = [];
  let current: WaterfallTier[] = [];
  let currentPriority: number | null = null;
  for (const t of tiers) {
    if (currentPriority == null || t.priority === currentPriority) {
      current.push(t);
      currentPriority = t.priority;
    } else {
      groups.push(current);
      current = [t];
      currentPriority = t.priority;
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

function demandAtMonth(tier: WaterfallTier, m: number, cumulative: Decimal): Decimal {
  const series = tier.demandPerMonth ?? [];
  const d = m < series.length ? series[m] : Decimal.zero();
  if (d.isZero() || d.isNegative()) return Decimal.zero();
  if (tier.cumulativeCap) {
    const headroom = tier.cumulativeCap.sub(cumulative);
    if (headroom.isNegative() || headroom.isZero()) return Decimal.zero();
    return d.compare(headroom) > 0 ? headroom : d;
  }
  return d;
}

function defaultAllocation({
  amount,
  tier,
}: {
  amount: Decimal;
  tier: WaterfallTier;
}): AllocationHookOutput {
  const n = tier.stakeholders.length;
  if (n === 0) return { perStakeholder: [], leftover: amount };
  const share = amount.divInt(n);
  const out = tier.stakeholders.map((s) => ({ stakeholderId: s.id, amount: share }));
  // Rounding drift to first stakeholder to preserve total.
  const totalAllocated = share.mulNumber(n);
  const drift = amount.sub(totalAllocated);
  if (!drift.isZero()) {
    out[0] = { stakeholderId: out[0].stakeholderId, amount: out[0].amount.add(drift) };
  }
  return { perStakeholder: out, leftover: Decimal.zero() };
}

function sumAlloc(out: AllocationHookOutput): Decimal {
  let s = Decimal.zero();
  for (const a of out.perStakeholder) s = s.add(a.amount);
  return s;
}
