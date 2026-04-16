const { query } = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const {
  ACTIVITY_TYPES,
  ACTIVITY_STATUSES,
  ACTIVITY_PRIORITIES,
} = require('../constants/domain');
const { roleSatisfies } = require('../constants/roles');
const { buildVisibleDealCondition } = require('../utils/dealVisibility');

const ensureDealExists = async (dealId) => {
  const dealResult = await query(
    `SELECT id
     FROM deals
     WHERE id = $1
       AND ${buildVisibleDealCondition('deals')}`,
    [dealId]
  );
  if (dealResult.rows.length === 0) {
    throw createError('Deal not found.', 404);
  }
};

const ensureActivityEditable = async (activityId, userId, userRole) => {
  const result = await query(
    'SELECT * FROM activities WHERE id = $1 AND organization_id = current_organization_id()',
    [activityId]
  );

  if (result.rows.length === 0) {
    throw createError('Activity not found.', 404);
  }

  const activity = result.rows[0];
  if (!roleSatisfies(userRole, ['admin', 'editor']) && activity.performed_by !== userId) {
    throw createError('You do not have permission to modify this activity.', 403);
  }

  return activity;
};

const logActivity = async (
  dealId,
  type,
  description,
  userId,
  activityDate = null,
  nextFollowUp = null,
  isImportant = false,
  status = 'open',
  priority = 'medium'
) => {
  await ensureDealExists(dealId);

  if (!ACTIVITY_TYPES.includes(type)) {
    throw createError(`Invalid activity type. Must be one of: ${ACTIVITY_TYPES.join(', ')}`, 400);
  }

  if (!description || description.trim().length === 0) {
    throw createError('Activity description is required.', 400);
  }

  if (!ACTIVITY_STATUSES.includes(status)) {
    throw createError(`Invalid activity status. Must be one of: ${ACTIVITY_STATUSES.join(', ')}`, 400);
  }

  if (!ACTIVITY_PRIORITIES.includes(priority)) {
    throw createError(`Invalid activity priority. Must be one of: ${ACTIVITY_PRIORITIES.join(', ')}`, 400);
  }

  const date = activityDate ? new Date(activityDate) : new Date();
  if (Number.isNaN(date.getTime())) {
    throw createError('Invalid activity date provided.', 400);
  }

  const completedAt = status === 'completed' ? new Date() : null;
  const completedBy = status === 'completed' ? userId : null;

  const result = await query(
    `INSERT INTO activities (
      deal_id, activity_type, description, performed_by, activity_date, next_follow_up,
      is_important, status, priority, completed_at, completed_by
    )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      dealId,
      type,
      description.trim(),
      userId,
      date,
      nextFollowUp || null,
      isImportant || false,
      status,
      priority,
      completedAt,
      completedBy,
    ]
  );

  const activity = result.rows[0];
  const userResult = await query('SELECT name FROM users WHERE id = $1', [userId]);
  activity.performed_by_name = userResult.rows[0]?.name || 'Unknown';

  await query('UPDATE deals SET updated_at = NOW() WHERE id = $1', [dealId]);
  return activity;
};

const buildActivityQuery = (filters = {}, pagination = {}) => {
  const conditions = [buildVisibleDealCondition('d')];
  const values = [];
  let paramCount = 1;

  if (filters.dealId) {
    conditions.push(`a.deal_id = $${paramCount}`);
    values.push(filters.dealId);
    paramCount++;
  }

  if (filters.type) {
    conditions.push(`a.activity_type = $${paramCount}`);
    values.push(filters.type);
    paramCount++;
  }

  if (filters.status) {
    conditions.push(`a.status = $${paramCount}`);
    values.push(filters.status);
    paramCount++;
  }

  if (filters.priority) {
    conditions.push(`a.priority = $${paramCount}`);
    values.push(filters.priority);
    paramCount++;
  }

  if (filters.performedBy) {
    conditions.push(`a.performed_by = $${paramCount}`);
    values.push(filters.performedBy);
    paramCount++;
  }

  if (filters.isImportant === true) {
    conditions.push('a.is_important = TRUE');
  }

  if (filters.dateFrom) {
    conditions.push(`a.activity_date >= $${paramCount}`);
    values.push(filters.dateFrom);
    paramCount++;
  }

  if (filters.dateTo) {
    conditions.push(`a.activity_date <= $${paramCount}`);
    values.push(filters.dateTo);
    paramCount++;
  }

  if (filters.search) {
    conditions.push(
      `(a.description ILIKE $${paramCount}
        OR COALESCE(deal.name, '') ILIKE $${paramCount}
        OR COALESCE(prop.city, '') ILIKE $${paramCount})`
    );
    values.push(`%${filters.search}%`);
    paramCount++;
  }

  const page = parseInt(pagination.page, 10) || 1;
  const limit = Math.min(parseInt(pagination.limit, 10) || 50, 200);
  const offset = (page - 1) * limit;

  return {
    whereClause: conditions.join(' AND '),
    values,
    page,
    limit,
    offset,
    paramCount,
  };
};

const listActivities = async (filters = {}, pagination = {}) => {
  const { whereClause, values, page, limit, offset, paramCount } = buildActivityQuery(filters, pagination);

  const countResult = await query(
    `SELECT COUNT(*)
     FROM activities a
     LEFT JOIN deals d ON a.deal_id = d.id
     LEFT JOIN deals deal ON a.deal_id = deal.id
     LEFT JOIN properties prop ON deal.property_id = prop.id
     WHERE ${whereClause}`,
    values
  );

  const dataResult = await query(
    `SELECT a.*, u.name as performed_by_name, completer.name as completed_by_name,
      deal.name as deal_name, prop.city as deal_city,
      COALESCE(NULLIF(prop.name, ''), NULLIF(prop.address, ''), CONCAT(COALESCE(prop.city, 'Unknown city'), ' property')) as property_name
     FROM activities a
     LEFT JOIN users u ON a.performed_by = u.id
     LEFT JOIN users completer ON a.completed_by = completer.id
     LEFT JOIN deals d ON a.deal_id = d.id
     LEFT JOIN deals deal ON a.deal_id = deal.id
     LEFT JOIN properties prop ON deal.property_id = prop.id
     WHERE ${whereClause}
     ORDER BY
       CASE a.status WHEN 'open' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END,
       CASE a.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
       a.activity_date DESC
     LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
    [...values, limit, offset]
  );

  return {
    data: dataResult.rows,
    pagination: {
      total: parseInt(countResult.rows[0].count, 10),
      page,
      limit,
      totalPages: Math.ceil(parseInt(countResult.rows[0].count, 10) / limit),
    },
  };
};

