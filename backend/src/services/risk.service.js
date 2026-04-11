'use strict';

const { query } = require('../config/database');

const normalizeRiskStatus = (value) => {
  const status = String(value || 'open').trim().toLowerCase();
  const map = {
    accepted: 'mitigated',
    closed: 'resolved',
  };
  return map[status] || status;
};

const normalizeRiskPayload = (data = {}) => ({
  ...data,
  category: data.category ? String(data.category).trim().toLowerCase() : data.category,
  status: normalizeRiskStatus(data.status),
});

// ──────────────────────────────────────────────────────────────────────────────
// Scoring weights per severity (open flags only contribute to score)
// ──────────────────────────────────────────────────────────────────────────────
const SEVERITY_WEIGHTS = {
  critical: 30,
  high: 15,
  medium: 5,
  low: 1,
};

// ──────────────────────────────────────────────────────────────────────────────
// CRUD
// ──────────────────────────────────────────────────────────────────────────────

async function listByDeal(dealId) {
  const result = await query(
    `SELECT r.*,
            u.name AS created_by_name
     FROM risk_flags r
     LEFT JOIN users u ON u.id = r.created_by
     WHERE r.deal_id = $1
     ORDER BY
       CASE r.severity
         WHEN 'critical' THEN 1
         WHEN 'high'     THEN 2
         WHEN 'medium'   THEN 3
         ELSE 4
       END,
       r.category,
       r.created_at DESC`,
    [dealId],
  );
  return result.rows;
}

async function create(dealId, data, userId) {
  const normalized = normalizeRiskPayload(data);
  const {
    category,
    severity = 'medium',
    title,
    description = null,
    mitigation = null,
    status = 'open',
    source = 'manual',
  } = normalized;

  const result = await query(
    `INSERT INTO risk_flags
       (deal_id, category, severity, title, description, mitigation, status, source, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [dealId, category, severity, title, description, mitigation, status, source, userId || null],
  );
  return result.rows[0];
}

async function update(id, data) {
  const normalizedData = normalizeRiskPayload(data);
  const allowed = ['category', 'severity', 'title', 'description', 'mitigation', 'status', 'source'];

  const setClauses = [];
  const values = [];
  let paramIndex = 1;

  for (const field of allowed) {
    if (Object.prototype.hasOwnProperty.call(normalizedData, field)) {
      setClauses.push(`${field} = $${paramIndex}`);
      values.push(normalizedData[field]);
      paramIndex += 1;
    }
  }

  if (setClauses.length === 0) {
    const existing = await query('SELECT * FROM risk_flags WHERE id = $1', [id]);
    return existing.rows[0] || null;
  }

  values.push(id);
  const result = await query(
    `UPDATE risk_flags SET ${setClauses.join(', ')}, updated_at = NOW()
     WHERE id = $${paramIndex}
     RETURNING *`,
    values,
  );
  return result.rows[0] || null;
}

async function deleteRiskFlag(id) {
  const result = await query('DELETE FROM risk_flags WHERE id = $1 RETURNING id', [id]);
  return result.rows[0] || null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Risk score
// Score = sum of severity weights for all open/flagged risk flags, capped at 100.
// Resolved / mitigated flags do not contribute to score.
// ──────────────────────────────────────────────────────────────────────────────

async function getRiskScore(dealId) {
  const result = await query(
    `SELECT severity, COUNT(*) AS cnt
     FROM risk_flags
     WHERE deal_id = $1
       AND status IN ('open', 'flagged')
     GROUP BY severity`,
    [dealId],
  );

  let rawScore = 0;
  const breakdown = { critical: 0, high: 0, medium: 0, low: 0 };

  for (const row of result.rows) {
    const sev = row.severity;
    const cnt = parseInt(row.cnt, 10);
    breakdown[sev] = (breakdown[sev] || 0) + cnt;
    rawScore += (SEVERITY_WEIGHTS[sev] || 0) * cnt;
  }

  const score = Math.min(rawScore, 100);

  // Also gather totals including resolved
  const totalResult = await query(
    `SELECT
       COUNT(*)                                           AS total,
       COUNT(*) FILTER (WHERE status = 'open')           AS open_count,
       COUNT(*) FILTER (WHERE status = 'mitigated')      AS mitigated_count,
       COUNT(*) FILTER (WHERE status = 'resolved')       AS resolved_count,
       COUNT(*) FILTER (WHERE severity = 'critical')     AS critical_total,
       COUNT(*) FILTER (WHERE severity = 'high')         AS high_total
     FROM risk_flags
     WHERE deal_id = $1`,
    [dealId],
  );

  const t = totalResult.rows[0];

  return {
    score,
    raw_score: rawScore,
    open_breakdown: breakdown,
    total: parseInt(t.total, 10) || 0,
    open_count: parseInt(t.open_count, 10) || 0,
    mitigated_count: parseInt(t.mitigated_count, 10) || 0,
    resolved_count: parseInt(t.resolved_count, 10) || 0,
    critical_total: parseInt(t.critical_total, 10) || 0,
    high_total: parseInt(t.high_total, 10) || 0,
  };
}

module.exports = {
  listByDeal,
  create,
  update,
  delete: deleteRiskFlag,
  getRiskScore,
};
