// supabase/functions/investor-package/index.ts
// Deno edge function that proxies to the canonical TypeScript investor
// intelligence service on Vercel. The debt engine is always on; the only
// operational knob is a kill-switch that short-circuits to a safe-mode
// response so deal pages survive an incident without crashing.
//
// History: the prior Python FastAPI companion was retired in the
// 2026-04 consolidation. The proxy URL is unchanged; the backing runtime
// is now the in-process TypeScript kernel.
//
// Why an edge function at all:
//   — centralizes auth (Supabase verifies the caller JWT automatically)
//   — writes monitoring_logs + investor_package_snapshots from trusted
//     server-side with service-role credentials, so the browser can't
//     forge engine-version claims
//   — gives us a single-origin surface at
//     `<project>.supabase.co/functions/v1/investor-package`
//
// Deploy:
//   supabase functions deploy investor-package --project-ref $PROJECT_REF
//
// Required env (set via `supabase secrets set`):
//   KERNEL_URL                  — full URL to /investor-package on Vercel
//                                 (legacy name `FASTAPI_URL` still accepted)
//   SUPABASE_URL                — auto-injected
//   SUPABASE_SERVICE_ROLE_KEY   — auto-injected
//   DEBT_ENGINE_KILL            — '1' to flip every call to safe-mode
//                                 (legacy `DEBT_ENGINE_V2_KILL` still works)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const JSON_HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

// FNV-1a 32-bit, stable hash. Matches `hash32` in the TS kernel so
// telemetry drift detection produces the same bucket on both sides.
function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h;
}

function dealBucket(dealId: string): number {
  return fnv1a(dealId) % 100;
}

type EngineDecision = {
  engineVersion: 'inline' | 'safe-mode';
  killed: boolean;
  bucket: number;
  reason: string;
};

