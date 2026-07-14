import axios from 'axios';

const stripTrailingSlash = (value) => value.replace(/\/+$/, '');

const resolveApiUrl = () => {
  const configuredUrl = import.meta.env.VITE_API_URL?.trim();

  if (!configuredUrl) {
    return '/api';
  }

  const normalizedUrl = stripTrailingSlash(configuredUrl);
  return normalizedUrl.endsWith('/api') ? normalizedUrl : `${normalizedUrl}/api`;
};

const API_URL = resolveApiUrl();

// `withCredentials: true` is the linchpin of the cookie-based auth path:
// it tells fetch / XHR to include cookies on cross-origin requests AND
// honour Set-Cookie response headers. Backend CORS already advertises
// `credentials: true`, so this is the only client-side flip required.
const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

const isSessionBootstrapRequest = (config) => {
  const url = String(config?.url || '').toLowerCase();
  return url === '/auth/login'
    || url === '/auth/register'
    || url === '/auth/google'
    || url === '/auth/refresh'
    || url.endsWith('/auth/login')
    || url.endsWith('/auth/register')
    || url.endsWith('/auth/google')
    || url.endsWith('/auth/refresh');
};

// Request interceptor — the session travels in httpOnly cookies
// (`withCredentials` above), so no Authorization header is ever attached:
// the access token is not JS-readable by design. We only read the cached
// `user` to forward the active organization id.
api.interceptors.request.use((config) => {
  const rawUser = localStorage.getItem('user') || sessionStorage.getItem('user');
  const skipSessionHeaders = isSessionBootstrapRequest(config);
  let activeOrganizationId = null;

  try {
    const parsedUser = rawUser ? JSON.parse(rawUser) : null;
    activeOrganizationId = parsedUser?.organization_id || parsedUser?.default_organization_id || null;
  } catch {
    activeOrganizationId = null;
  }

  if (activeOrganizationId && !skipSessionHeaders && !config.headers['X-Organization-Id']) {
    config.headers['X-Organization-Id'] = activeOrganizationId;
  }
  return config;
});

// 401 interceptor with single-attempt refresh. On the first 401, post to
// /auth/refresh (which uses the path-scoped refresh cookie). If that
// succeeds, retry the original request once. If it fails — or the 401 came
// from the refresh endpoint itself — drop everything and bounce to login.
//
// `_retryAttempted` on the config is the recursion guard: a request that
// already retried once does not retry again (avoids loops on stuck 401s).
let refreshInFlight = null;

const performRefresh = async () => {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = api
    .post('/auth/refresh')
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
};

const clearLocalSession = () => {
  // Drop the cached user profile, and sweep any legacy access token left
  // over from a pre-cookie session so a stale identity cannot linger.
  localStorage.removeItem('user');
  sessionStorage.removeItem('user');
  localStorage.removeItem('token');
  sessionStorage.removeItem('token');
};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config || {};
    const status = error.response?.status;
    const isRefreshCall = String(original.url || '').endsWith('/auth/refresh');

    // 401 on /auth/refresh itself — the refresh cookie is gone or the
    // family was revoked. No point retrying; bounce to login.
    if (status === 401 && isRefreshCall) {
      clearLocalSession();
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
      return Promise.reject(error);
    }

    // Generic 401 — try one refresh, then replay the original request.
    if (status === 401 && !original._retryAttempted) {
      original._retryAttempted = true;
      try {
        await performRefresh();
        return api(original);
      } catch (refreshErr) {
        clearLocalSession();
        if (window.location.pathname !== '/login') {
          window.location.href = '/login';
        }
        return Promise.reject(refreshErr);
      }
    }

    return Promise.reject(error);
  }
);

// Auth
export const authAPI = {
  login: (data) => api.post('/auth/login', data),
  register: (data) => api.post('/auth/register', data),
  getMe: () => api.get('/auth/me'),
  updateMe: (data) => api.put('/auth/me', data),
  // Email verification — `confirm` is public (consumed before login on a fresh
  // browser); `request` and `status` require authentication so the dashboard
  // banner can poll and offer a "resend" action.
  verifyEmailRequest: () => api.post('/auth/verify-email/request'),
  verifyEmailConfirm: (token) => api.post('/auth/verify-email/confirm', { token }),
  verifyEmailStatus: () => api.get('/auth/verify-email/status'),
  // Federated identity — Google.
  // googleConfig is public (no auth) and tells the SPA whether to render the
  // Sign in with Google button + which client_id to initialise GIS with.
  googleConfig: () => api.get('/auth/google/config'),
  googleSignIn: (data) => api.post('/auth/google', data),
  // Cookie-based session lifecycle — refresh rotates both cookies; logout
  // revokes the refresh-token family and clears both cookies. Both are
  // safe to call without a current session (logout is idempotent;
  // refresh returns 401 and the interceptor falls through to /login).
  refresh: () => api.post('/auth/refresh'),
  logout: () => api.post('/auth/logout'),
  // For OAuth-only users (signed up via Google, never set a password) —
  // attaches a password to their existing account so they can sign in
  // with email + password too. The authenticated session itself is the
  // proof of possession; no Google re-verify step required.
  setFirstPassword: (data) => api.post('/auth/me/set-first-password', data),
  // DPDP §8(7) account closure. Sets account_closed_at, revokes all refresh
  // tokens, clears auth cookies. PII is anonymized 90 days later by the
  // retention sweep cron. Idempotent on repeat calls.
  closeAccount: () => api.post('/auth/me/close-account'),
  // MFA / TOTP — enrollment + verification + disable
  mfaBegin: () => api.post('/auth/me/mfa/begin'),
  mfaVerifyEnrollment: (code) => api.post('/auth/me/mfa/verify-enrollment', { code }),
  mfaDisable: () => api.post('/auth/me/mfa/disable'),
  // Login completion when /auth/login returned mfaRequired: true
  mfaVerify: (challenge, code) => api.post('/auth/mfa/verify', { challenge, code }),
};

// Legal — Terms / Privacy / Cookie / DPA / AUP versioned-documents registry.
// `getActive` is public (no auth); `me` and `accept` require authentication.
export const legalAPI = {
  getActive: () => api.get('/legal/active'),
  getDocument: (kind, version) => api.get(`/legal/${kind}/${version}`),
  myAcceptances: () => api.get('/legal/me'),
  recordAcceptance: (documentIds) => api.post('/legal/me/accept', { documentIds }),
};

