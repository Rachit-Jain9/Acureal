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

const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
});

const isSessionBootstrapRequest = (config) => {
  const url = String(config?.url || '').toLowerCase();
  return url === '/auth/login'
    || url === '/auth/register'
    || url.endsWith('/auth/login')
    || url.endsWith('/auth/register');
};

// Attach JWT token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token') || sessionStorage.getItem('token');
  const rawUser = localStorage.getItem('user') || sessionStorage.getItem('user');
  const skipSessionHeaders = isSessionBootstrapRequest(config);
  let activeOrganizationId = null;

  try {
    const parsedUser = rawUser ? JSON.parse(rawUser) : null;
    activeOrganizationId = parsedUser?.organization_id || parsedUser?.default_organization_id || null;
  } catch {
    activeOrganizationId = null;
  }

  if (token && !skipSessionHeaders) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (activeOrganizationId && !skipSessionHeaders && !config.headers['X-Organization-Id']) {
    config.headers['X-Organization-Id'] = activeOrganizationId;
  }
  return config;
});

// Handle 401 responses
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('user');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
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
};

// Deals
export const dealsAPI = {
  list: (params) => api.get('/deals', { params }),
  get: (id) => api.get(`/deals/${id}`),
  // Unified workspace read-model. Composes deal + financials + scenarios +
  // graph + DD/risk scores + audit events + documents + activities +
  // waterfall so the deal page loads from a single round-trip.
  getWorkspace: (id) => api.get(`/deals/${id}/workspace`),
  create: (data) => api.post('/deals', data),
  update: (id, data) => api.put(`/deals/${id}`, data),
  archive: (id, reason) => api.patch(`/deals/${id}/archive`, { reason }),
  restore: (id) => api.patch(`/deals/${id}/restore`),
  delete: (id) => api.delete(`/deals/${id}`),
  transitionStage: (id, stage, notes) => api.patch(`/deals/${id}/stage`, { stage, notes }),
  getPipeline: () => api.get('/deals/pipeline'),
  getSummary: () => api.get('/deals/summary'),
  // Sharing
  listShares: (id) => api.get(`/deals/${id}/shares`),
  shareDeal: (id, email, permission) => api.post(`/deals/${id}/shares`, { email, permission }),
  revokeShare: (id, userId) => api.delete(`/deals/${id}/shares/${userId}`),
  getSharedWithMe: () => api.get('/deals/shared-with-me'),
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
  parcelNarrative: (id, payload) => api.post(`/properties/${id}/parcel-intelligence/narrative`, payload || {}),
  parcelVerifications: (id) => api.get(`/properties/${id}/parcel-intelligence/verifications`),
  verifyParcelItem: (id, payload) => api.post(`/properties/${id}/parcel-intelligence/verify-item`, payload),
  unverifyParcelItem: (id, linkId) => api.delete(`/properties/${id}/parcel-intelligence/verifications/${linkId}`),
};

// Financials
export const financialsAPI = {
  get: (dealId) => api.get(`/financials/${dealId}`),
  calculate: (dealId, data) => api.post(`/financials/${dealId}/calculate`, data),
  update: (dealId, data) => api.put(`/financials/${dealId}`, data),
  sensitivity: (dealId, data) => api.post(`/financials/${dealId}/sensitivity`, data),
  scenarios: (dealId) => api.get(`/financials/${dealId}/scenarios`),
  // Authoritative provenance DAG — every KPI/cost/revenue node traces back
  // to user inputs. Use for "how was this number produced" drill-downs.
  financialGraph: (dealId) => api.get(`/financials/${dealId}/financial-graph`),
  // Immutable, HMAC-signed audit trail. `events` lists the most recent
  // calc/scenario/sensitivity runs; `verifyEvent` re-hashes stored JSON and
  // re-signs with the current key; `replayEvent` additionally re-runs the
  // kernel from the stored inputs so we can prove the pitch-deck number
  // came from this exact engine+input tuple.
  events: (dealId, limit = 50) => api.get(`/financials/${dealId}/events`, { params: { limit } }),
  verifyEvent: (dealId, eventId) => api.get(`/financials/${dealId}/events/${eventId}/verify`),
  replayEvent: (dealId, eventId) => api.post(`/financials/${dealId}/events/${eventId}/replay`),
  exportCSV: (dealId) => api.get(`/financials/${dealId}/export/csv`, { responseType: 'blob' }),
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
};

// Intelligence
export const intelligenceAPI = {
  getDailyBrief:            (date)   => api.get('/intelligence/daily-brief', { params: { date } }),
  getMarketNotes:           ()       => api.get('/intelligence/market-notes'),
  saveMarketNotes:          (section, items) => api.put('/intelligence/market-notes', { section, items }),
  getMarketTransactions:    (params) => api.get('/intelligence/market-transactions', { params }),
  getMicroMarketBenchmarks: (params) => api.get('/intelligence/micro-market-benchmarks', { params }),
  getDealAnalysis:          (dealId) => api.post(`/intelligence/deal-analysis/${dealId}`),
};

// Exports
export const exportsAPI = {
  comps: () => api.get('/exports/comps', { responseType: 'blob' }),
  dealXlsx: (dealId) => api.get(`/exports/deals/${dealId}/xlsx`, { responseType: 'blob' }),
  dealPdf: (dealId) => api.get(`/exports/deals/${dealId}/pdf`, { responseType: 'blob' }),
  dealPptx: (dealId) => api.get(`/exports/deals/${dealId}/pptx`, { responseType: 'blob' }),
  dealsXlsx: (params) => api.get('/exports/deals/xlsx', { params, responseType: 'blob' }),
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

// Risk Flags
export const riskAPI = {
  list:   (dealId)           => api.get(`/deals/${dealId}/risk`),
  create: (dealId, data)     => api.post(`/deals/${dealId}/risk`, data),
  update: (dealId, id, data) => api.put(`/deals/${dealId}/risk/${id}`, data),
  delete: (dealId, id)       => api.delete(`/deals/${dealId}/risk/${id}`),
  score:  (dealId)           => api.get(`/deals/${dealId}/risk/score`),
};

// Master Plan (regulatory zones)
export const masterPlanAPI = {
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
};

// Comp similarity scoring (subject deal vs comp)
export const compSimilarityAPI = {
  ranked: (dealId, params) => api.get(`/comps/ranked/${dealId}`, { params }),
  score:  (dealId, compId) => api.get(`/comps/score/${dealId}/${compId}`),
};

// Document Extraction
export const extractionAPI = {
  extract:          (documentId, data)                            => api.post(`/documents/${documentId}/extract`, data),
  getResult:        (documentId)                                  => api.get(`/documents/${documentId}/extraction`),
  listForDeal:      (dealId)                                      => api.get(`/deals/${dealId}/extractions`),
  applyCorrections: (documentId, extractionId, corrections)       => api.put(`/documents/${documentId}/extraction/${extractionId}/corrections`, { corrections }),
};

export default api;
