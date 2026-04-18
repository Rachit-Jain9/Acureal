// supabase/functions/investor-package/index.ts
// Deno edge function that proxies to the canonical Python investor
// intelligence service, persists a snapshot + cohort decision, and
// returns the final payload unchanged.
//
// Why an edge function at all:
//   — centralizes auth (Supabase verifies the caller JWT automatically)
//   — writes monitoring_logs + investor_package_snapshots from trusted
//     server-side with service-role credentials, so the browser can't
//     forge cohort assignments
//   — keeps the Python compute hot on Vercel while the edge function
//     gives us a single-origin surface at
//     `<project>.supabase.co/functions/v1/investor-package`
//
// Deploy:
//   supabase functions deploy investor-package --project-ref $PROJECT_REF
//
// Required env (set via `supabase secrets set`):
//   FASTAPI_URL              — full URL to /api/investor-package (Vercel)
//   SUPABASE_URL             — auto-injected
//   SUPABASE_SERVICE_ROLE_KEY — auto-injected
//   DEBT_ENGINE_V2           — 'true' | 'false' (default 'false')
//   DEBT_ENGINE_V2_KILL      — '1' flips every call to v1-legacy
//   DEBT_ENGINE_V2_ROLLOUT_PCT — 0..100, rollout cohort size

// deno-lint-ignore-file no-explicit-any
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

// FNV-1a 32-bit, stable hash for cohort bucketing. Matches the TS
// orchestrator's bucket() so this edge function's cohort decision is
// identical to what the kernel would pick on the backend.
function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h;
}

function bucket(subjectId: string, flagKey: string): number {
  return fnv1a(`${flagKey}:${subjectId}`) % 100;
}

type CohortDecision = {
  cohort: 'v1-legacy' | 'v2-ts' | 'v2-python';
  rolloutPct: number;
  bucket: number;
  killSwitch: boolean;
  reason: string;
};

function decideCohort(dealId: string): CohortDecision {
  const kill = Deno.env.get('DEBT_ENGINE_V2_KILL') === '1';
  const flagOn = (Deno.env.get('DEBT_ENGINE_V2') || 'false').toLowerCase() === 'true';
  const pct = Math.max(0, Math.min(100, Number(Deno.env.get('DEBT_ENGINE_V2_ROLLOUT_PCT') || '0')));
  const b = bucket(dealId, 'DEBT_ENGINE_V2');
  if (kill)  return { cohort: 'v1-legacy', rolloutPct: pct, bucket: b, killSwitch: true,  reason: 'kill_switch_on' };
  if (!flagOn) return { cohort: 'v1-legacy', rolloutPct: pct, bucket: b, killSwitch: false, reason: 'flag_off' };
  if (b < pct) return { cohort: 'v2-python', rolloutPct: pct, bucket: b, killSwitch: false, reason: 'cohort_in_rollout' };
  return { cohort: 'v1-legacy', rolloutPct: pct, bucket: b, killSwitch: false, reason: 'cohort_outside_rollout' };
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: JSON_HEADERS });
  if (req.method !== 'POST')    return json(405, { error: 'method_not_allowed' });

  const FASTAPI_URL = Deno.env.get('FASTAPI_URL') || '';
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!FASTAPI_URL) return json(500, { error: 'fastapi_url_not_configured' });

  let body: any;
  try { body = await req.json(); } catch { return json(400, { error: 'invalid_json' }); }
  const dealId = typeof body?.deal_id === 'string' ? body.deal_id : typeof body?.dealId === 'string' ? body.dealId : null;
  if (!dealId) return json(400, { error: 'deal_id_required' });

  const sb = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    : null;

  const decision = decideCohort(dealId);
  const organizationId = typeof body?.organization_id === 'string' ? body.organization_id : null;

  // Persist cohort decision (upsert by (flag_key, subject_kind, subject_id)).
  if (sb) {
    await sb.from('feature_flag_cohorts').upsert({
      flag_key: 'DEBT_ENGINE_V2',
      subject_kind: 'deal',
      subject_id: dealId,
      cohort: decision.cohort,
      rollout_pct: decision.rolloutPct,
      bucket: decision.bucket,
      kill_switch: decision.killSwitch,
      engine_version: decision.cohort,
      reason: decision.reason,
      payload: { source: 'supabase-edge' },
    }, { onConflict: 'flag_key,subject_kind,subject_id' });
  }

  // v1 cohort: short-circuit. Caller falls back to legacy UI.
  if (decision.cohort === 'v1-legacy') {
    if (sb) {
      await sb.from('monitoring_logs').insert({
        organization_id: organizationId,
        deal_id: dealId,
        source: 'supabase-edge',
        event: 'investor_package_v1_cohort',
        severity: 'info',
        engine_version: 'v1-legacy',
        payload: { decision },
      });
    }
    return json(200, {
      package: null,
      engineVersion: 'v1-legacy',
      flagState: decision,
      reason: decision.killSwitch ? 'kill_switch_on' : 'intelligence_disabled_or_v1_cohort',
    });
  }

  // v2 cohort: proxy to Vercel FastAPI and capture its full payload.
  const t0 = performance.now();
  let resp: Response;
  try {
    resp = await fetch(FASTAPI_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    if (sb) {
      await sb.from('monitoring_logs').insert({
        organization_id: organizationId,
        deal_id: dealId,
        source: 'supabase-edge',
        event: 'fastapi_fetch_failed',
        severity: 'high',
        engine_version: 'v2-python',
        payload: { error: String(err) },
      });
    }
    return json(502, { error: 'fastapi_unreachable', detail: String(err) });
  }
  const elapsedMs = performance.now() - t0;

  let pkg: any = null;
  try { pkg = await resp.json(); } catch { /* leave pkg null */ }

  if (!resp.ok) {
    if (sb) {
      await sb.from('monitoring_logs').insert({
        organization_id: organizationId,
        deal_id: dealId,
        source: 'supabase-edge',
        event: 'fastapi_error',
        severity: 'high',
        engine_version: 'v2-python',
        payload: { status: resp.status, body: pkg, elapsedMs },
      });
    }
    return json(resp.status, pkg ?? { error: 'fastapi_error' });
  }

  if (sb) {
    const hash = await sha256Hex(JSON.stringify(body));
    await sb.from('investor_package_snapshots').insert({
      organization_id: organizationId,
      deal_id: dealId,
      engine_version: 'v2-python',
      source: 'supabase-edge',
      input_hash: hash,
      body: pkg,
    });
    await sb.from('monitoring_logs').insert({
      organization_id: organizationId,
      deal_id: dealId,
      source: 'supabase-edge',
      event: 'investor_package_ok',
      severity: 'info',
      engine_version: 'v2-python',
      payload: { elapsedMs, hasInsights: Array.isArray(pkg?.insights) && pkg.insights.length > 0 },
    });
  }

  return json(200, {
    package: pkg,
    engineVersion: 'v2-python',
    flagState: decision,
  });
});