// Consent — DPDP §6 granular per-purpose consent ledger.
// `get` returns { purposes, state, available, history }; `update` appends one
// or more decisions ({ purpose: boolean }) and returns the fresh state.
export const consentAPI = {
  get: () => api.get('/consent'),
  update: (decisions) => api.put('/consent', { decisions }),
};

// Privacy Centre — DSAR (DPDP §11). `overview` is the page read model;
// `exportData` returns the full machine-readable personal-data export.
// Password is re-verified server-side for password accounts.
export const privacyAPI = {
  overview: () => api.get('/privacy/overview'),
  exportData: (password) => api.post('/privacy/export', password ? { password } : {}),
};

// Organization-level settings — Workstream C2. The benchmark-contribution
// control: the org half of the Layer-4 anonymized-benchmark consent gate.
export const organizationAPI = {
  getBenchmarkSetting: () => api.get('/organization/benchmark-setting'),
  setBenchmarkSetting: (optedOut) =>
    api.put('/organization/benchmark-setting', { optedOut }),

  // Team & members
  listMembers: () => api.get('/organization/members'),
  invite: (email, role) => api.post('/organization/invitations', { email, role }),
  updateMemberRole: (userId, role) =>
    api.patch(`/organization/members/${userId}/role`, { role }),
  removeMember: (userId) =>
    api.delete(`/organization/members/${userId}`),

  // Pending join requests (domain auto-joins awaiting approval)
  listJoinRequests: () => api.get('/organization/join-requests'),
  approveJoinRequest: (userId) =>
    api.post(`/organization/join-requests/${userId}/approve`),
  rejectJoinRequest: (userId) =>
    api.post(`/organization/join-requests/${userId}/reject`),

  // Corporate-domain claims
  listDomains: () => api.get('/organization/domains'),
  addDomain: (domain) => api.post('/organization/domains', { domain }),
  verifyDomain: (domainId) => api.post(`/organization/domains/${domainId}/verify`),
  setDomainPolicy: (domainId, policy) =>
    api.patch(`/organization/domains/${domainId}`, policy),
  removeDomain: (domainId) => api.delete(`/organization/domains/${domainId}`),
};

// PR-C (2026-05-25) — Recommendation Engine verdicts.
// Captures the operator's dismiss / snooze / acted action on a card.
// The deal workspace re-load picks up the updated verdict and hides the
// card on subsequent renders.
export const recommendationsAPI = {
  postVerdict: (dealId, ruleId, payload) =>
    api.post(`/deals/${dealId}/recommendations/${ruleId}/verdict`, payload),
};

// P1-PR2 (2026-05-26) — Micro-Market Intelligence pre-deal-create endpoints.
// The per-deal briefing lives on the dealWorkspace endpoint as
// `workspace.micro_market`; these endpoints serve the surfaces that exist
// BEFORE a deal is created (admin tool, deal-create form pre-fill).
export const microMarketAPI = {
  list: () => api.get('/micro-market/list'),
  classify: ({ lat, lng }) => api.post('/micro-market/classify', { lat, lng }),
  defaults: (localityCode, assetClass) =>
    api.get('/micro-market/defaults', { params: { localityCode, assetClass } }),
};

// Deals
export const dealsAPI = {
  list: (params) => api.get('/deals', { params }),
  get: (id) => api.get(`/deals/${id}`),
  // Unified workspace read-model. Composes deal + financials + scenarios +
  // graph + DD/risk scores + audit events + documents + activities +
  // waterfall so the deal page loads from a single round-trip.
  // `options.lite` fetches the deterministic payload without the slow AI
  // narration — the deal page uses it for an instant first paint.
  getWorkspace: (id, options = {}) =>
    api.get(`/deals/${id}/workspace`, options.lite ? { params: { lite: true } } : undefined),
  // PR-NX50 (2026-05-19) — field-provenance map for inline ProvenanceChip
  // components. Returns `{ field_provenance: { <field>: {...} } }` listing
  // every deal/property field that was auto-applied via document_extraction
  // (PR-NX25 apply-extractions). Empty map when no auto-fill has happened.
  fieldProvenance: (id) => api.get(`/deals/${id}/field-provenance`),
  // PR-NX52 (2026-05-19) — live market-benchmark bands (sell-rate p25/p50/p75/p95
  // from verified nearby comps + RBI DSCR floor + YoC-vs-ExitCap spread
  // thresholds). Surfaces the SAME thresholds the XLSX-export market-benchmark
  // validators (PR-NX28/NX33) use, at INPUT TIME on FinancialsPage.
  benchmarkBands: (id) => api.get(`/deals/${id}/benchmark-bands`),
  create: (data) => api.post('/deals', data),
  update: (id, data) => api.put(`/deals/${id}`, data),
  archive: (id, reason) => api.patch(`/deals/${id}/archive`, { reason }),
  restore: (id) => api.patch(`/deals/${id}/restore`),
  delete: (id) => api.delete(`/deals/${id}`),
  transitionStage: (id, stage, notes) => api.patch(`/deals/${id}/stage`, { stage, notes }),
  // Bulk operations — multi-select on /dashboard/deals. Each request
  // accepts up to 50 ids; per-id failures come back in the response
  // payload (the HTTP call always succeeds when the body validates).
  bulkArchive: (ids, reason) => {
    const body = { ids };
    if (reason != null && reason !== '') body.reason = reason;
    return api.post('/deals/bulk/archive', body);
  },
  bulkReassign: (ids, assignedTo) =>
    api.post('/deals/bulk/reassign', { ids, assignedTo: assignedTo || null }),
  bulkTransitionStage: (ids, stage, notes) => {
    const body = { ids, stage };
    if (notes != null && notes !== '') body.notes = notes;
    return api.post('/deals/bulk/stage', body);
  },
  // Admin-only. Hard-deletes the supplied deals. Each deletion runs
  // through the standard `deleteDeal` path so storage cleanup + the
  // property cascade stay consistent.
  bulkDelete: (ids) => api.post('/deals/bulk/delete', { ids }),
  getPipeline: () => api.get('/deals/pipeline'),
  getSummary: () => api.get('/deals/summary'),
  // Sharing
  listShares: (id) => api.get(`/deals/${id}/shares`),
  shareDeal: (id, email, permission) => api.post(`/deals/${id}/shares`, { email, permission }),
  revokeShare: (id, userId) => api.delete(`/deals/${id}/shares/${userId}`),
  getSharedWithMe: () => api.get('/deals/shared-with-me'),
};