function selectEngine(dealId: string): EngineDecision {
  const killRaw = (Deno.env.get('DEBT_ENGINE_KILL') ?? Deno.env.get('DEBT_ENGINE_V2_KILL') ?? '')
    .trim()
    .toLowerCase();
  const killed = killRaw === '1' || killRaw === 'true' || killRaw === 'on' || killRaw === 'yes';
  const bucket = dealBucket(dealId);
  if (killed) return { engineVersion: 'safe-mode', killed: true, bucket, reason: 'kill_switch_on' };
  return { engineVersion: 'inline', killed: false, bucket, reason: 'inline_default' };
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Build a safe-mode response body: zero KPIs + an info banner insight.
 * Shape matches InvestorPackage so the UI can render without branching.
 */
function safeModePackage(dealId: string): Record<string, unknown> {
  const obs = {
    kind: 'observation',
    severity: 'high',
    title: 'Debt engine disabled',
    explanation: 'The operations kill-switch is currently engaged; all debt figures are zeroed. Operating metrics and asset facts remain accurate. Contact ops to re-enable.',
  };
  return {
    summary: {
      dealId,
      engineVersion: 'safe-mode',
      generatedAt: new Date().toISOString(),
      headline: 'Debt engine temporarily disabled (kill-switch engaged)',
      kpi: {
        irrLeveredPct: null, irrUnleveredPct: null, moic: null,
        minDSCR: null, maxDSCR: null, avgDSCR: null,
        p5DSCR: null, p25DSCR: null, p50DSCR: null, p75DSCR: null,
        llcr: null, plcr: null, peakEquityCr: 0, paybackMonth: null,
        debtCapacityCr: 0, cumulativeDebtServiceCr: 0, peakDebtCr: 0,
        residualTotalCr: 0, breachCount: 0,
      },
      insights: [obs],
      insightsByKind: { risk: [], opportunity: [], observation: [obs] },
      recommendations: [],
      sensitivity: null,
      graph: null,
      narrative: 'Debt engine temporarily disabled. Numbers below reflect operations only.',
    },
    monthly: [],
    waterfallRows: [],
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: JSON_HEADERS });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  // Default to the Vercel production alias so the edge function is
  // immediately usable without `supabase secrets set KERNEL_URL=...`.
  const KERNEL_URL = Deno.env.get('KERNEL_URL')
    || Deno.env.get('FASTAPI_URL')
    || 'https://redip.vercel.app/api/investor-package';
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_KEY') || '';
  if (!KERNEL_URL) return json(500, { error: 'kernel_url_not_configured' });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { error: 'invalid_json' }); }
  const dealId = typeof body?.deal_id === 'string' ? body.deal_id : typeof body?.dealId === 'string' ? body.dealId : null;
  if (!dealId) return json(400, { error: 'deal_id_required' });

  const sb = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    : null;

  const decision = selectEngine(dealId);
  const organizationId = typeof body?.organization_id === 'string' ? body.organization_id : null;

  // Kill-switch: short-circuit to safe-mode without touching upstream.
  if (decision.engineVersion === 'safe-mode') {
    const pkg = safeModePackage(dealId);
    if (sb) {
      await sb.from('monitoring_logs').insert({
        organization_id: organizationId, deal_id: dealId,
        source: 'supabase-edge', event: 'investor_package_safe_mode',
        severity: 'medium', engine_version: 'safe-mode',
        payload: { decision },
      });
    }
    return json(200, { package: pkg, engineVersion: 'safe-mode', flagState: decision, reason: 'kill_switch_on' });
  }

  // Default path: proxy to the Vercel TS kernel endpoint and capture its payload.
  const t0 = performance.now();
  let resp: Response;
  try {
    resp = await fetch(KERNEL_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    if (sb) {
      await sb.from('monitoring_logs').insert({
        organization_id: organizationId, deal_id: dealId,
        source: 'supabase-edge', event: 'kernel_fetch_failed',
        severity: 'high', engine_version: 'inline',
        payload: { error: String(err) },
      });
    }
    return json(502, { error: 'kernel_unreachable', detail: String(err) });
  }
  const elapsedMs = performance.now() - t0;

  let pkg: Record<string, unknown> | null = null;
  try { pkg = await resp.json(); } catch { /* leave pkg null */ }

  if (!resp.ok) {
    if (sb) {
      await sb.from('monitoring_logs').insert({
        organization_id: organizationId, deal_id: dealId,
        source: 'supabase-edge', event: 'kernel_error',
        severity: 'high', engine_version: 'inline',
        payload: { status: resp.status, body: pkg, elapsedMs },
      });
    }
    return json(resp.status, pkg ?? { error: 'kernel_error' });
  }

  if (sb) {
    const hash = await sha256Hex(JSON.stringify(body));
    const summary = (pkg?.summary as Record<string, unknown>) ?? {};
    const kpi = (summary.kpi as Record<string, unknown>) ?? {};
    const num = (v: unknown): number | null => {
      if (v === null || v === undefined) return null;
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? n : null;
    };
    await sb.from('investor_packages').upsert({
      deal_id: dealId, organization_id: organizationId,
      engine_version: 'inline', source: 'supabase-edge',
      headline: summary.headline ?? null, narrative: summary.narrative ?? null,
      irr_levered_pct: num(kpi.irrLeveredPct), min_dscr: num(kpi.minDSCR),
      moic: num(kpi.moic), llcr: num(kpi.llcr),
      peak_equity_cr: num(kpi.peakEquityCr), peak_debt_cr: num(kpi.peakDebtCr),
      residual_total_cr: num(kpi.residualTotalCr),
      breach_count: Number(kpi.breachCount ?? 0),
      insights_count: Array.isArray(summary.insights) ? (summary.insights as unknown[]).length : 0,
      body: pkg, input_hash: hash,
    }, { onConflict: 'deal_id' });
    await sb.from('investor_package_snapshots').insert({
      organization_id: organizationId, deal_id: dealId,
      engine_version: 'inline', source: 'supabase-edge',
      input_hash: hash, body: pkg,
    });
    await sb.from('monitoring_logs').insert({
      organization_id: organizationId, deal_id: dealId,
      source: 'supabase-edge', event: 'investor_package_ok',
      severity: 'info', engine_version: 'inline',
      payload: { elapsedMs, hasInsights: Array.isArray(summary.insights) && (summary.insights as unknown[]).length > 0, hash, bucket: decision.bucket },
    });
  }

  return json(200, { package: pkg, engineVersion: 'inline', flagState: decision });
});
