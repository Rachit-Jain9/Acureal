'use strict';

const { createClient } = require('@supabase/supabase-js');

let supabaseClient = null;

const hasConfiguredValue = (value) =>
  value && !/your[_-]/i.test(value) && !value.startsWith('[') && value.length > 10;

const getSupabaseConfig = () => {
  const url = (process.env.SUPABASE_URL || '').trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '').trim();
  const bucket = (process.env.SUPABASE_STORAGE_BUCKET || 'redip-documents').trim() || 'redip-documents';

  return {
    url,
    serviceRoleKey,
    bucket,
    isConfigured: hasConfiguredValue(url) && hasConfiguredValue(serviceRoleKey),
    keySource: hasConfiguredValue(process.env.SUPABASE_SERVICE_ROLE_KEY || '')
      ? 'SUPABASE_SERVICE_ROLE_KEY'
      : hasConfiguredValue(process.env.SUPABASE_KEY || '')
        ? 'SUPABASE_KEY'
        : null,
  };
};

const isSupabaseConfigured = () => getSupabaseConfig().isConfigured;

const getStorageBucket = () => getSupabaseConfig().bucket;

const getSupabaseClient = () => {
  if (!supabaseClient) {
    const config = getSupabaseConfig();

    if (!config.isConfigured) {
      console.warn('[Supabase] Credentials not configured. File storage via Supabase is disabled.');
      return null;
    }

    supabaseClient = createClient(config.url, config.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return supabaseClient;
};

const api = {
  getSupabaseConfig,
  getSupabaseClient,
  getStorageBucket,
  isSupabaseConfigured,
};

Object.defineProperty(api, 'supabase', {
  enumerable: true,
  get: getSupabaseClient,
});

module.exports = api;
