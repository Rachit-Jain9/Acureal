'use strict';

/**
 * Daily hard-purge of soft-deleted deal child entities past the retention
 * window.
 *
 * Soft-deleted rows (deleted_at set) are hidden from every read path the moment
 * a user deletes them; this sweep permanently removes the tombstones once they
 * are older than SOFT_DELETE_RETENTION_DAYS (default 15). For documents it
 * deletes the stored file bytes FIRST — the soft-delete deliberately kept them
 * so an accidental delete was recoverable for the window.
 *
 * Runs as the RLS-bypassing app role with no org context (mirrors
 * retentionSweep), so a single pass purges every org's expired tombstones.
 * Fail-open + per-table isolation: one failing table never aborts the rest.
 */

const { query } = require('../config/database');
const { deleteStorageFile } = require('../config/storage');
const dealAuditLog = require('./dealAuditLog.service');
const log = require('../lib/logger').child({ module: 'entityPurge' });

const RETENTION_DAYS = (() => {
  const v = Number(process.env.SOFT_DELETE_RETENTION_DAYS);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 15;
})();

// Documents are special: delete the stored bytes BEFORE the DB row so a crash
// mid-sweep can't orphan a file (the file_url lives on the row). Fail-open per
// file. The DB delete then cascades document_extractions away via its FK.
const purgeDocuments = async () => {
  const { rows } = await query(
    `SELECT id, deal_id, file_url FROM documents
      WHERE deleted_at IS NOT NULL
        AND deleted_at < NOW() - ($1::int * INTERVAL '1 day')`,
    [RETENTION_DAYS],
  );
  let storageFailures = 0;
  for (const r of rows) {
    if (!r.file_url) continue;
    try {
      await deleteStorageFile(r.file_url);
    } catch (e) {
      storageFailures += 1;
      log.warn('purge_storage_delete_failed', { documentId: r.id, error: e.message });
    }
  }
  if (rows.length > 0) {
    await query('DELETE FROM documents WHERE id = ANY($1::uuid[])', [rows.map((r) => r.id)]);
    for (const r of rows) {
      await dealAuditLog.recordAudit({
        dealId: r.deal_id,
        eventType: 'document_purged',
        actorId: null,
        metadata: { original_document_id: r.id, file_url: r.file_url },
      });
    }
  }
  return { rows_purged: rows.length, storage_failures: storageFailures };
};

// Plain tombstone tables — bulk hard-delete past the window. `table` is a
// hardcoded constant from runSweep (never user input), so the interpolation is
// injection-safe.
const purgeTable = async (table) => {
  const result = await query(
    `DELETE FROM ${table}
      WHERE deleted_at IS NOT NULL
        AND deleted_at < NOW() - ($1::int * INTERVAL '1 day')`,
    [RETENTION_DAYS],
  );
  return { rows_purged: result.rowCount || 0 };
};

const runSweep = async () => {
  const out = { retention_days: RETENTION_DAYS };
  // Documents first so the storage-then-row ordering holds; per-table try/catch
  // so one failure doesn't abort the others (mirrors retentionSweep).
  const steps = [
    ['documents', purgeDocuments],
    ['risk_flags', () => purgeTable('risk_flags')],
    ['approval_items', () => purgeTable('approval_items')],
    ['dd_items', () => purgeTable('dd_items')],
  ];
  for (const [key, fn] of steps) {
    try {
      out[key] = await fn();
    } catch (e) {
      log.error('purge_table_failed', { table: key, error: e.message });
      out[key] = { error: e.message };
    }
  }
  return out;
};

module.exports = { runSweep, purgeDocuments, purgeTable, RETENTION_DAYS };