// Yield Studio — server-saved study (per deal) + uploaded parcel boundary
// (per property). Groups return the raw axios response; hooks unwrap
// `.then((r) => r.data.data)`, matching propertiesAPI.
export const yieldStudioAPI = {
  getStudy: (dealId) => api.get(`/deals/${dealId}/yield-study`),
  saveStudy: (dealId, body) => api.put(`/deals/${dealId}/yield-study`, body),
  deleteStudy: (dealId) => api.delete(`/deals/${dealId}/yield-study`),
  getBoundary: (propertyId) => api.get(`/properties/${propertyId}/boundary`),
  saveBoundary: (propertyId, body) => api.put(`/properties/${propertyId}/boundary`, body),
  deleteBoundary: (propertyId) => api.delete(`/properties/${propertyId}/boundary`),
};

// Deal Register — per-deal rent roll / sales & collections / hotel operating /
// occupant registers. Record mutations carry the kind in the path (record ids
// are per-table and can collide across kinds).
export const rentRollAPI = {
  get: (dealId) => api.get(`/deals/${dealId}/rent-roll`),
  saveSettings: (dealId, body) => api.put(`/deals/${dealId}/rent-roll`, body),
  createRecord: (dealId, body) => api.post(`/deals/${dealId}/rent-roll/records`, body),
  updateRecord: (dealId, kind, recordId, body) =>
    api.patch(`/deals/${dealId}/rent-roll/records/${kind}/${recordId}`, body),
  deleteRecord: (dealId, kind, recordId) =>
    api.delete(`/deals/${dealId}/rent-roll/records/${kind}/${recordId}`),
  bulkInsert: (dealId, body) => api.post(`/deals/${dealId}/rent-roll/records/bulk`, body),
  createSnapshot: (dealId, body) => api.post(`/deals/${dealId}/rent-roll/snapshots`, body),
  listSnapshots: (dealId) => api.get(`/deals/${dealId}/rent-roll/snapshots`),
};

// Properties
export const propertiesAPI = {
  list: (params) => api.get('/properties', { params }),
  get: (id) => api.get(`/properties/${id}`),
  create: (data) => api.post('/properties', data),
  update: (id, data) => api.put(`/properties/${id}`, data),
  delete: (id) => api.delete(`/properties/${id}`),
  geocode: (id) => api.post(`/properties/${id}/geocode`),
  bulkGeocode: () => api.post('/properties/bulk-geocode'),
  parcelIntelligence: (id) => api.get(`/properties/${id}/parcel-intelligence`),
  refreshParcelIntelligence: (id) => api.post(`/properties/${id}/parcel-intelligence/refresh`),
  parcelVerifications: (id) => api.get(`/properties/${id}/parcel-intelligence/verifications`),
  verifyParcelItem: (id, payload) => api.post(`/properties/${id}/parcel-intelligence/verify-item`, payload),
  unverifyParcelItem: (id, linkId) => api.delete(`/properties/${id}/parcel-intelligence/verifications/${linkId}`),
  // Auto-derive parcel context from either an address or (lat, lng).
  // Returns a single payload with coordinates, BBMP jurisdiction + ward,
  // BBMP zone + guidance value, planning district + demographics, K-GIS
  // hierarchy + survey numbers + geometry, applicable city-level callouts
  // (SDZ/heritage/NGT/PRR), and verify-link payloads.
  autoDeriveContext: ({ address, lat, lng } = {}) => {
    const params = {};
    if (address && String(address).trim()) params.address = String(address).trim();
    if (lat !== undefined && lat !== null && lat !== '') params.lat = lat;
    if (lng !== undefined && lng !== null && lng !== '') params.lng = lng;
    return api.get('/properties/auto-derive-context', { params });
  },
  // Persists the picks the user kept from the AutoFillParcelContextCard
  // to the auto_derived_* columns. Goes through a dedicated endpoint so
  // the audit trail is clean and the generic update path stays untouched.
  applyAutoDerivedContext: (id, { picks, derivedSource } = {}) =>
    api.patch(`/properties/${id}/apply-auto-derived-context`, {
      picks: picks || {},
      derivedSource: derivedSource || null,
    }),
  // Ward spread benchmark — percentile distribution of price-vs-guidance
  // spread across other deals in the same BBMP ward as this property.
  // Returns ok:false when ward isn't derived yet or sample < 3.
  wardSpreadBenchmark: (id) =>
    api.get(`/properties/${id}/ward-spread-benchmark`),
  // Smart Property Capture — turns any pasted input (Google Maps URL,
  // Plus Code, lat/lng, survey number, address, or broker narrative) into
  // a resolved candidate property with BBMP ward, K-GIS hierarchy,
  // guidance value, and verification links. Read-only (no DB write).
  // Frontend renders a preview and POSTs suggestedFields to /properties.
  capture: ({ input, aiAssisted = true } = {}) =>
    api.post('/properties/capture', { input, aiAssisted }),
};

// Financials
export const financialsAPI = {
  get: (dealId) => api.get(`/financials/${dealId}`),
  calculate: (dealId, data) => api.post(`/financials/${dealId}/calculate`, data),
  update: (dealId, data) => api.put(`/financials/${dealId}`, data),
  sensitivity: (dealId, data) => api.post(`/financials/${dealId}/sensitivity`, data),
  // PR-NX48 (2026-05-19) — live AI sensitivity narrative. Same OpenAI
  // synthesis (driver decomposition + recommended stress tests) that
  // ships in the DOCX Financials section (PR-NX44). Cascades OpenAI
  // → Claude → unavailable. Frontend FinancialsPage consumes via
  // useSensitivityNarrative.
  sensitivityNarrative: (dealId) => api.get(`/financials/${dealId}/sensitivity-narrative`),
  scenarios: (dealId) => api.get(`/financials/${dealId}/scenarios`),
  // Authoritative provenance DAG — every KPI/cost/revenue node traces back
  // to user inputs. Use for "how was this number produced" drill-downs.
  financialGraph: (dealId) => api.get(`/financials/${dealId}/financial-graph`),
  // Workstream A (Provenance Spine) — read-side model-confidence summary:
  // how many key inputs are set for THIS deal vs. on REDIP benchmark
  // defaults. Returns { available, dealSetCount, defaultCount, total,
  // confidencePct, band, inputs[] }. Never errors for a missing model.
  modelConfidence: (dealId) => api.get(`/financials/${dealId}/model-confidence`),
  // Immutable, HMAC-signed audit trail. `events` lists the most recent
  // calc/scenario/sensitivity runs; `verifyEvent` re-hashes stored JSON and
  // re-signs with the current key; `replayEvent` additionally re-runs the
  // kernel from the stored inputs so we can prove the pitch-deck number
  // came from this exact engine+input tuple.
  events: (dealId, limit = 50) => api.get(`/financials/${dealId}/events`, { params: { limit } }),
  verifyEvent: (dealId, eventId) => api.get(`/financials/${dealId}/events/${eventId}/verify`),
  replayEvent: (dealId, eventId) => api.post(`/financials/${dealId}/events/${eventId}/replay`),
  exportCSV: (dealId) => api.get(`/financials/${dealId}/export/csv`, { responseType: 'blob' }),
  // Pivot a single bulk_id back to every deal it touched. Powers the
  // AuditTab "view batch" peek so an analyst can see "this deal was
  // 1 of 12 moved in that one click".
  bulkBatch: (bulkId) => api.get(`/financials/audit/bulk/${bulkId}`),
  // Stateless kernel-first what-if runner. No DB touch; powers live sliders.
  quickCompute: (data) => api.post('/financials/quick-compute', data),
  // Single-source-of-truth defaults registry with provenance metadata.
  // Without assetClass → full registry; with assetClass → effective map
  // (globals ∪ asset overrides) for that class.
  defaults: (assetClass) => api.get(
    assetClass ? `/financials/defaults/${assetClass}` : '/financials/defaults'
  ),
};

