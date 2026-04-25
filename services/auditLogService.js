const { dbAll, dbGet, dbRun } = require('../helpers/dbAsync');
const { getSettings } = require('./appSettingsService');

const ALLOWED_ACTIONS = new Set([
  'create',
  'update',
  'delete',
  'import',
  'login',
  'logout',
  'backup_manual',
  'backup_auto',
  'restore',
  'settings_update'
]);

function normalizeActionType(value) {
  const normalizedValue = String(value || '').trim().toLowerCase();
  return ALLOWED_ACTIONS.has(normalizedValue) ? normalizedValue : 'update';
}

function safeJson(value) {
  if (value === undefined) {
    return null;
  }

  return JSON.stringify(value === null ? null : value, null, 2);
}

async function resolveActorName(req, explicitActorName = '') {
  if (req?.currentUser?.display_name) {
    return String(req.currentUser.display_name).trim();
  }

  const directValue =
    explicitActorName ||
    req?.headers?.['x-operator-name'] ||
    req?.body?.operator_name ||
    req?.query?.operator_name ||
    '';
  const normalizedDirectValue = String(directValue || '').trim();

  if (normalizedDirectValue) {
    return normalizedDirectValue;
  }

  try {
    const settings = await getSettings();
    const settingsActorName = String(settings?.security?.operatorName || '').trim();

    if (settingsActorName) {
      return settingsActorName;
    }
  } catch (err) {
    // Ignore settings resolution errors and fall back to environment values.
  }

  return String(process.env.USERNAME || process.env.USER || 'System').trim() || 'System';
}

async function createAuditLog({
  req = null,
  actionType,
  entityType,
  entityId = null,
  entityCode = '',
  summary = '',
  beforeData = undefined,
  afterData = undefined,
  metadata = undefined,
  actorName = ''
}) {
  const normalizedActionType = normalizeActionType(actionType);
  const normalizedEntityType = String(entityType || '').trim() || 'unknown';
  const normalizedEntityCode = String(entityCode || '').trim() || null;
  const normalizedSummary = String(summary || '').trim() || null;
  const resolvedActorName = await resolveActorName(req, actorName);
  const actorUserId = req?.currentUser?.id ? Number(req.currentUser.id) : null;
  const actorUsername = req?.currentUser?.username ? String(req.currentUser.username).trim() : null;

  const result = await dbRun(
    `
    INSERT INTO audit_logs (
      entity_type,
      entity_id,
      entity_code,
      actor_user_id,
      actor_username,
      action_type,
      actor_name,
      summary,
      before_json,
      after_json,
      metadata_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      normalizedEntityType,
      entityId ? Number(entityId) : null,
      normalizedEntityCode,
      actorUserId,
      actorUsername,
      normalizedActionType,
      resolvedActorName,
      normalizedSummary,
      safeJson(beforeData),
      safeJson(afterData),
      safeJson(metadata)
    ]
  );

  return result.lastID;
}

function parseJsonField(value) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch (err) {
    return null;
  }
}

function mapAuditRow(row) {
  return {
    ...row,
    entity_id: row.entity_id ? Number(row.entity_id) : null,
    actor_user_id: row.actor_user_id ? Number(row.actor_user_id) : null,
    before_data: parseJsonField(row.before_json),
    after_data: parseJsonField(row.after_json),
    metadata: parseJsonField(row.metadata_json)
  };
}

async function listAuditLogs(filters = {}) {
  const params = [];
  const conditions = [];

  if (filters.entityType) {
    conditions.push('entity_type = ?');
    params.push(String(filters.entityType).trim());
  }

  if (filters.actionType) {
    conditions.push('action_type = ?');
    params.push(normalizeActionType(filters.actionType));
  }

  if (filters.actorName) {
    conditions.push('actor_name LIKE ?');
    params.push(`%${String(filters.actorName).trim()}%`);
  }

  if (filters.dateFrom) {
    conditions.push('DATE(action_at) >= DATE(?)');
    params.push(String(filters.dateFrom).trim());
  }

  if (filters.dateTo) {
    conditions.push('DATE(action_at) <= DATE(?)');
    params.push(String(filters.dateTo).trim());
  }

  const limit = Math.min(Math.max(Number(filters.limit || 200), 1), 1000);
  params.push(limit);

  const rows = await dbAll(
    `
    SELECT
      id,
      entity_type,
      entity_id,
      entity_code,
      actor_user_id,
      actor_username,
      action_type,
      actor_name,
      summary,
      before_json,
      after_json,
      metadata_json,
      action_at
    FROM audit_logs
    ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
    ORDER BY action_at DESC, id DESC
    LIMIT ?
    `,
    params
  );

  return rows.map(mapAuditRow);
}

async function getAuditLogById(auditLogId) {
  const row = await dbGet(
    `
    SELECT
      id,
      entity_type,
      entity_id,
      entity_code,
      actor_user_id,
      actor_username,
      action_type,
      actor_name,
      summary,
      before_json,
      after_json,
      metadata_json,
      action_at
    FROM audit_logs
    WHERE id = ?
    `,
    [auditLogId]
  );

  return row ? mapAuditRow(row) : null;
}

module.exports = {
  ALLOWED_ACTIONS,
  normalizeActionType,
  resolveActorName,
  createAuditLog,
  listAuditLogs,
  getAuditLogById
};