const getActivities = async (dealId, filters = {}, pagination = {}) => {
  await ensureDealExists(dealId);
  return listActivities({ ...filters, dealId }, pagination);
};

const getRecentActivities = async (userId = null, limit = 20) => {
  const result = await listActivities(
    { performedBy: userId || undefined },
    { page: 1, limit: Math.min(parseInt(limit, 10) || 20, 100) }
  );

  return result.data;
};

const updateActivity = async (activityId, data, userId, userRole) => {
  const activity = await ensureActivityEditable(activityId, userId, userRole);

  const nextType = data.type ?? activity.activity_type;
  const nextStatus = data.status ?? activity.status;
  const nextPriority = data.priority ?? activity.priority;

  if (!ACTIVITY_TYPES.includes(nextType)) {
    throw createError(`Invalid activity type. Must be one of: ${ACTIVITY_TYPES.join(', ')}`, 400);
  }

  if (!ACTIVITY_STATUSES.includes(nextStatus)) {
    throw createError(`Invalid activity status. Must be one of: ${ACTIVITY_STATUSES.join(', ')}`, 400);
  }

  if (!ACTIVITY_PRIORITIES.includes(nextPriority)) {
    throw createError(`Invalid activity priority. Must be one of: ${ACTIVITY_PRIORITIES.join(', ')}`, 400);
  }

  const completedAt = nextStatus === 'completed' ? activity.completed_at || new Date() : null;
  const completedBy = nextStatus === 'completed' ? activity.completed_by || userId : null;

  const result = await query(
    `UPDATE activities
     SET activity_type = $1,
         description = $2,
         activity_date = $3,
         next_follow_up = $4,
         is_important = $5,
         status = $6,
         priority = $7,
         completed_at = $8,
         completed_by = $9,
         updated_at = NOW()
     WHERE id = $10
     RETURNING *`,
    [
      nextType,
      (data.description ?? activity.description)?.trim(),
      data.activityDate ?? activity.activity_date,
      data.nextFollowUp ?? activity.next_follow_up,
      data.isImportant ?? activity.is_important,
      nextStatus,
      nextPriority,
      completedAt,
      completedBy,
      activityId,
    ]
  );

  await query('UPDATE deals SET updated_at = NOW() WHERE id = $1', [activity.deal_id]);
  return result.rows[0];
};

const setActivityStatus = async (activityId, status, userId, userRole) => {
  return updateActivity(activityId, { status }, userId, userRole);
};

const deleteActivity = async (activityId, userId, userRole) => {
  const activity = await ensureActivityEditable(activityId, userId, userRole);
  await query('DELETE FROM activities WHERE id = $1', [activityId]);
  await query('UPDATE deals SET updated_at = NOW() WHERE id = $1', [activity.deal_id]);
  return { deleted: true, id: activityId };
};

module.exports = {
  logActivity,
  listActivities,
  getActivities,
  getRecentActivities,
  updateActivity,
  setActivityStatus,
  deleteActivity,
};