// Waterfall (JDA / JV / debt schedule)
export const waterfallAPI = {
  saveJDA: (dealId, data) => api.post(`/waterfall/${dealId}/jda`, data),
  saveJV: (dealId, data) => api.post(`/waterfall/${dealId}/jv`, data),
  debtSchedule: (data) => api.post('/waterfall/debt-schedule', data),
  get: (dealId, kind) => api.get(`/waterfall/${dealId}`, { params: kind ? { kind } : {} }),
};

// Comps
export const compsAPI = {
  list: (params) => api.get('/comps', { params }),
  create: (data) => api.post('/comps', data),
  delete: (id) => api.delete(`/comps/${id}`),
  nearby: (params) => api.get('/comps/nearby', { params }),
  benchmarks: (params) => api.get('/comps/benchmarks', { params }),
};

// Documents
export const documentsAPI = {
  dealOptions: () => api.get('/documents/deals/options'),
  list: (dealId, category) => api.get(`/documents/${dealId}`, { params: { category } }),
  // Step 1: get presigned URL for direct-to-Supabase upload
  getUploadUrl: (dealId, fileName, fileSize) =>
    api.post(`/documents/${dealId}/upload-url`, { fileName, fileSize }),
  // Step 2: confirm upload after file is in Supabase
  confirmUpload: (dealId, data) =>
    api.post(`/documents/${dealId}/confirm-upload`, data),
  // Legacy: through-server upload (kept for fallback / small files)
  upload: (dealId, formData) => api.post(`/documents/${dealId}/upload`, formData, {
    headers: { 'Content-Type': undefined },
    timeout: 3 * 60 * 1000,
    maxContentLength: 55 * 1024 * 1024,
    maxBodyLength: 55 * 1024 * 1024,
  }),
  downloadMeta: (dealId, docId) => api.get(`/documents/${dealId}/download/${docId}`),
  download: (dealId, docId) => api.get(`/documents/${dealId}/download/${docId}/file`, {
    responseType: 'blob',
  }),
  delete: (dealId, docId) => api.delete(`/documents/${dealId}/${docId}`),
};

// Activities
export const activitiesAPI = {
  all: (params) => api.get('/activities', { params }),
  list: (dealId, params) => api.get(`/activities/${dealId}`, { params }),
  create: (dealId, data) => api.post('/activities', { ...data, dealId }),
  update: (activityId, data) => api.put(`/activities/entry/${activityId}`, data),
  updateStatus: (activityId, status) => api.patch(`/activities/entry/${activityId}/status`, { status }),
  delete: (activityId) => api.delete(`/activities/entry/${activityId}`),
  recent: (limit) => api.get('/activities/recent', { params: { limit } }),
  my: (limit) => api.get('/activities/my', { params: { limit } }),
};

// Dashboard
export const dashboardAPI = {
  getStats: () => api.get('/dashboard'),
  // Portfolio Risk Radar — workspace-level rollup of every live deal's
  // per-failure-mode posture. Backed by portfolioRiskRadar.service.js.
  portfolioRiskRadar: () => api.get('/dashboard/portfolio-risk-radar'),
  // Today's Attention — specific item-level signals (overdue DD,
  // expiring approvals, recent risk flags, stale deals, recent activity).
  // Pairs with the Portfolio Risk Radar's aggregate counts to answer
  // "what should I do today?".
  attention: () => api.get('/dashboard/attention'),
};

// SSE reader: opens a POST stream against the API, parses `data: {...}\n\n`
// frames, and dispatches each parsed event to the supplied handlers. axios
// doesn't expose ReadableStream cleanly in browsers; native fetch does.
//
// Returns `{ promise, abort }` where:
//   • promise resolves on the `done` event, rejects on `error`/network fail
//   • abort() cancels the underlying fetch — the backend's req.on('close')
//     hook then aborts the upstream Anthropic call (no wasted tokens).
//
// Usage:
//   const { promise, abort } = streamPost('/intelligence/deal-analysis/X/stream', {
//     onText: (delta) => setText((t) => t + delta),
//     onDone: (meta) => console.log('done', meta),
//   });
//   // user clicks Cancel → abort();
const streamPost = (path, { onText, onDone, body } = {}) => {
  const controller = new AbortController();
  const url = `${API_URL}${path}`;

  const promise = (async () => {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (!response.ok) {
      let message = `Stream failed: HTTP ${response.status}`;
      try {
        const json = await response.json();
        if (json?.message) message = json.message;
      } catch { /* response wasn't JSON — keep the HTTP-status message */ }
      throw new Error(message);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let lastDone = null;

    // SSE frames are separated by a blank line (`\n\n`). We accumulate raw
    // bytes in `buffer`, split on `\n\n`, parse each frame's `data:` payload
    // as JSON, and dispatch.
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const rawFrame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLine = rawFrame.split('\n').find((line) => line.startsWith('data:'));
        if (!dataLine) continue;
        const payloadStr = dataLine.slice(5).trim();
        if (!payloadStr) continue;
        let payload;
        try {
          payload = JSON.parse(payloadStr);
        } catch {
          continue; // ignore malformed frame; keep streaming
        }
        if (payload?.type === 'text' && typeof payload.text === 'string') {
          onText?.(payload.text);
        } else if (payload?.type === 'done') {
          lastDone = payload;
          onDone?.(payload);
        } else if (payload?.type === 'error') {
          throw new Error(payload.message || 'Stream error');
        }
      }
    }
    return lastDone;
  })();

  return {
    promise,
    abort: () => controller.abort(),
  };
};

