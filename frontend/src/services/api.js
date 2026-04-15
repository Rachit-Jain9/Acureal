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

// Attach JWT token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token') || sessionStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
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
  listUsers: () => api.get('/auth/users'),
  toggleUserStatus: (id, isActive) => api.patch(`/auth/users/${id}/status`, { isActive }),
};

// Deals
export const dealsAPI = {
  list: (params) => api.get('/deals', { params }),
  get: (id) => api.get(`/deals/${id}`),
  create: (data) => api.post('/deals', data),
  update: (id, data) => api.put(`/deals/${id}`, data),
  archive: (id, reason) => api.patch(`/deals/${id}/archive`, { reason }),
  restore: (id) => api.patch(`/deals/${id}/restore`),
  delete: (id) => api.delete(`/deals/${id}`),
  transitionStage: (id, stage, notes) => api.patch(`/deals/${id}/stage`, { stage, notes }),
  getPipeline: () => api.get('/deals/pipeline'),
  getSummary: () => api.get('/deals/summary'),
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
};

// Financials
export const financialsAPI = {
  get: (dealId) => api.get(`/financials/${dealId}`),
  calculate: (dealId, data) => api.post(`/financials/${dealId}/calculate`, data),
  update: (dealId, data) => api.put(`/financials/${dealId}`, data),
  sensitivity: (dealId, data) => api.post(`/financials/${dealId}/sensitivity`, data),
  scenarios: (dealId) => api.get(`/financials/${dealId}/scenarios`),
  exportCSV: (dealId) => api.get(`/financials/${dealId}/export/csv`, { responseType: 'blob' }),
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
  upload: (dealId, formData) => api.post(`/documents/${dealId}/upload`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
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
  deals: (params) => api.get('/exports/deals', { params, responseType: 'blob' }),
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

// Document Extraction
export const extractionAPI = {
  extract:          (documentId, data)                            => api.post(`/documents/${documentId}/extract`, data),
  getResult:        (documentId)                                  => api.get(`/documents/${documentId}/extraction`),
  applyCorrections: (documentId, extractionId, corrections)       => api.put(`/documents/${documentId}/extraction/${extractionId}/corrections`, { corrections }),
};

export const adminAPI = {
  resetDemoData: () => api.post('/admin/reset-demo-data', { confirm: 'RESET-REDIP-DEMO-DATA' }),
};

export default api;
