'use strict';

/**
 * Supabase storage helpers built on the shared backend client in src/lib/supabase.js.
 */

const {
  getSupabaseConfig,
  getSupabaseClient,
  getStorageBucket,
  isSupabaseConfigured,
} = require('../lib/supabase');

/**
 * Upload a file to Supabase Storage (private bucket).
 * Returns the storage path - not a public URL.
 * Call getSignedUrl() to generate a time-limited access URL.
 */
const uploadFile = async (fileBuffer, fileName, mimeType, dealId, organizationId = null) => {
  const client = getSupabaseClient();

  if (!client) {
    throw new Error('Supabase storage is not configured (set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY).');
  }

  if (!organizationId) {
    throw new Error('Active organization context is required for document uploads.');
  }

  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = `organizations/${organizationId}/deals/${dealId}/${Date.now()}-${safeName}`;

  const { data, error } = await client.storage
    .from(getStorageBucket())
    .upload(filePath, fileBuffer, {
      contentType: mimeType,
      upsert: false,
    });

  if (error) {
    throw new Error(`Supabase upload failed: ${error.message}`);
  }

  return {
    path: data.path,
    fullPath: data.fullPath,
    url: data.path,
  };
};

/**
 * Generate a time-limited signed URL for a stored file.
 * Default expiry: 1 hour.
 */
const getSignedUrl = async (filePath, expiresInSeconds = 3600, options = undefined) => {
  const client = getSupabaseClient();

  if (!client) {
    throw new Error('Supabase storage is not configured.');
  }

  // `options` is passed straight to Supabase's createSignedUrl. The caller uses
  // `{ download: true }` for client-facing URLs so the object is served with
  // Content-Disposition: attachment (never rendered inline → no stored-XSS via a
  // file uploaded with an executable content-type). Server-side fetches omit it.
  const { data, error } = await client.storage
    .from(getStorageBucket())
    .createSignedUrl(filePath, expiresInSeconds, options);

  if (error) {
    throw new Error(`Signed URL generation failed: ${error.message}`);
  }

  return data.signedUrl;
};

/**
 * Return the true stored byte size of an object, read from storage metadata
 * (no download). Used to verify a direct-upload's real size at confirm time,
 * since the size checked at presign is only the client's claim. Returns null
 * when the size can't be determined (object missing, list error) so the caller
 * can decide whether to block.
 */
const getObjectSize = async (filePath) => {
  const client = getSupabaseClient();
  if (!client || typeof filePath !== 'string' || !filePath) return null;

  const lastSlash = filePath.lastIndexOf('/');
  const folder = lastSlash >= 0 ? filePath.slice(0, lastSlash) : '';
  const name = lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;

  const { data, error } = await client.storage
    .from(getStorageBucket())
    .list(folder, { search: name, limit: 100 });

  if (error || !Array.isArray(data)) return null;
  const match = data.find((o) => o.name === name);
  const size = match?.metadata?.size;
  return Number.isFinite(size) ? size : null;
};

/**
 * Create a signed upload URL so the client can PUT a file directly to Supabase,
 * bypassing Vercel's 4.5 MB serverless body limit.
 */
const createSignedUploadUrl = async (filePath) => {
  const client = getSupabaseClient();

  if (!client) {
    throw new Error('Supabase storage is not configured (set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY).');
  }

  const { data, error } = await client.storage
    .from(getStorageBucket())
    .createSignedUploadUrl(filePath);

  if (error) {
    throw new Error(`Signed upload URL creation failed: ${error.message}`);
  }

  return {
    signedUrl: data.signedUrl,
    path: data.path,
    token: data.token,
  };
};

/**
 * Delete a file from Supabase Storage.
 */
const deleteFile = async (filePath) => {
  const client = getSupabaseClient();

  if (!client) {
    throw new Error('Supabase storage is not configured.');
  }

  const { error } = await client.storage.from(getStorageBucket()).remove([filePath]);

  if (error) {
    throw new Error(`Supabase delete failed: ${error.message}`);
  }

  return true;
};

module.exports = {
  getSupabaseConfig,
  getSupabaseClient,
  getStorageBucket,
  isSupabaseConfigured,
  uploadFile,
  getSignedUrl,
  getObjectSize,
  createSignedUploadUrl,
  deleteFile,
};