// Semantic search over indexed document chunks (pgvector). Org-scoped
// via RLS. Returns ranked { chunk_text, document_id, page_number,
// similarity } rows.
export const searchAPI = {
  semantic: ({ q, documentId, kind, k = 8 } = {}) =>
    api.get('/search/semantic', { params: { q, documentId, kind, k } }),
  reindex: (documentId) => api.post(`/search/reindex/${documentId}`),
};

// Intelligence
export const intelligenceAPI = {
  getDailyBrief:            (date)   => api.get('/intelligence/daily-brief', { params: { date } }),
  getMarketNotes:           ()       => api.get('/intelligence/market-notes'),
  saveMarketNotes:          (section, items) => api.put('/intelligence/market-notes', { section, items }),
  getMarketTransactions:    (params) => api.get('/intelligence/market-transactions', { params }),
  getMicroMarketBenchmarks: (params) => api.get('/intelligence/micro-market-benchmarks', { params }),
  getOfficeBenchmarks:      (params) => api.get('/intelligence/office-benchmarks', { params }),
  getRetailBenchmarks:      (params) => api.get('/intelligence/retail-benchmarks', { params }),
  getIndustrialBenchmarks:  (params) => api.get('/intelligence/industrial-benchmarks', { params }),
  getHospitalityBenchmarks: (params) => api.get('/intelligence/hospitality-benchmarks', { params }),
  getResidentialSegmentedBenchmarks: (params) => api.get('/intelligence/residential-segmented-benchmarks', { params }),
  getNicheAssetClassBenchmarks: (params) => api.get('/intelligence/niche-asset-class-benchmarks', { params }),
  getMacroKpis:             (params) => api.get('/intelligence/macro-kpis', { params }),
  getDealAnalysis:          (dealId) => api.post(`/intelligence/deal-analysis/${dealId}`),
  // Last persisted analysis (or null on miss). Used by OverviewTab on
  // mount so users see the last generated memo without re-running Claude.
  getCachedDealAnalysis:    (dealId) => api.get(`/intelligence/deal-analysis/${dealId}/cached`),
  // Streaming variant — perceived latency drops from ~30s wait to <1s first
  // paint. Returns { promise, abort }; consumer wires onText into local state.
  streamDealAnalysis: (dealId, { onText, onDone } = {}) =>
    streamPost(`/intelligence/deal-analysis/${dealId}/stream`, { onText, onDone }),
  // ── IC Memo (Tier-2 #13) — same trio as deal-analysis ──────────────────
  getIcMemo:                (dealId) => api.post(`/intelligence/ic-memo/${dealId}`),
  getCachedIcMemo:          (dealId) => api.get(`/intelligence/ic-memo/${dealId}/cached`),
  streamIcMemo: (dealId, { onText, onDone } = {}) =>
    streamPost(`/intelligence/ic-memo/${dealId}/stream`, { onText, onDone }),
  // Workstream A (Provenance Spine) — the deterministic evidence ledger
  // beneath the IC memo: every material number with its typed, traceable
  // source. Returns { available, groups[], summary }.
  getIcMemoEvidence:        (dealId) => api.get(`/intelligence/ic-memo/${dealId}/evidence`),
};

// Exports
export const exportsAPI = {
  // Verified-comps CSV. Filter passthrough mirrors GET /comps so the
  // download respects whatever filters the analyst applied on the
  // Comps page.
  comps: (params = {}) => api.get('/exports/comps', { params, responseType: 'blob' }),
  dealXlsx: (dealId) => api.get(`/exports/deals/${dealId}/xlsx`, { responseType: 'blob' }),
  dealPdf: (dealId) => api.get(`/exports/deals/${dealId}/pdf`, { responseType: 'blob' }),
  dealPptx: (dealId) => api.get(`/exports/deals/${dealId}/pptx`, { responseType: 'blob' }),
  // PR-NX39 (2026-05-17): institutional-grade DOCX underwriting report
  // (22 sections, ~PR-NX35/NX36/NX37). Gated server-side behind
  // `DOCX_REPORT_ENABLED=1` (flipped in production 2026-05-17). Admins
  // bypass the gate regardless.
  dealDocx: (dealId) => api.get(`/exports/deals/${dealId}/docx`, { responseType: 'blob' }),
  // Phase 3 / Pillar 4 — K-RERA Readiness Pack as a focused DOCX the operator
  // hands to their CA / architect / lawyer. Organisation aid only — server-
  // side disclaimer surfaced on every page.
  dealReraReadinessDocx: (dealId) =>
    api.get(`/exports/deals/${dealId}/rera-readiness/docx`, { responseType: 'blob' }),
  // Phase 3 / Pillar 5 — IC Readiness Pack DOCX for the deal team's pre-IC
  // handoff. Same organisation-aid posture; disclaimer on every page.
  dealIcReadinessDocx: (dealId) =>
    api.get(`/exports/deals/${dealId}/ic-readiness/docx`, { responseType: 'blob' }),

  // Audience-tailored report packs (lender / investor / buyer) — one
  // parameterized endpoint, validated server-side against the report-pack
  // catalog. Each reframes the same deterministic deal data for its reader.
  dealPack: (dealId, audience) =>
    api.get(`/exports/deals/${dealId}/pack/${audience}/docx`, { responseType: 'blob' }),
  dealsXlsx: (params) => api.get('/exports/deals/xlsx', { params, responseType: 'blob' }),
  // CSV export of the deals list. Accepts the same filter query params
  // as `dealsAPI.list` so the export respects the page's current filter
  // combination — saved view → click Export → file matches what's on
  // screen. Always-on visibility scope rules are enforced server-side.
  dealsCsv: (params) => api.get('/exports/deals/csv', { params, responseType: 'blob' }),
  intelligenceTearSheet: (params) =>
    api.get('/exports/intelligence/tear-sheet', { params, responseType: 'blob' }),
};

