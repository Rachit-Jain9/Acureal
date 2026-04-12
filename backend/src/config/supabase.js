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
const uploadFile = async (fileBuffer, fileName, mimeType, dealId) => {
  const client = getSupabaseClient();

  if (!client) {
    throw new Error('Supabase storage is not configured (set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY).');
  }

  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = `deals/${dealId}/${Date.now()}-${safeName}`;

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
const getSignedUrl = async (filePath, expiresInSeconds = 3600) => {
  const client = getSupabaseClient();

  if (!client) {
    throw new Error('Supabase storage is not configured.');
  }

  const { data, error } = await client.storage
    .from(getStorageBucket())
    .createSignedUrl(filePath, expiresInSeconds);

  if (error) {
    throw new Error(`Signed URL generation failed: ${error.message}`);
  }

  return data.signedUrl;
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
  deleteFile,
};
