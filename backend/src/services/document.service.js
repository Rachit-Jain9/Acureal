const { query } = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { uploadFile, createUploadUrl, getDownloadUrl, getStoredObjectSize, fetchStoredFile, deleteStorageFile } = require('../config/storage');
const { buildVisibleDealCondition } = require('../utils/dealVisibility');
const { EVENTS, publish } = require('../lib/eventBus');
const path = require('path');
const log = require('../lib/logger').child({ module: 'document.service' });

const getDocumentDealOptions = async () => {
  const result = await query(
    `SELECT
      d.id,
      d.name,
      d.stage,
      d.updated_at,
      p.city,
      COALESCE(NULLIF(p.name, ''), NULLIF(p.address, ''), CONCAT(COALESCE(p.city, 'Unknown city'), ' property')) as property_name
     FROM deals d
     LEFT JOIN properties p ON d.property_id = p.id
     WHERE ${buildVisibleDealCondition('d')}
     ORDER BY
       CASE
         WHEN d.stage IN ('sourced', 'screening', 'site_visit', 'loi', 'due_diligence', 'underwriting', 'ic_review', 'negotiation', 'active') THEN 1
         ELSE 2
       END,
       d.updated_at DESC`
  );

  return result.rows;
};

const uploadDocument = async (dealId, file, category, userId, description = '', organizationId = null) => {
  if (!organizationId) {
    throw createError('Active organization is required for document uploads.', 400);
  }

  // Verify deal exists and belongs to current org
  const dealResult = await query(
    'SELECT id, is_archived, stage FROM deals WHERE id = $1 AND organization_id = current_organization_id()',
    [dealId]
  );
  if (dealResult.rows.length === 0) {
    throw createError('Deal not found.', 404);
  }

  if (dealResult.rows[0].is_archived) {
    throw createError('Restore the archived deal before uploading documents to it.', 409);
  }

  if (dealResult.rows[0].stage === 'dead') {
    throw createError('Dead deals are hidden from document workflows.', 409);
  }

  if (!file || !file.buffer) {
    throw createError('No file provided.', 400);
  }

  // Sanitize filename
  const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
  const fileExt = path.extname(sanitizedName).toLowerCase();
  const fileName = `${Date.now()}-${sanitizedName}`;

  let fileUrl;
  try {
    const uploadResult = await uploadFile(file.buffer, fileName, file.mimetype, dealId, organizationId);
    fileUrl = uploadResult.url;
  } catch (error) {
    throw createError(`File upload failed: ${error.message}`, 500);
  }

  const result = await query(
    `INSERT INTO documents (deal_id, name, file_url, file_type, file_size_bytes, doc_category, description, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      dealId,
      file.originalname,
      fileUrl,
      file.mimetype || fileExt.substring(1),
      file.size || file.buffer.length,
      category || 'other',
      description || null,
      userId,
    ]
  );

  const doc = result.rows[0];

  // Get uploader name
  const userResult = await query('SELECT name FROM users WHERE id = $1', [userId]);
  doc.uploaded_by_name = userResult.rows[0]?.name || 'Unknown';

  publish(EVENTS.DOCUMENT_UPLOADED, {
    dealId,
    documentId: doc.id,
    documentName: doc.name,
    documentCategory: doc.doc_category,
    userId,
  });

  return doc;
};

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.zip', '.csv']);
const MAX_FILE_SIZE = (parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 50) * 1024 * 1024;

// Server-derived content-type, keyed off the (allow-listed) file extension.
// The DIRECT-upload path lets the browser PUT the object with any Content-Type
// it likes, and the old confirm step trusted the client's `fileType` verbatim —
// so a `report.pdf` could be recorded (and later served) as `text/html`. We
// instead derive the stored file_type from the extension here, so the DB value
// is always a benign, accurate type regardless of what the client claimed.
const EXT_TO_MIME = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.zip': 'application/zip',
  '.csv': 'text/csv',
};

/**
 * Step 1 of direct upload: generate a presigned URL so the frontend can PUT
 * the file directly to Supabase Storage (bypasses Vercel 4.5 MB body limit).
 */
const getPresignedUploadUrl = async (dealId, fileName, fileSize, userId, organizationId) => {
  if (!organizationId) {
    throw createError('Active organization is required for document uploads.', 400);
  }

  const dealResult = await query(
    'SELECT id, is_archived, stage FROM deals WHERE id = $1 AND organization_id = current_organization_id()',
    [dealId]
  );
  if (dealResult.rows.length === 0) {
    throw createError('Deal not found.', 404);
  }
  if (dealResult.rows[0].is_archived) {
    throw createError('Restore the archived deal before uploading documents to it.', 409);
  }
  if (dealResult.rows[0].stage === 'dead') {
    throw createError('Dead deals are hidden from document workflows.', 409);
  }

  // Validate extension
  const ext = path.extname(fileName).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw createError(`File type ${ext} is not allowed.`, 400);
  }

  // Validate size
  if (fileSize > MAX_FILE_SIZE) {
    throw createError(`File too large. Maximum allowed size is ${MAX_FILE_SIZE / (1024 * 1024)} MB.`, 413);
  }

  try {
    const result = await createUploadUrl(fileName, dealId, organizationId);
    return {
      signedUrl: result.signedUrl,
      storagePath: result.path,
      token: result.token,
    };
  } catch (error) {
    log.error('presigned_upload_url_failed', error, { dealId });
    throw createError('Could not create upload URL. Please try again.', 500);
  }
};

/**
 * Step 2 of direct upload: after the frontend has PUT the file to Supabase,
 * save the document metadata row in the database.
 */
const confirmDirectUpload = async (dealId, storagePath, originalName, fileType, fileSize, category, description, userId, organizationId) => {
  if (!organizationId) {
    throw createError('Active organization is required for document uploads.', 400);
  }

  const dealResult = await query(
    'SELECT id FROM deals WHERE id = $1 AND organization_id = current_organization_id()',
    [dealId]
  );
  if (dealResult.rows.length === 0) {
    throw createError('Deal not found.', 404);
  }

  if (!storagePath) {
    throw createError('Storage path is required.', 400);
  }

  // SECURITY: never trust the client-supplied storagePath. Step 1
  // (getPresignedUploadUrl → createUploadUrl) only ever issues keys under THIS
  // deal's own org/deal folder, so the confirmed path MUST live there too.
  // Without this check a caller could confirm a documents row whose file_url
  // points at ANOTHER org's object key — the download path signs it with the
  // Supabase service-role key, which bypasses storage RLS → cross-tenant
  // document exfiltration. A path containing a scheme (`https://…`) or `..`
  // would likewise turn the later download/extraction fetch into server-side
  // request forgery. Re-derive the expected prefix and reject anything else.
  const expectedPrefix = `organizations/${organizationId}/deals/${dealId}/`;
  if (
    typeof storagePath !== 'string' ||
    storagePath.startsWith('/') ||
    storagePath.includes('://') ||
    storagePath.includes('..') ||
    !storagePath.startsWith(expectedPrefix)
  ) {
    throw createError('Invalid storage path for this deal.', 400);
  }

  const fileExt = path.extname(originalName || '').toLowerCase();

  // SECURITY — server-side validation at confirm (never trust the client here):
  //   • re-check the extension against the allow-list (confirm is independently
  //     reachable from the presign step that first checked it);
  //   • derive the stored content-type from the extension and IGNORE the
  //     client-supplied `fileType` — the browser PUTs the object with whatever
  //     Content-Type it likes, so trusting the client could record/serve a file
  //     as an executable type (stored-XSS) or mislabel it;
  //   • verify the object's TRUE byte size from storage metadata rather than the
  //     size the client claimed at presign (a client can claim small, PUT large).
  if (!ALLOWED_EXTENSIONS.has(fileExt)) {
    throw createError(`File type ${fileExt || '(none)'} is not allowed.`, 400);
  }
  const derivedType = EXT_TO_MIME[fileExt] || 'application/octet-stream';

  let verifiedSize = Number.isFinite(fileSize) ? fileSize : 0;
  try {
    const trueSize = await getStoredObjectSize(storagePath);
    if (Number.isFinite(trueSize)) {
      if (trueSize > MAX_FILE_SIZE) {
        // Best-effort cleanup so an oversized object doesn't linger in storage —
        // log (don't swallow) a failed delete so an orphan is observable/reapable.
        await deleteStorageFile(storagePath).catch((delErr) => {
          log.warn('oversize_object_cleanup_failed', { dealId, error: delErr.message });
        });
        throw createError(`File too large. Maximum allowed size is ${MAX_FILE_SIZE / (1024 * 1024)} MB.`, 413);
      }
      verifiedSize = trueSize;
    }
  } catch (err) {
    if (err.statusCode) throw err; // re-throw the 413 above
    // The metadata lookup itself failed — don't block a legitimate upload on a
    // flaky storage list call; fall back to the client-claimed size.
    log.warn('object_size_verify_failed', { dealId, error: err.message });
  }

  const result = await query(
    `INSERT INTO documents (deal_id, name, file_url, file_type, file_size_bytes, doc_category, description, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      dealId,
      originalName || 'Untitled',
      storagePath,
      derivedType,
      verifiedSize,
      category || 'other',
      description || null,
      userId,
    ]
  );

  const doc = result.rows[0];
  const userResult = await query('SELECT name FROM users WHERE id = $1', [userId]);
  doc.uploaded_by_name = userResult.rows[0]?.name || 'Unknown';

  publish(EVENTS.DOCUMENT_UPLOADED, {
    dealId,
    documentId: doc.id,
    documentName: doc.name,
    documentCategory: doc.doc_category,
    userId,
  });

  return doc;
};

const getDocuments = async (dealId, category = null) => {
  const dealResult = await query(
    'SELECT id, is_archived, stage FROM deals WHERE id = $1 AND organization_id = current_organization_id()',
    [dealId]
  );
  if (dealResult.rows.length === 0) {
    throw createError('Deal not found.', 404);
  }

  if (dealResult.rows[0].is_archived || dealResult.rows[0].stage === 'dead') {
    throw createError('Deal not found.', 404);
  }

  const conditions = ['d.deal_id = $1'];
  const values = [dealId];
  let paramCount = 2;

  if (category) {
    conditions.push(`d.doc_category = $${paramCount}`);
    values.push(category);
  }

  const result = await query(
    `SELECT
       d.*,
       d.name AS file_name,
       d.name AS original_name,
       d.file_type AS mime_type,
       d.file_size_bytes AS file_size,
       d.doc_category AS category,
       d.created_at AS uploaded_at,
       u.name as uploaded_by_name
     FROM documents d
     LEFT JOIN users u ON d.uploaded_by = u.id
     WHERE ${conditions.join(' AND ')}
     ORDER BY d.doc_category, d.created_at DESC`,
    values
  );

  // Group by category
  const grouped = {};
  for (const doc of result.rows) {
    if (!grouped[doc.doc_category]) {
      grouped[doc.doc_category] = [];
    }
    grouped[doc.doc_category].push(doc);
  }

  return {
    documents: result.rows,
    grouped,
    total: result.rows.length,
  };
};

const deleteDocument = async (documentId, userId) => {
  const result = await query(
    `SELECT doc.*, deals.is_archived AS deal_archived, deals.stage AS deal_stage
     FROM documents doc
     LEFT JOIN deals ON deals.id = doc.deal_id
     WHERE doc.id = $1
       AND doc.organization_id = current_organization_id()`,
    [documentId]
  );

  if (result.rows.length === 0) {
    throw createError('Document not found.', 404);
  }

  const doc = result.rows[0];

  if (doc.deal_archived) {
    throw createError('Cannot delete documents from an archived deal. Restore the deal first.', 409);
  }

  if (doc.deal_stage === 'dead') {
    throw createError('Cannot delete documents from a dead deal.', 409);
  }

  try {
    await deleteStorageFile(doc.file_url);
  } catch (error) {
    console.warn('Could not delete file from storage:', error.message);
    // Continue with DB deletion even if storage deletion fails
  }

  await query('DELETE FROM documents WHERE id = $1', [documentId]);

  return { deleted: true, id: documentId };
};

// Publish a sensitive-document access event onto the bus. Fire-and-forget —
// mirrors the DOCUMENT_UPLOADED publish above. The documentAccessLog sink
// writes the immutable audit row; a failure there never breaks the download.
// accessContext carries the request forensics threaded from the route:
//   { userId, organizationId, ip, userAgent }
const publishDocumentAccessed = (doc, action, accessContext = {}) => {
  publish(EVENTS.DOCUMENT_ACCESSED, {
    documentId: doc.id,
    organizationId: accessContext.organizationId || doc.organization_id || null,
    userId: accessContext.userId || null,
    action,
    documentKind: 'deal_document',
    documentName: doc.name || null,
    dealId: doc.deal_id || null,
    ip: accessContext.ip || null,
    userAgent: accessContext.userAgent || null,
  });
};

const getSignedUrl = async (documentId, dealId = null, accessContext = {}) => {
  const result = await query(
    `SELECT doc.*, deals.is_archived AS deal_archived, deals.stage AS deal_stage
     FROM documents doc
     LEFT JOIN deals ON deals.id = doc.deal_id
     WHERE doc.id = $1
       AND doc.organization_id = current_organization_id()`,
    [documentId]
  );

  if (result.rows.length === 0) {
    throw createError('Document not found.', 404);
  }

  const doc = result.rows[0];

  if (dealId && doc.deal_id && doc.deal_id !== dealId) {
    throw createError('Document not found.', 404);
  }

  if (doc.deal_archived || doc.deal_stage === 'dead') {
    throw createError('Document not found.', 404);
  }

  try {
    const downloadUrl = await getDownloadUrl(doc.file_url, 3600);
    // Log the access only once the URL was actually issued — a failed
    // signing attempt is not an access.
    publishDocumentAccessed(doc, 'signed_url', accessContext);
    return {
      url: downloadUrl,
      expires_in: 3600,
      document: doc,
    };
  } catch (error) {
    // Log the storage-layer detail server-side; return a generic message so the
    // provider SDK's internals (bucket/host/paths) never reach the client.
    log.error('signed_url_failed', error, { documentId });
    throw createError('Could not generate download URL. Please try again.', 500);
  }
};

const streamDownload = async (documentId, res, dealId = null, accessContext = {}) => {
  const result = await query(
    `SELECT doc.*, deals.is_archived AS deal_archived, deals.stage AS deal_stage
     FROM documents doc
     LEFT JOIN deals ON deals.id = doc.deal_id
     WHERE doc.id = $1
       AND doc.organization_id = current_organization_id()`,
    [documentId]
  );

  if (result.rows.length === 0) {
    throw createError('Document not found.', 404);
  }

  const doc = result.rows[0];

  if (dealId && doc.deal_id && doc.deal_id !== dealId) {
    throw createError('Document not found.', 404);
  }

  if (doc.deal_archived || doc.deal_stage === 'dead') {
    throw createError('Document not found.', 404);
  }

  try {
    const file = await fetchStoredFile(doc.file_url, 3600);

    // The bytes are about to be streamed to the client — record the access.
    publishDocumentAccessed(doc, 'download', accessContext);

    res.setHeader('Content-Type', file.contentType || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', file.cacheControl || 'private, no-cache');

    if (file.contentLength) {
      res.setHeader('Content-Length', file.contentLength);
    }

    if (file.etag) {
      res.setHeader('ETag', file.etag);
    }

    const fallbackName = doc.name || 'document';
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(fallbackName)}`
    );

    file.stream.on('error', (error) => {
      res.destroy(error);
    });

    file.stream.pipe(res);
  } catch (error) {
    log.error('document_stream_failed', error, { documentId });
    throw createError('Could not download file. Please try again.', 500);
  }
};

module.exports = {
  getDocumentDealOptions,
  uploadDocument,
  getPresignedUploadUrl,
  confirmDirectUpload,
  getDocuments,
  deleteDocument,
  getSignedUrl,
  streamDownload,
};
