const { query } = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { uploadFile, getDownloadUrl, fetchStoredFile, deleteStorageFile } = require('../config/storage');
const { buildVisibleDealCondition } = require('../utils/dealVisibility');
const path = require('path');

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

const uploadDocument = async (dealId, file, category, userId, description = '') => {
  // Verify deal exists
  const dealResult = await query('SELECT id, is_archived, stage FROM deals WHERE id = $1', [dealId]);
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
    const uploadResult = await uploadFile(file.buffer, fileName, file.mimetype, dealId);
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

  return doc;
};

const getDocuments = async (dealId, category = null) => {
  const dealResult = await query('SELECT id, is_archived, stage FROM deals WHERE id = $1', [dealId]);
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
     WHERE doc.id = $1`,
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

const getSignedUrl = async (documentId, dealId = null) => {
  const result = await query(
    `SELECT doc.*, deals.is_archived AS deal_archived, deals.stage AS deal_stage
     FROM documents doc
     LEFT JOIN deals ON deals.id = doc.deal_id
     WHERE doc.id = $1`,
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
    return {
      url: downloadUrl,
      expires_in: 3600,
      document: doc,
    };
  } catch (error) {
    throw createError(`Could not generate download URL: ${error.message}`, 500);
  }
};

const streamDownload = async (documentId, res, dealId = null) => {
  const result = await query(
    `SELECT doc.*, deals.is_archived AS deal_archived, deals.stage AS deal_stage
     FROM documents doc
     LEFT JOIN deals ON deals.id = doc.deal_id
     WHERE doc.id = $1`,
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
    throw createError(`Could not download file: ${error.message}`, 500);
  }
};

module.exports = {
  getDocumentDealOptions,
  uploadDocument,
  getDocuments,
  deleteDocument,
  getSignedUrl,
  streamDownload,
};
