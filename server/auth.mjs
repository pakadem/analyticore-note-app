import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

export const SESSION_COOKIE_NAME = 'analyticore_session';
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
export const VALID_ROLES = new Set(['admin', 'writer', 'viewer']);

export const hashPassword = async (password) => {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = await scrypt(password, Buffer.from(salt, 'hex'), 64);
  return `scrypt:${salt}:${Buffer.from(derivedKey).toString('hex')}`;
};

export const verifyPassword = async (password, storedHash) => {
  if (typeof password !== 'string' || typeof storedHash !== 'string') return false;
  const parts = storedHash.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;

  const [, saltHex, hashHex] = parts;
  try {
    const saltBuffer = Buffer.from(saltHex, 'hex');
    const expectedBuffer = Buffer.from(hashHex, 'hex');
    const derivedKey = await scrypt(password, saltBuffer, expectedBuffer.length);
    const actualBuffer = Buffer.from(derivedKey);
    if (actualBuffer.length !== expectedBuffer.length) return false;
    return timingSafeEqual(actualBuffer, expectedBuffer);
  } catch {
    return false;
  }
};

export const hashSessionToken = (token) =>
  createHash('sha256').update(token).digest('hex');

export const parseCookies = (cookieHeader) => {
  const cookies = {};
  if (!cookieHeader || typeof cookieHeader !== 'string') return cookies;

  for (const segment of cookieHeader.split(';')) {
    const eqIndex = segment.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = segment.slice(0, eqIndex).trim();
    const rawVal = segment.slice(eqIndex + 1).trim();
    try {
      cookies[key] = decodeURIComponent(rawVal);
    } catch {
      cookies[key] = rawVal;
    }
  }
  return cookies;
};

export const extractSessionToken = (request) => {
  const cookies = parseCookies(request.headers.cookie);
  if (cookies[SESSION_COOKIE_NAME]) {
    return cookies[SESSION_COOKIE_NAME];
  }
  const authHeader = request.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return null;
};

export const setSessionCookie = (response, token) => {
  response.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`
  );
};

export const clearSessionCookie = (response) => {
  response.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
};

export const createUserSession = async (connection, userId) => {
  const token = randomBytes(32).toString('hex');
  const tokenHash = hashSessionToken(token);
  const sessionId = randomUUID();
  const expiresAtDate = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  const expiresAtMysql = expiresAtDate.toISOString().slice(0, 23).replace('T', ' ');

  await connection.execute(
    `INSERT INTO user_sessions (id, user_id, token_hash, expires_at)
     VALUES (?, ?, ?, ?)`,
    [sessionId, userId, tokenHash, expiresAtMysql]
  );

  return token;
};

export const serializeUser = (row) => ({
  id: row.id,
  username: row.username,
  email: row.email,
  fullName: row.full_name,
  jobTitle: row.job_title || '',
  bio: row.bio || '',
  role: row.role,
  isActive: Boolean(row.is_active),
  lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
  createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
  updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
});

export const validateUsername = (value) => {
  if (typeof value !== 'string') {
    throw new Error('Username is required.');
  }
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > 64 || !/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
    throw new Error('Username must be 3–64 characters and contain only letters, numbers, dots, underscores, or hyphens.');
  }
  return trimmed;
};

export const validateEmail = (value) => {
  if (typeof value !== 'string') {
    throw new Error('Email address is required.');
  }
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    throw new Error('Please provide a valid email address.');
  }
  return trimmed;
};

export const validateFullName = (value) => {
  if (typeof value !== 'string') {
    throw new Error('Full name is required.');
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 120) {
    throw new Error('Full name must be between 1 and 120 characters.');
  }
  return trimmed;
};

export const validatePassword = (value, label = 'Password') => {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) {
    throw new Error(`${label} must be between 8 and 128 characters.`);
  }
  return value;
};

export const validateRole = (value) => {
  if (typeof value !== 'string' || !VALID_ROLES.has(value)) {
    throw new Error('Role must be one of: admin, writer, viewer.');
  }
  return value;
};

export const validateOptionalText = (value, maxLength, fieldName) => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be text.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new Error(`${fieldName} cannot exceed ${maxLength} characters.`);
  }
  return trimmed || null;
};

export const getAuthenticatedSession = async (pool, request) => {
  const token = extractSessionToken(request);
  if (!token) return null;

  const tokenHash = hashSessionToken(token);
  const [rows] = await pool.execute(
    `SELECT u.id, u.username, u.email, u.full_name, u.job_title, u.bio,
            u.role, u.is_active, u.last_login_at, u.created_at, u.updated_at
     FROM user_sessions s
     INNER JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP(3)
     LIMIT 1`,
    [tokenHash]
  );

  const row = rows[0];
  if (!row || !row.is_active) {
    return null;
  }

  return {
    user: serializeUser(row),
    tokenHash,
  };
};

export const createAuthMiddlewares = (pool) => {
  const requireAuth = async (request, response, next) => {
    try {
      const session = await getAuthenticatedSession(pool, request);
      if (!session) {
        if (extractSessionToken(request)) {
          clearSessionCookie(response);
        }
        response.status(401).json({ error: 'Authentication required. Please sign in.' });
        return;
      }
      request.user = session.user;
      request.sessionTokenHash = session.tokenHash;
      next();
    } catch (error) {
      next(error);
    }
  };

  const requireRole = (...allowedRoles) => (request, response, next) => {
    if (!request.user) {
      response.status(401).json({ error: 'Authentication required. Please sign in.' });
      return;
    }
    if (!allowedRoles.includes(request.user.role)) {
      const message =
        allowedRoles.length === 1 && allowedRoles[0] === 'admin'
          ? 'Administrator privileges are required for this action.'
          : 'View-only users do not have write permissions for this action.';
      response.status(403).json({ error: message });
      return;
    }
    next();
  };

  return { requireAuth, requireRole };
};
