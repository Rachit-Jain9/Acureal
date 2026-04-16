'use strict';

/**
 * Storage abstraction with provider selection.
 *
 * STORAGE_PROVIDER:
 *   - auto         -> prefer Supabase when configured, otherwise Vercel Blob
 *   - supabase     -> force Supabase when configured
 *   - vercel_blob  -> force Vercel Blob when configured
 *
 * file_url convention:
 *   Vercel Blob  -> full https:// URL (public/tokenized access, use directly)
 *   Supabase     -> storage path only (requires signed URL generation)
 */

const { Readable } = require('stream');

const {
  uploadFile: supabaseUpload,
  getSignedUrl: supabaseSignedUrl,
  createSignedUploadUrl: supabaseCreateSignedUploadUrl,
  deleteFile: supabaseDelete,
  getSupabaseConfig,
  isSupabaseConfigured,
} = require('./supabase');

const hasConfiguredValue = (value) =>
  value && !/your[_-]/i.test(value) && !value.startsWith('[') && value.length > 10;

const isVercelBlobConfigured = () => hasConfiguredValue((process.env.BLOB_READ_WRITE_TOKEN || '').trim());
const getBlobAccess = () => ((process.env.BLOB_ACCESS || 'private').trim().toLowerCase() === 'public' ? 'public' : 'private');
const isVercelBlobUrl = (fileUrl) => typeof fileUrl === 'string' && fileUrl.includes('.blob.vercel-storage.com/');
const isPrivateVercelBlobUrl = (fileUrl) =>
  typeof fileUrl === 'string' && fileUrl.includes('.private.blob.vercel-storage.com/');
const getFallbackBlobAccess = (access) => (access === 'public' ? 'private' : 'public');

const shouldRetryBlobAccess = (error, attemptedAccess) => {
  const message = error?.message || '';

  if (attemptedAccess === 'public' && /private store/i.test(message)) {
    return true;
  }

  if (attemptedAccess === 'private' && /access must be "public"/i.test(message)) {
    return true;
  }

  return false;
};

const getPreferredStorageProvider = () => {
  const configuredPreference = (process.env.STORAGE_PROVIDER || 'auto').trim().toLowerCase();

  if (configuredPreference === 'supabase') {
    return isSupabaseConfigured() ? 'supabase' : 'unconfigured';
  }

  if (configuredPreference === 'vercel_blob') {
    return isVercelBlobConfigured() ? 'vercel_blob' : 'unconfigured';
  }

  if (isSupabaseConfigured()) {
    return 'supabase';
  }

  if (isVercelBlobConfigured()) {
    return 'vercel_blob';
  }

  return 'unconfigured';
};

const getStorageStatus = () => {
  const provider = getPreferredStorageProvider();

  if (provider === 'vercel_blob') {
    return {
      provider: 'vercel_blob',
      status: 'healthy',
      access: getBlobAccess(),
    };
  }

  if (provider === 'supabase') {
    const supabase = getSupabaseConfig();

    return {
      provider: 'supabase',
      status: 'healthy',
      bucket: supabase.bucket,
      key_source: supabase.keySource,
    };
  }

  return {
    provider: 'unconfigured',
    status: 'not_configured',
  };
};

// Lazy-load @vercel/blob so the server starts even without the package installed
let blobClient = null;

const getBlob = () => {
  if (!blobClient) {
    try {
      blobClient = require('@vercel/blob');
    } catch {
      throw new Error('@vercel/blob is not installed. Run: npm install @vercel/blob in the backend directory.');
    }
  }

  return blobClient;
};

/**
 * Upload a file. Returns { url, isBlob } where:
 *   url     = storage identifier stored in documents.file_url
 *   isBlob  = true if stored in Vercel Blob (url is a full https URL)
 */
const uploadFile = async (fileBuffer, fileName, mimeType, dealId, organizationId = null) => {
  const preferredProvider = getPreferredStorageProvider();

  if (preferredProvider === 'vercel_blob') {
    const { put } = getBlob();
    const pathname = `deals/${dealId}/${Date.now()}-${fileName}`;
    let access = getBlobAccess();
    let blob;

    try {
      blob = await put(pathname, fileBuffer, {
        access,
        contentType: mimeType,
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
    } catch (error) {
      if (!shouldRetryBlobAccess(error, access)) {
        throw error;
      }

      access = getFallbackBlobAccess(access);
      blob = await put(pathname, fileBuffer, {
        access,
        contentType: mimeType,
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
    }

    return { url: blob.url, downloadUrl: blob.downloadUrl, isBlob: true, access };
  }

  if (preferredProvider === 'supabase') {
    const result = await supabaseUpload(fileBuffer, fileName, mimeType, dealId, organizationId);
    return { url: result.path, isBlob: false, access: 'private' };
  }

  const result = await supabaseUpload(fileBuffer, fileName, mimeType, dealId, organizationId);

  return { url: result.path, isBlob: false };
};

/**
 * Get a download URL for a stored document.
 *   Vercel Blob  -> URL is already publicly accessible, return as-is
 *   Supabase     -> generate a 1-hour signed URL
 */
const getDownloadUrl = async (fileUrl, expiresInSeconds = 3600) => {
  if (fileUrl && fileUrl.startsWith('https://')) {
    return fileUrl;
  }

  return supabaseSignedUrl(fileUrl, expiresInSeconds);
};

const fetchStoredFile = async (fileUrl, expiresInSeconds = 3600) => {
  let response;

  if (isPrivateVercelBlobUrl(fileUrl)) {
    response = await fetch(fileUrl, {
      headers: {
        Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`,
      },
    });
  } else if (isVercelBlobUrl(fileUrl)) {
    response = await fetch(fileUrl);
  } else {
    const signedUrl = await supabaseSignedUrl(fileUrl, expiresInSeconds);
    response = await fetch(signedUrl);
  }

  if (!response.ok || !response.body) {
    throw new Error(`Stored file fetch failed: ${response.status} ${response.statusText}`);
  }

  return {
    stream: Readable.fromWeb(response.body),
    contentType: response.headers.get('content-type') || 'application/octet-stream',
    contentLength: response.headers.get('content-length'),
    contentDisposition: response.headers.get('content-disposition'),
    etag: response.headers.get('etag'),
    cacheControl: response.headers.get('cache-control'),
  };
};

/**
 * Create a presigned upload URL so the frontend can upload directly to storage,
 * bypassing Vercel's 4.5 MB serverless request body limit.
 * Only supported for Supabase storage.
 */
const createUploadUrl = async (fileName, dealId, organizationId) => {
  const preferredProvider = getPreferredStorageProvider();

  if (preferredProvider !== 'supabase') {
    throw new Error('Direct uploads are only supported with Supabase storage.');
  }

  if (!organizationId) {
    throw new Error('Active organization context is required for document uploads.');
  }

  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = `organizations/${organizationId}/deals/${dealId}/${Date.now()}-${safeName}`;

  return supabaseCreateSignedUploadUrl(filePath);
};

/**
 * Delete a stored file.
 */
const deleteStorageFile = async (fileUrl) => {
  if (fileUrl && fileUrl.startsWith('https://')) {
    if (isVercelBlobConfigured()) {
      const { del } = getBlob();
      await del(fileUrl, { token: process.env.BLOB_READ_WRITE_TOKEN });
    }

    return;
  }

  await supabaseDelete(fileUrl);
};

module.exports = {
  uploadFile,
  createUploadUrl,
  getDownloadUrl,
  fetchStoredFile,
  deleteStorageFile,
  getStorageStatus,
  getPreferredStorageProvider,
  isPrivateVercelBlobUrl,
};
