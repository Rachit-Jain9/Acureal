/**
 * HTTP client for the optional Python debt kernel service.
 *
 * The Python service is not required: the TS orchestrator has a
 * complete in-process fallback. Set `DEBT_ENGINE_PY_URL` to route a
 * percentage of traffic through Python (useful for parity checks or
 * heavy scipy-based sizing).
 *
 * All decimals cross the wire as strings. The adapter re-hydrates
 * `Decimal` on the TS side so caller code never sees JSON floats.
 */

import { Decimal } from '../decimal';
import type {
  FacilitySpec,
  CFADSInputs,
  CFADSOutputs,
  DebtScheduleAggregate,
  FacilityPeriodRow,
} from '../debt-engine';
import type { WaterfallTier } from '../waterfall-engine';
import type { WireFacilityRow } from './types';

// Node 18+ ships global fetch / AbortController. We type them minimally
// here so the kernel's `lib` can stay at ES2020 without pulling DOM types.
declare const fetch: (url: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: { aborted: boolean };
}) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;
declare class AbortController {
  readonly signal: { aborted: boolean };
  abort(): void;
}

interface PythonOrchestrateRequest {
  dealId: string;
  facilities: unknown[];
  cfadsInputs: unknown;
  tiers: unknown[];
  availableByMonth: string[];
  options: {
    totalMonths: number;
    projectCostCr?: string;
    propertyValueCr?: string;
    sculptTarget?: string;
  };
}

export interface PythonOrchestrateResponse {
  schedule: WireFacilityRow[];
  cfads: { monthly: string[]; annualBuckets: string[]; rolling12m: (string | null)[] };
  covenants: Array<{
    month: number;
    dscr?: string;
    ltc?: string;
    ltv?: string;
    minCashOK: boolean;
  }>;
  covenantBreaches: Array<{ month: number; covenant: string; actual: string; threshold: string }>;
  waterfallRows: Array<{ month: number; tierId: string; stakeholderId: string; amount: string }>;
  residualByMonth: string[];
  kpis: {
    cumulativeDebtServiceCr: string;
    peakDebtCr: string;
    residualTotalCr: string;
    breachCount: number;
    minDSCR?: string;
    avgDSCR?: string;
  };
  provenance: Array<Record<string, unknown>>;
  engineVersion: string;
}

function serializeDecimal(d: Decimal | undefined | null): string | undefined {
  if (d == null) return undefined;
  return d.toString();
}

function serializeFacility(f: FacilitySpec): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(f, (_k, v) =>
      v && typeof v === 'object' && typeof (v as { q?: unknown }).q === 'bigint'
        ? (v as Decimal).toString()
        : v,
    ),
  );
}

function serializeCFADS(c: CFADSInputs): Record<string, unknown> {
  const arrOrNull = (xs?: readonly Decimal[]) => (xs ? xs.map((x) => x.toString()) : undefined);
  return {
    revenue: c.revenue.map((x) => x.toString()),
    opex: c.opex.map((x) => x.toString()),
    taxes: arrOrNull(c.taxes),
    maintenanceCapex: arrOrNull(c.maintenanceCapex),
    workingCapitalDelta: arrOrNull(c.workingCapital),
  };
}