// Tier-2 #11 — Deal Q&A agent.
// Single-shot Q&A on a specific deal. Backend retrieves relevant document
// chunks via pgvector, runs Claude with mandatory-citation contract,
// persists to deal_qa_history. Returns the new history row.
//
// `stream` opens an SSE connection so the answer paints token-by-token
// instead of blocking on the full ~6-15s round-trip. The streamed bytes
// are raw JSON deltas (the model is contracted to return the strict
// { answer, citations[] } shape); the consumer should accumulate the
// `text` deltas and rely on the final `done` frame for the persisted
// row + hydrated citations. Returns { promise, abort }.
export const dealQaAPI = {
  ask:        (dealId, question)   => api.post(`/deals/${dealId}/qa`, { question }),
  stream:     (dealId, question, { onText, onDone } = {}) =>
                streamPost(`/deals/${dealId}/qa/stream`, { onText, onDone, body: { question } }),
  history:    (dealId, limit = 10) => api.get(`/deals/${dealId}/qa/history`, { params: { limit } }),
  deleteRow:  (dealId, rowId)      => api.delete(`/deals/${dealId}/qa/${rowId}`),
};

// DD Items
export const ddAPI = {
  list:         (dealId)           => api.get(`/deals/${dealId}/dd`),
  create:       (dealId, data)     => api.post(`/deals/${dealId}/dd`, data),
  update:       (dealId, id, data) => api.put(`/deals/${dealId}/dd/${id}`, data),
  updateStatus: (dealId, id, status) => api.patch(`/deals/${dealId}/dd/${id}/status`, { status }),
  delete:       (dealId, id)       => api.delete(`/deals/${dealId}/dd/${id}`),
  seed:         (dealId)           => api.post(`/deals/${dealId}/dd/seed`),
  score:        (dealId)           => api.get(`/deals/${dealId}/dd/score`),
};

// Approval Items
export const approvalsAPI = {
  list:   (dealId)           => api.get(`/deals/${dealId}/approvals`),
  create: (dealId, data)     => api.post(`/deals/${dealId}/approvals`, data),
  update: (dealId, id, data) => api.put(`/deals/${dealId}/approvals/${id}`, data),
  delete: (dealId, id)       => api.delete(`/deals/${dealId}/approvals/${id}`),
  seed:   (dealId)           => api.post(`/deals/${dealId}/approvals/seed`),
};

// Professional Sign-offs — the advocate / CA / architect / engineer /
// structural engineer / banker certificate board. A SIGNED sign-off marks its
// matching K-RERA cockpit item verified (server-side, deterministic).
export const signoffsAPI = {
  list:   (dealId)           => api.get(`/deals/${dealId}/signoffs`),
  create: (dealId, data)     => api.post(`/deals/${dealId}/signoffs`, data),
  update: (dealId, id, data) => api.put(`/deals/${dealId}/signoffs/${id}`, data),
  delete: (dealId, id)       => api.delete(`/deals/${dealId}/signoffs/${id}`),
  seed:   (dealId)           => api.post(`/deals/${dealId}/signoffs/seed`),
};

// Risk Flags
export const riskAPI = {
  list:   (dealId)           => api.get(`/deals/${dealId}/risk`),
  create: (dealId, data)     => api.post(`/deals/${dealId}/risk`, data),
  update: (dealId, id, data) => api.put(`/deals/${dealId}/risk/${id}`, data),
  delete: (dealId, id)       => api.delete(`/deals/${dealId}/risk/${id}`),
  score:  (dealId)           => api.get(`/deals/${dealId}/risk/score`),
  // Workstream B — the Deal Risk Radar: a deterministic per-failure-mode
  // pre-mortem (posture cleared / not-verified / flagged).
  radar:  (dealId)           => api.get(`/deals/${dealId}/risk/radar`),
  // Tier-1 #4 — cross-document inconsistency detector. Runs deterministic
  // comparators across the deal's Gemini extractions, persists findings
  // as risk_flags with source='ai_detector', and synthesises a risk_brief
  // narrative via Claude.
  runInconsistencyCheck: (dealId) => api.post(`/deals/${dealId}/risk/ai/inconsistency-check`),
  getRiskBrief:          (dealId) => api.get(`/deals/${dealId}/risk/ai/brief`),
  // PR-NX47 (2026-05-19) — live AI risk narrative. Returns the same
  // 2-paragraph Claude synthesis (summary + critical-spotlight) that
  // ships in the DOCX Risk Register section (PR-NX43). Cascades Claude
  // → OpenAI → unavailable. Frontend RiskTab consumes via useRiskNarrative.
  narrative:             (dealId) => api.get(`/deals/${dealId}/risk-narrative`),
};

// Promoter / builder track record (B4). `get` returns { profile, assessment, rera };
// `upsert` is a full-document save of the promoter profile. `linkRera` and
// `unlinkRera` (Phase 1 / Pillar 6) confirm or clear the K-RERA cross-link —
// the analyst-recorded findings stay sovereign; the link only cross-references
// the public K-RERA index alongside.
export const promoterAPI = {
  get:        (dealId)        => api.get(`/deals/${dealId}/promoter`),
  upsert:     (dealId, data)  => api.put(`/deals/${dealId}/promoter`, data),
  linkRera:   (dealId, data)  => api.post(`/deals/${dealId}/promoter/link-rera`, data),
  unlinkRera: (dealId)        => api.delete(`/deals/${dealId}/promoter/link-rera`),
};

// Best Use Simulator (Phase 2 / Pillar 2). Deal-INDEPENDENT — per-deal scores
// already ride on the deal workspace payload as `workspace.best_use`. This
// surface is for parcel-first sourcing where coordinates are known before a
// deal exists (e.g. "is this site worth pursuing?" pre-flight).
export const bestUseAPI = {
  simulate: (lat, lng) => api.post('/best-use/simulate', { lat, lng }),
};

