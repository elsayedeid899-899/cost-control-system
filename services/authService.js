const crypto = require('crypto');
const { dbAll, dbGet, dbRun } = require('../helpers/dbAsync');

const SESSION_COOKIE_NAME = 'ccs_session';
const SESSION_TTL_DAYS = 7;
const ROLE_LABELS = {
  admin: 'مدير النظام',
  manager: 'مدير',
  accounts: 'حسابات',
  inventory: 'مخزن',
  cashier: 'كاشير'
};

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeRole(value) {
  const normalizedValue = String(value || '').trim().toLowerCase();
  return ROLE_LABELS[normalizedValue] ? normalizedValue : 'cashier';
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const normalizedPassword = String(password || '');
  const hash = crypto.scryptSync(normalizedPassword, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, savedHash] = String(storedHash || '').split(':');

  if (!salt || !savedHash) {
    return false;
  }

  const candidateHash = crypto.scryptSync(String(password || ''), salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(candidateHash, 'hex'), Buffer.from(savedHash, 'hex'));
}

function sanitizeUser(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    username: row.username,
    display_name: row.display_name,
    role: row.role,
    role_label: ROLE_LABELS[row.role] || row.role,
    is_active: Number(row.is_active || 0),
    last_login_at: row.last_login_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  };
}

async function listUsers() {
  const rows = await dbAll(
    `
    SELECT
      id,
      username,
      display_name,
      role,
      is_active,
      last_login_at,
      created_at,
      updated_at
    FROM users
    ORDER BY id
    `
  );

  return rows.map(sanitizeUser);
}

async function getUserById(userId) {
  const row = await dbGet(
    `
    SELECT
      id,
      username,
      display_name,
      role,
      is_active,
      last_login_at,
      created_at,
      updated_at
    FROM users
    WHERE id = ?
    `,
    [userId]
  );

  return sanitizeUser(row);
}

async function getUserRecordByUsername(username) {
  return dbGet(
    `
    SELECT
      id,
      username,
      password_hash,
      display_name,
      role,
      is_active,
      last_login_at,
      created_at,
      updated_at
    FROM users
    WHERE username = ?
    `,
    [normalizeUsername(username)]
  );
}

async function authenticateUser(username, password) {
  const userRecord = await getUserRecordByUsername(username);

  if (!userRecord || !Number(userRecord.is_active || 0)) {
    return null;
  }

  if (!verifyPassword(password, userRecord.password_hash)) {
    return null;
  }

  return sanitizeUser(userRecord);
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + SESSION_TTL_DAYS);

  const result = await dbRun(
    `
    INSERT INTO user_sessions (
      user_id,
      session_token,
      expires_at,
      last_seen_at
    )
    VALUES (?, ?, ?, ?)
    `,
    [userId, token, expiresAt.toISOString(), now.toISOString()]
  );

  return {
    id: result.lastID,
    token,
    expires_at: expiresAt.toISOString()
  };
}

async function touchSession(token) {
  if (!token) {
    return;
  }

  await dbRun(
    `
    UPDATE user_sessions
    SET last_seen_at = ?
    WHERE session_token = ?
    `,
    [new Date().toISOString(), String(token)]
  );
}

async function getSessionUser(token) {
  const normalizedToken = String(token || '').trim();

  if (!normalizedToken) {
    return null;
  }

  const row = await dbGet(
    `
    SELECT
      s.id AS session_id,
      s.session_token,
      s.expires_at,
      s.last_seen_at,
      u.id,
      u.username,
      u.display_name,
      u.role,
      u.is_active,
      u.last_login_at,
      u.created_at,
      u.updated_at
    FROM user_sessions s
    INNER JOIN users u ON u.id = s.user_id
    WHERE s.session_token = ?
      AND DATETIME(s.expires_at) > DATETIME('now')
      AND u.is_active = 1
    `,
    [normalizedToken]
  );

  if (!row) {
    return null;
  }

  return {
    session_id: Number(row.session_id),
    session_token: row.session_token,
    expires_at: row.expires_at,
    last_seen_at: row.last_seen_at,
    user: sanitizeUser(row)
  };
}

async function destroySession(token) {
  const normalizedToken = String(token || '').trim();

  if (!normalizedToken) {
    return 0;
  }

  const result = await dbRun(`DELETE FROM user_sessions WHERE session_token = ?`, [normalizedToken]);
  return Number(result.changes || 0);
}

async function createUser({ username, password, displayName, role, isActive = true }) {
  const normalizedUsername = normalizeUsername(username);
  const normalizedDisplayName = String(displayName || '').trim();
  const normalizedRole = normalizeRole(role);
  const normalizedPassword = String(password || '');

  if (!normalizedUsername || !normalizedDisplayName || normalizedPassword.length < 4) {
    throw new Error('بيانات المستخدم غير مكتملة.');
  }

  const existingUser = await getUserRecordByUsername(normalizedUsername);

  if (existingUser) {
    throw new Error('اسم المستخدم موجود بالفعل.');
  }

  const result = await dbRun(
    `
    INSERT INTO users (
      username,
      password_hash,
      display_name,
      role,
      is_active,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `,
    [
      normalizedUsername,
      hashPassword(normalizedPassword),
      normalizedDisplayName,
      normalizedRole,
      isActive ? 1 : 0
    ]
  );

  return getUserById(result.lastID);
}

async function updateUser(userId, { displayName, role, isActive, password }) {
  const existingUser = await dbGet(
    `
    SELECT
      id,
      username,
      display_name,
      role,
      is_active,
      last_login_at,
      created_at,
      updated_at,
      password_hash
    FROM users
    WHERE id = ?
    `,
    [userId]
  );

  if (!existingUser) {
    throw new Error('المستخدم غير موجود.');
  }

  const normalizedDisplayName = String(displayName || existingUser.display_name || '').trim();
  const normalizedRole = normalizeRole(role || existingUser.role);
  const nextIsActive = isActive === undefined ? Number(existingUser.is_active || 0) : isActive ? 1 : 0;
  const nextPasswordHash =
    String(password || '').trim().length >= 4
      ? hashPassword(password)
      : existingUser.password_hash;

  await dbRun(
    `
    UPDATE users
    SET
      display_name = ?,
      role = ?,
      is_active = ?,
      password_hash = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `,
    [normalizedDisplayName, normalizedRole, nextIsActive, nextPasswordHash, userId]
  );

  return getUserById(userId);
}

async function markUserLogin(userId) {
  await dbRun(
    `
    UPDATE users
    SET last_login_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `,
    [userId]
  );
}

function parseCookies(cookieHeader = '') {
  return String(cookieHeader || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((accumulator, part) => {
      const separatorIndex = part.indexOf('=');

      if (separatorIndex === -1) {
        return accumulator;
      }

      const key = part.slice(0, separatorIndex).trim();
      const value = decodeURIComponent(part.slice(separatorIndex + 1).trim());
      accumulator[key] = value;
      return accumulator;
    }, {});
}

function buildSessionCookie(token) {
  const maxAgeSeconds = SESSION_TTL_DAYS * 24 * 60 * 60;
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function buildClearSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

module.exports = {
  SESSION_COOKIE_NAME,
  SESSION_TTL_DAYS,
  ROLE_LABELS,
  normalizeUsername,
  normalizeRole,
  hashPassword,
  verifyPassword,
  sanitizeUser,
  listUsers,
  getUserById,
  getUserRecordByUsername,
  authenticateUser,
  createSession,
  touchSession,
  getSessionUser,
  destroySession,
  createUser,
  updateUser,
  markUserLogin,
  parseCookies,
  buildSessionCookie,
  buildClearSessionCookie
};