export async function callPythonOrchestrate(args: {
  url: string;
  dealId: string;
  facilities: readonly FacilitySpec[];
  cfadsInputs: CFADSInputs;
  tiers: readonly WaterfallTier[];
  availableByMonth: readonly Decimal[];
  totalMonths: number;
  projectCostCr?: Decimal;
  propertyValueCr?: Decimal;
  sculptTarget?: Decimal;
  timeoutMs?: number;
}): Promise<PythonOrchestrateResponse> {
  const body: PythonOrchestrateRequest = {
    dealId: args.dealId,
    facilities: args.facilities.map(serializeFacility),
    cfadsInputs: serializeCFADS(args.cfadsInputs),
    tiers: args.tiers.map((t) => {
      return {
        id: t.id,
        kind: t.kind,
        label: t.label,
        priority: t.priority,
        stakeholders: t.stakeholders,
        demandPerMonth: t.demandPerMonth?.map((d) => d.toString()),
        cumulativeCap: t.cumulativeCap?.toString(),
      };
    }),
    availableByMonth: args.availableByMonth.map((d) => d.toString()),
    options: {
      totalMonths: args.totalMonths,
      projectCostCr: serializeDecimal(args.projectCostCr),
      propertyValueCr: serializeDecimal(args.propertyValueCr),
      sculptTarget: serializeDecimal(args.sculptTarget),
    },
  };
  const controller = new AbortController();
  const timeoutMs = args.timeoutMs ?? 8_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${args.url.replace(/\/$/, '')}/orchestrate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`python orchestrate HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    return (await res.json()) as PythonOrchestrateResponse;
  } finally {
    clearTimeout(timer);
  }
}

/** Rehydrate Python-side facility rows into kernel `DebtScheduleAggregate`. */
export function rehydrateAggregate(
  resp: PythonOrchestrateResponse,
  totalMonths: number,
): DebtScheduleAggregate {
  const ds = Array.from({ length: totalMonths }, () => Decimal.zero());
  const ip = Array.from({ length: totalMonths }, () => Decimal.zero());
  const pp = Array.from({ length: totalMonths }, () => Decimal.zero());
  const drawn = Array.from({ length: totalMonths }, () => Decimal.zero());
  const bal = Array.from({ length: totalMonths }, () => Decimal.zero());
  for (const r of resp.schedule) {
    if (r.month >= totalMonths) continue;
    const iPaid = Decimal.fromString(r.interestPaid);
    const pPaid = Decimal.fromString(r.principalPaid).add(Decimal.fromString(r.prepaymentPaid));
    ds[r.month] = ds[r.month].add(iPaid).add(pPaid);
    ip[r.month] = ip[r.month].add(iPaid);
    pp[r.month] = pp[r.month].add(pPaid);
    drawn[r.month] = drawn[r.month].add(Decimal.fromString(r.draw));
    bal[r.month] = bal[r.month].add(Decimal.fromString(r.closingBalance));
  }
  return {
    totalMonths,
    facilities: [],
    monthlyDebtService: ds,
    monthlyInterestPaid: ip,
    monthlyPrincipalPaid: pp,
    monthlyDrawn: drawn,
    closingBalanceByMonth: bal,
    provenance: [],
  };
}

export function rehydrateCFADS(resp: PythonOrchestrateResponse): CFADSOutputs {
  return {
    monthly: resp.cfads.monthly.map((s) => Decimal.fromString(s)),
    annualBuckets: resp.cfads.annualBuckets.map((s) => Decimal.fromString(s)),
    rolling12m: resp.cfads.rolling12m.map((s) => (s == null ? null : Decimal.fromString(s))),
    provenance: [],
  };
}

export function rehydrateFacilityRows(resp: PythonOrchestrateResponse): FacilityPeriodRow[] {
  const zero = Decimal.zero();
  return resp.schedule.map((r) => ({
    month: r.month,
    openingBalance: Decimal.fromString(r.openingBalance),
    draw: Decimal.fromString(r.draw),
    interestAccrued: Decimal.fromString(r.interestAccrued),
    interestPaid: Decimal.fromString(r.interestPaid),
    interestCapitalized: Decimal.fromString(r.interestCapitalized),
    principalPaid: Decimal.fromString(r.principalPaid),
    prepaymentPaid: Decimal.fromString(r.prepaymentPaid),
    prepaymentPenalty: zero,
    feesPaid: zero,
    dsraDeposit: zero,
    dsraRelease: zero,
    dsraBalance: zero,
    closingBalance: Decimal.fromString(r.closingBalance),
    effectiveAnnualRatePct: 0,
  }));
}