// Master Plan (regulatory zones)
export const masterPlanAPI = {
  coverage:     ()                    => api.get('/master-plan/coverage'),
  listZones:    (params)              => api.get('/master-plan/zones', { params }),
  getZone:      (id, params)          => api.get(`/master-plan/zones/${id}`, { params }),
  getVersions:  (id)                  => api.get(`/master-plan/zones/${id}/versions`),
  createZone:   (data)                => api.post('/master-plan/zones', data),
  updateZone:   (id, data)            => api.put(`/master-plan/zones/${id}`, data),
  reviewZone:   (id, data)            => api.put(`/master-plan/zones/${id}/review`, data),
  assignZoneToProperty: (id, data)     => api.post(`/master-plan/zones/${id}/assign-property`, data),
  listDocs:     (params)              => api.get('/master-plan/documents', { params }),
  getDocUploadUrl: (fileName, fileSize) => api.post('/master-plan/documents/upload-url', { fileName, fileSize }),
  confirmDocUpload: (data)             => api.post('/master-plan/documents/confirm-upload', data),
  updateDocMetadata: (id, data)         => api.put(`/master-plan/documents/${id}/metadata`, data),
  getDocVersions: (id)                  => api.get(`/master-plan/documents/${id}/versions`),
  getDocPages:    (id)                  => api.get(`/master-plan/documents/${id}/pages`),
  prepareDocPages: (id, data)            => api.post(`/master-plan/documents/${id}/pages/prepare`, data),
  downloadDoc:  (id)                   => api.get(`/master-plan/documents/${id}/download`),
  extractDoc:   (id, data)             => api.post(`/master-plan/documents/${id}/extract`, data),
  extractDocsBatch: (ids)              => api.post('/master-plan/documents/extract-batch', { ids }),
  listBbmpUav:  (params)               => api.get('/master-plan/bbmp-uav', { params }),
  listCorpus:   (params)               => api.get('/master-plan/corpus', { params }),
  importZonesGeoJSON: (data)            => api.post('/master-plan/zones/import-geojson', data),
  landUseIntelligence: ()              => api.get('/master-plan/intelligence/land-use'),
  districtIntelligence: ()             => api.get('/master-plan/intelligence/districts'),
  sourceExplorer: ()                   => api.get('/master-plan/intelligence/sources'),
  reviewQueue: ()                      => api.get('/master-plan/intelligence/review-queue'),
  uavBenchmark: (params)               => api.get('/master-plan/intelligence/uav-benchmark', { params }),
  streetLookup: (params)               => api.get('/master-plan/intelligence/street-lookup', { params }),
  wardSummary: ()                      => api.get('/master-plan/intelligence/ward-summary'),
  // Keep both export names — `streetLookup` was added in PR #350; this
  // alias is for any consumer that imports the same call by a clearer name.
};

// Parcel Intelligence admin / evidence operations
export const parcelIntelligenceAdminAPI = {
  status:      ()                    => api.get('/parcel-intelligence/status'),
  reviewQueue: (params)              => api.get('/parcel-intelligence/review-queue', { params }),
  reviewItem:  (type, id, data)      => api.put(`/parcel-intelligence/review-queue/${type}/${id}`, data),
  reviewItems: (data)                => api.put('/parcel-intelligence/review-queue/batch', data),
  createAuthorityInput: (data)        => api.post('/parcel-intelligence/authority-inputs', data),
  promoteEvidenceFact: (id, data)    => api.post(`/parcel-intelligence/review-queue/evidence_fact/${id}/promote-property`, data),
  promoteEvidenceFacts: (data)       => api.post('/parcel-intelligence/review-queue/evidence_fact/promote-property/batch', data),
};

// Polymorphic evidence-link primitive
// Mirrors backend/src/routes/evidenceLinks.routes.js
export const evidenceLinksAPI = {
  list:   (ownerKind, ownerId)     => api.get(`/evidence-links/${ownerKind}/${ownerId}`),
  attach: (ownerKind, ownerId, body) => api.post(`/evidence-links/${ownerKind}/${ownerId}`, body),
  detach: (linkId)                 => api.delete(`/evidence-links/${linkId}`),
  // E2-PR1 (2026-05-27) — reverse traversal: "what depends on this
  // document / regulatory source / fact?" Returns { owners, grouped,
  // supported, note }. Used by the DependentsPopover on document /
  // evidence-source surfaces.
  dependents: (sourceKind, sourceId) =>
    api.get(`/evidence-links/dependents/${sourceKind}/${sourceId}`),
};

// Comp similarity scoring (subject deal vs comp)
export const compSimilarityAPI = {
  ranked: (dealId, params) => api.get(`/comps/ranked/${dealId}`, { params }),
  score:  (dealId, compId) => api.get(`/comps/score/${dealId}/${compId}`),
  // Workstream C1 — which comps the analyst relies on for this deal.
  // `reliance` returns { comp_ids: [...] }; `setReliance` toggles one comp
  // and appends a values-free learning signal.
  reliance:    (dealId)               => api.get(`/comps/${dealId}/reliance`),
  setReliance: (dealId, compId, body) => api.put(`/comps/${dealId}/reliance/${compId}`, body),
};

// Comps Review Queue (Tier-0 ingestion flywheel)
// Mirrors backend/src/routes/compsReviewQueue.routes.js
export const compsReviewQueueAPI = {
  list:           (params)                    => api.get('/comps-review-queue', { params }),
  get:            (id)                        => api.get(`/comps-review-queue/${id}`),
  // Stream the row's source document through the guarded backend proxy
  // (nosniff + Content-Disposition: attachment, SSRF allow-listed). Returns
  // a blob the caller saves via downloadAxiosResponse — the raw cross-origin
  // storage URL is never sent to the browser, never embedded in <iframe>/<img>.
  downloadRawDoc: (id)                        => api.get(`/comps-review-queue/${id}/raw-doc/file`, { responseType: 'blob' }),
  process:        (id)                        => api.post(`/comps-review-queue/${id}/process`),
  // Manual batch trigger — runs extraction on the entire pending_extraction
  // backlog. Surfaced as the "Process pending now" button on the queue list
  // because Vercel Hobby caps the cron at once-daily.
  processPending: (limit = 25)                => api.post('/comps-review-queue/process-pending', null, { params: { limit } }),
  // Analyst-driven upload — multipart/form-data with a `file` field plus
  // optional sender/subject/notes. Used while waiting on a custom domain
  // for Postmark or whenever the analyst already has the source PDF.
  manualUpload: (file, metadata = {}) => {
    const fd = new FormData();
    fd.append('file', file);
    if (metadata.sender)  fd.append('sender',  metadata.sender);
    if (metadata.subject) fd.append('subject', metadata.subject);
    if (metadata.notes)   fd.append('notes',   metadata.notes);
    return api.post('/comps-review-queue/manual-upload', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  // Send only the fields the reviewer actually populated. The backend
  // tolerates null (since 2026-05-08 fix), but a clean body avoids
  // future express-validator regressions and reads better in network tab.
  edit: (id, payload, notes) => {
    const body = {};
    if (payload != null) body.payload = payload;
    if (notes != null && notes !== '') body.notes = notes;
    return api.patch(`/comps-review-queue/${id}`, body);
  },
  approve: (id) => api.post(`/comps-review-queue/${id}/approve`),
  reject:  (id, reason) => {
    const body = {};
    if (reason != null && reason !== '') body.reason = reason;
    return api.post(`/comps-review-queue/${id}/reject`, body);
  },
  // Bulk operations — multi-select on the queue page. Each request accepts
  // up to 50 ids; per-id failures come back in the response payload (the
  // HTTP call itself always succeeds when the body validates). Reject
  // optionally accepts a single shared `reason` applied to every row.
  bulkApprove: (ids) => api.post('/comps-review-queue/bulk/approve', { ids }),
  bulkReject:  (ids, reason) => {
    const body = { ids };
    if (reason != null && reason !== '') body.reason = reason;
    return api.post('/comps-review-queue/bulk/reject', body);
  },
  // assignedTo: UUID of the new assignee, or null to clear assignment.
  // Returns 503 with operator instructions if the assignment migration
  // (database/migrations/20260520_comps_queue_assignment.sql) hasn't
  // been applied yet — the toast will tell the operator what to do.
  bulkReassign: (ids, assignedTo) =>
    api.post('/comps-review-queue/bulk/reassign', { ids, assignedTo: assignedTo || null }),
  // CSV export of the queue. Accepts the same filter params as the
  // list endpoint — status / source / assignedToMe — so the export
  // matches whatever the queue page currently shows.
  exportCsv: (params) =>
    api.get('/comps-review-queue/export.csv', { params, responseType: 'blob' }),
};

// Admin / operator endpoints. Mounted at /api/admin on the backend.
// All routes here require admin or analyst role.
export const adminAPI = {
  // Org-scoped list of active users — backs the user-picker on the
  // Comps Queue's bulk-reassign modal and any future "assign to" UI.
  listUsers: () => api.get('/admin/users'),
  // AI usage dashboard. Returns { summary, daily[], by_task_provider[],
  // by_doctype[], top_cost_calls[], generated_at }. Window is configurable
  // via ?days= (default 30, max 365).
  getAiUsage: (days = 30) => api.get('/admin/ai-usage', { params: { days } }),
  // Extraction-accuracy from real human corrections (Phase 5.2 — learning loop).
  // Returns { available, window_days, overall, by_field, generated_at }.
  getExtractionQuality: (days = 90) =>
    api.get('/admin/extraction-quality', { params: { days } }),
  // Recent audit events (deal_events) across the org — backs the
  // dashboard's Audit-trail-tail widget. Default 10, max 50.
  getRecentEvents: (limit = 10) => api.get('/admin/recent-events', { params: { limit } }),
  // A/B eval harness (Tier 2 #14) — admin-only.
  // listAbEvalRuns: newest-first index of past runs. Each row carries the
  // per-candidate summary so the index can show winner/loser deltas.
  // getAbEvalRun: single run with per-fixture detail rows attached.
  // runAbEval: triggers a new evaluation; sync, blocks until complete.
  listAbEvalRuns: (limit = 50) => api.get('/admin/ab-eval/runs', { params: { limit } }),
  getAbEvalRun: (id) => api.get(`/admin/ab-eval/runs/${id}`),
  runAbEval: (body) => api.post('/admin/ab-eval/runs', body),
  // Workstream C3 — the standing quality monitor. `getAbEvalQualityTrend`
  // is the trend read-model; `runAbEvalBaseline` scores the current
  // production config against the fixtures and feeds the trend.
  getAbEvalQualityTrend: (days = 90) =>
    api.get('/admin/ab-eval/quality-trend', { params: { days } }),
  runAbEvalBaseline: (body) => api.post('/admin/ab-eval/baseline', body),
  // E7-PR1 (2026-05-27) — learning-loop telemetry dashboard. Returns
  // { window_days, summary, top_dismissed[], top_acted[],
  //   active_adjustments: {window_days, adjustments[], adjusted_rule_count},
  //   daily_series[], generated_at }. Mirrors what the consumer-side
  // aggregator (PR #618) uses to re-rank recommendation cards.
  getLearningSignals: (days = 30) =>
    api.get('/admin/learning-signals', { params: { days } }),
  // E7-PR2 (2026-05-27) — audit-trail tail with filters. Returns
  // { events[], event_type_catalog[], window_days, limit, filter }.
  // Filters: days (1-365), eventType (string), dealId (UUID), limit (1-200).
  getAuditTrail: (params = {}) =>
    api.get('/admin/audit-trail', { params }),
};

// Deal events — investor-grade audit trail backed by the `deal_events`
// table (HMAC-signed, append-only via RLS). The Audit tab on the deal
// detail page renders a timeline; ?include_outputs_summary=true returns
// a curated KPI projection so the UI can compute deltas without N+1.
export const dealEventsAPI = {
  list:    (dealId, params)            => api.get(`/financials/${dealId}/events`, { params }),
  verify:  (dealId, eventId)           => api.get(`/financials/${dealId}/events/${eventId}/verify`),
  replay:  (dealId, eventId)           => api.post(`/financials/${dealId}/events/${eventId}/replay`),
};

// Document Extraction
export const extractionAPI = {
  extract:          (documentId, data)                            => api.post(`/documents/${documentId}/extract`, data),
  getResult:        (documentId)                                  => api.get(`/documents/${documentId}/extraction`),
  listForDeal:      (dealId)                                      => api.get(`/deals/${dealId}/extractions`),
  applyCorrections: (documentId, extractionId, corrections)       => api.put(`/documents/${documentId}/extraction/${extractionId}/corrections`, { corrections }),
  // PR-NX49 (2026-05-19) — live AI cross-document insights. Returns
  // Claude-synthesized summary + 0-5 inconsistency findings. Same
  // service that powers the DOCX Document-Derived Insights section
  // (PR-NX45). Cascades Claude → OpenAI → unavailable.
  documentInsights: (dealId)                                      => api.get(`/deals/${dealId}/document-insights`),
  // PR-NX26 (2026-05-17): apply operator-approved extractions to the
  // deal + linked property. Backend validates each canonical_field
  // against the ontology, batches deal-level + property-level writes
  // into a single transaction, and returns { applied[], skipped[], deal,
  // property, audit_log_id_deal, audit_log_id_property }.
  applyToDeal:      (dealId, approved)                            => api.post(`/deals/${dealId}/apply-extractions`, { approved }),
};

export default api;
