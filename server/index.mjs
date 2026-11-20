import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import {
  clearSessionCookie,
  createAuthMiddlewares,
  createUserSession,
  extractSessionToken,
  getAuthenticatedSession,
  hashPassword,
  hashSessionToken,
  serializeUser,
  setSessionCookie,
  validateEmail,
  validateFullName,
  validateOptionalText,
  validatePassword,
  validateRole,
  validateUsername,
  verifyPassword,
} from './auth.mjs';
import { initializeDatabase, pool } from './db.mjs';

const PORT = Number(process.env.API_PORT || 3002);
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_TEXT_SIZE = 100 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set(['pdf', 'csv', 'txt']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1, fields: 1, fieldSize: 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    const extension = file.originalname.split('.').pop()?.toLowerCase();
    if (!extension || !SUPPORTED_EXTENSIONS.has(extension)) {
      callback(new Error('Unsupported file type. Upload a PDF, CSV, or TXT file.'));
      return;
    }
    callback(null, true);
  },
});

const app = express();
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const { requireAuth, requireRole } = createAuthMiddlewares(pool);

app.disable('x-powered-by');
app.use(express.json({ limit: '128mb' }));

const formatDateForMysql = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Document uploadDate must be a valid date.');
  }
  return date.toISOString().slice(0, 23).replace('T', ' ');
};

const validateDocumentMetadata = (metadata, file) => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error('Document metadata is required.');
  }

  const { id, name, size, type, uploadDate, status, tokenCount, pdfTextExtractionVersion, content } = metadata;
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) {
    throw new Error('Document id must be a UUID.');
  }

  const safeName = typeof name === 'string' ? name.replaceAll('\\', '/').split('/').pop() : '';
  if (!safeName || safeName.length > 255 || safeName.includes('\0')) {
    throw new Error('Document filename is invalid.');
  }

  const extension = safeName.split('.').pop()?.toLowerCase();
  if (!extension || !SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error('Unsupported file type. Upload a PDF, CSV, or TXT file.');
  }
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_FILE_SIZE) {
    throw new Error('File exceeds the 50 MB upload limit.');
  }
  if (file && (file.size !== size || file.size > MAX_FILE_SIZE)) {
    throw new Error('Uploaded file size does not match its metadata or exceeds the 50 MB limit.');
  }
  if (typeof type !== 'string' || type.length > 255) {
    throw new Error('Document MIME type is invalid.');
  }
  if (typeof uploadDate !== 'string') {
    throw new Error('Document uploadDate must be a valid date string.');
  }
  if (!['indexing', 'ready', 'error'].includes(status)) {
    throw new Error('Document status is invalid.');
  }
  const safeContent = typeof content === 'string' && Buffer.byteLength(content, 'utf8') <= MAX_TEXT_SIZE
    ? content
    : '';

  return {
    id,
    name: safeName,
    size,
    type,
    content: safeContent,
    uploadDate: formatDateForMysql(uploadDate),
    status,
    tokenCount: Number.isSafeInteger(tokenCount) && tokenCount >= 0 ? tokenCount : null,
    pdfTextExtractionVersion:
      Number.isSafeInteger(pdfTextExtractionVersion) && pdfTextExtractionVersion >= 0
        ? pdfTextExtractionVersion
        : null,
  };
};

const chunkText = (content, chunkSize = 1200, overlap = 200) => {
  const chunks = [];
  const step = chunkSize - overlap;
  for (let start = 0; start < content.length; start += step) {
    const chunk = content.slice(start, start + chunkSize).trim();
    if (chunk) chunks.push(chunk);
  }
  return chunks;
};

const replaceDocumentChunks = async (connection, documentId, content) => {
  await connection.execute('DELETE FROM document_chunks WHERE document_id = ?', [documentId]);
  const chunks = chunkText(content);
  for (let start = 0; start < chunks.length; start += 500) {
    await connection.query(
      'INSERT INTO document_chunks (document_id, chunk_index, content) VALUES ?',
      [
        chunks
          .slice(start, start + 500)
          .map((chunk, index) => [documentId, start + index, chunk]),
      ]
    );
  }
};

// ---------------------------------------------------------------------------
// Health & Authentication Routes
// ---------------------------------------------------------------------------

app.get('/api/health', async (_request, response, next) => {
  try {
    await pool.query('SELECT 1');
    response.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    next(error);
  }
});

app.get('/api/auth/status', async (request, response, next) => {
  try {
    await pool.execute('DELETE FROM user_sessions WHERE expires_at <= UTC_TIMESTAMP(3)');
    const [countRows] = await pool.query('SELECT COUNT(*) AS count FROM users');
    const hasUsers = Number(countRows[0]?.count ?? 0) > 0;

    const session = hasUsers ? await getAuthenticatedSession(pool, request) : null;
    if (!session && extractSessionToken(request)) {
      clearSessionCookie(response);
    }

    response.json({
      hasUsers,
      user: session ? session.user : null,
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/setup', async (request, response, next) => {
  try {
    let username, email, fullName, password, jobTitle;
    try {
      username = validateUsername(request.body?.username);
      email = validateEmail(request.body?.email);
      fullName = validateFullName(request.body?.fullName);
      password = validatePassword(request.body?.password);
      jobTitle = validateOptionalText(request.body?.jobTitle, 120, 'Job title');
    } catch (validationError) {
      response.status(400).json({ error: validationError instanceof Error ? validationError.message : 'Invalid input.' });
      return;
    }

    const passwordHash = await hashPassword(password);
    const userId = randomUUID();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
      const [existingUsers] = await connection.query('SELECT id FROM users LIMIT 1 FOR UPDATE');
      if (existingUsers.length > 0) {
        await connection.rollback();
        response.status(403).json({ error: 'Initial administrator setup has already been completed. Please sign in.' });
        return;
      }

      await connection.execute(
        `INSERT INTO users (id, username, email, full_name, job_title, password_hash, role, is_active, last_login_at)
         VALUES (?, ?, ?, ?, ?, ?, 'admin', 1, UTC_TIMESTAMP(3))`,
        [userId, username, email, fullName, jobTitle, passwordHash]
      );

      const sessionToken = await createUserSession(connection, userId);
      const [rows] = await connection.execute('SELECT * FROM users WHERE id = ?', [userId]);
      await connection.commit();

      setSessionCookie(response, sessionToken);
      response.status(201).json({ user: serializeUser(rows[0]) });
    } catch (txError) {
      await connection.rollback();
      throw txError;
    } finally {
      connection.release();
    }
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/login', async (request, response, next) => {
  try {
    const rawIdentifier = typeof request.body?.identifier === 'string' ? request.body.identifier.trim() : '';
    const password = typeof request.body?.password === 'string' ? request.body.password : '';

    if (!rawIdentifier || !password) {
      response.status(400).json({ error: 'Username/email and password are required.' });
      return;
    }

    const [rows] = await pool.execute(
      'SELECT * FROM users WHERE username = ? OR email = ? LIMIT 1',
      [rawIdentifier, rawIdentifier.toLowerCase()]
    );
    const userRow = rows[0];

    if (!userRow || !(await verifyPassword(password, userRow.password_hash))) {
      response.status(401).json({ error: 'Invalid username/email or password.' });
      return;
    }

    if (!userRow.is_active) {
      response.status(403).json({ error: 'This account has been deactivated. Contact an administrator.' });
      return;
    }

    await pool.execute(
      'UPDATE users SET last_login_at = UTC_TIMESTAMP(3) WHERE id = ?',
      [userRow.id]
    );
    const sessionToken = await createUserSession(pool, userRow.id);
    const [updatedRows] = await pool.execute('SELECT * FROM users WHERE id = ?', [userRow.id]);

    setSessionCookie(response, sessionToken);
    response.json({ user: serializeUser(updatedRows[0]) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/logout', async (request, response, next) => {
  try {
    const token = extractSessionToken(request);
    if (token) {
      const tokenHash = hashSessionToken(token);
      await pool.execute('DELETE FROM user_sessions WHERE token_hash = ?', [tokenHash]);
    }
    clearSessionCookie(response);
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Authenticated User Profile Routes (All 3 Roles)
// ---------------------------------------------------------------------------

app.get('/api/profile', requireAuth, async (request, response) => {
  response.json({ user: request.user });
});

app.put('/api/profile', requireAuth, async (request, response, next) => {
  try {
    let fullName, username, email, jobTitle, bio;
    try {
      fullName = validateFullName(request.body?.fullName);
      username = validateUsername(request.body?.username);
      email = validateEmail(request.body?.email);
      jobTitle = validateOptionalText(request.body?.jobTitle, 120, 'Job title');
      bio = validateOptionalText(request.body?.bio, 1000, 'Bio');
    } catch (validationError) {
      response.status(400).json({ error: validationError instanceof Error ? validationError.message : 'Invalid profile details.' });
      return;
    }

    const [conflicts] = await pool.execute(
      'SELECT username, email FROM users WHERE (username = ? OR email = ?) AND id <> ? LIMIT 1',
      [username, email, request.user.id]
    );
    if (conflicts.length > 0) {
      const conflict = conflicts[0];
      const message =
        conflict.username.toLowerCase() === username.toLowerCase()
          ? 'That username is already in use.'
          : 'That email address is already registered.';
      response.status(409).json({ error: message });
      return;
    }

    await pool.execute(
      `UPDATE users
       SET full_name = ?, username = ?, email = ?, job_title = ?, bio = ?
       WHERE id = ?`,
      [fullName, username, email, jobTitle, bio, request.user.id]
    );

    const [rows] = await pool.execute('SELECT * FROM users WHERE id = ?', [request.user.id]);
    response.json({ user: serializeUser(rows[0]) });
  } catch (error) {
    next(error);
  }
});

app.put('/api/profile/password', requireAuth, async (request, response, next) => {
  try {
    const currentPassword = typeof request.body?.currentPassword === 'string' ? request.body.currentPassword : '';
    if (!currentPassword) {
      response.status(400).json({ error: 'Current password is required.' });
      return;
    }

    let newPassword;
    try {
      newPassword = validatePassword(request.body?.newPassword, 'New password');
    } catch (validationError) {
      response.status(400).json({ error: validationError instanceof Error ? validationError.message : 'Invalid password.' });
      return;
    }

    const [rows] = await pool.execute('SELECT password_hash FROM users WHERE id = ?', [request.user.id]);
    const userRow = rows[0];
    if (!userRow || !(await verifyPassword(currentPassword, userRow.password_hash))) {
      response.status(400).json({ error: 'Current password is incorrect.' });
      return;
    }

    const newPasswordHash = await hashPassword(newPassword);
    await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [newPasswordHash, request.user.id]);
    await pool.execute(
      'DELETE FROM user_sessions WHERE user_id = ? AND token_hash <> ?',
      [request.user.id, request.sessionTokenHash]
    );

    response.json({ status: 'ok' });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// User Administration Routes (Admin Only)
// ---------------------------------------------------------------------------

app.get('/api/users', requireAuth, requireRole('admin'), async (_request, response, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM users
       ORDER BY FIELD(role, 'admin', 'writer', 'viewer'), created_at ASC`
    );
    response.json(rows.map(serializeUser));
  } catch (error) {
    next(error);
  }
});

app.post('/api/users', requireAuth, requireRole('admin'), async (request, response, next) => {
  try {
    let username, email, fullName, password, role, jobTitle, bio;
    try {
      username = validateUsername(request.body?.username);
      email = validateEmail(request.body?.email);
      fullName = validateFullName(request.body?.fullName);
      password = validatePassword(request.body?.password);
      role = validateRole(request.body?.role);
      jobTitle = validateOptionalText(request.body?.jobTitle, 120, 'Job title');
      bio = validateOptionalText(request.body?.bio, 1000, 'Bio');
    } catch (validationError) {
      response.status(400).json({ error: validationError instanceof Error ? validationError.message : 'Invalid user details.' });
      return;
    }

    const [conflicts] = await pool.execute(
      'SELECT username, email FROM users WHERE username = ? OR email = ? LIMIT 1',
      [username, email]
    );
    if (conflicts.length > 0) {
      const conflict = conflicts[0];
      const message =
        conflict.username.toLowerCase() === username.toLowerCase()
          ? 'That username is already in use.'
          : 'That email address is already registered.';
      response.status(409).json({ error: message });
      return;
    }

    const userId = randomUUID();
    const passwordHash = await hashPassword(password);
    await pool.execute(
      `INSERT INTO users (id, username, email, full_name, job_title, bio, password_hash, role, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [userId, username, email, fullName, jobTitle, bio, passwordHash, role]
    );

    const [rows] = await pool.execute('SELECT * FROM users WHERE id = ?', [userId]);
    response.status(201).json({ user: serializeUser(rows[0]) });
  } catch (error) {
    next(error);
  }
});

app.put('/api/users/:id', requireAuth, requireRole('admin'), async (request, response, next) => {
  try {
    const targetId = request.params.id;
    let username, email, fullName, role, jobTitle, bio, newPassword;
    const isActive = request.body?.isActive === undefined ? true : Boolean(request.body.isActive);

    try {
      username = validateUsername(request.body?.username);
      email = validateEmail(request.body?.email);
      fullName = validateFullName(request.body?.fullName);
      role = validateRole(request.body?.role);
      jobTitle = validateOptionalText(request.body?.jobTitle, 120, 'Job title');
      bio = validateOptionalText(request.body?.bio, 1000, 'Bio');
      if (typeof request.body?.newPassword === 'string' && request.body.newPassword.length > 0) {
        newPassword = validatePassword(request.body.newPassword, 'New password');
      }
    } catch (validationError) {
      response.status(400).json({ error: validationError instanceof Error ? validationError.message : 'Invalid user details.' });
      return;
    }

    if (targetId === request.user.id) {
      if (!isActive) {
        response.status(400).json({ error: 'You cannot deactivate your own account.' });
        return;
      }
      if (role !== 'admin') {
        response.status(400).json({ error: 'You cannot remove your own administrator role.' });
        return;
      }
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [existingRows] = await connection.execute(
        'SELECT * FROM users WHERE id = ? FOR UPDATE',
        [targetId]
      );
      const existingUser = existingRows[0];
      if (!existingUser) {
        await connection.rollback();
        response.status(404).json({ error: 'User account not found.' });
        return;
      }

      if (existingUser.role === 'admin' && existingUser.is_active && (role !== 'admin' || !isActive)) {
        const [adminCountRows] = await connection.query(
          "SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND is_active = 1"
        );
        if (Number(adminCountRows[0]?.count ?? 0) <= 1) {
          await connection.rollback();
          response.status(400).json({ error: 'At least one active administrator account must remain.' });
          return;
        }
      }

      const [conflicts] = await connection.execute(
        'SELECT username, email FROM users WHERE (username = ? OR email = ?) AND id <> ? LIMIT 1',
        [username, email, targetId]
      );
      if (conflicts.length > 0) {
        await connection.rollback();
        const conflict = conflicts[0];
        const message =
          conflict.username.toLowerCase() === username.toLowerCase()
            ? 'That username is already in use.'
            : 'That email address is already registered.';
        response.status(409).json({ error: message });
        return;
      }

      if (newPassword) {
        const passwordHash = await hashPassword(newPassword);
        await connection.execute(
          `UPDATE users
           SET username = ?, email = ?, full_name = ?, job_title = ?, bio = ?,
               role = ?, is_active = ?, password_hash = ?
           WHERE id = ?`,
          [username, email, fullName, jobTitle, bio, role, isActive ? 1 : 0, passwordHash, targetId]
        );
      } else {
        await connection.execute(
          `UPDATE users
           SET username = ?, email = ?, full_name = ?, job_title = ?, bio = ?,
               role = ?, is_active = ?
           WHERE id = ?`,
          [username, email, fullName, jobTitle, bio, role, isActive ? 1 : 0, targetId]
        );
      }

      if (!isActive || (newPassword && targetId !== request.user.id)) {
        await connection.execute('DELETE FROM user_sessions WHERE user_id = ?', [targetId]);
      }

      const [updatedRows] = await connection.execute('SELECT * FROM users WHERE id = ?', [targetId]);
      await connection.commit();
      response.json({ user: serializeUser(updatedRows[0]) });
    } catch (txError) {
      await connection.rollback();
      throw txError;
    } finally {
      connection.release();
    }
  } catch (error) {
    next(error);
  }
});

app.delete('/api/users/:id', requireAuth, requireRole('admin'), async (request, response, next) => {
  try {
    const targetId = request.params.id;
    if (targetId === request.user.id) {
      response.status(400).json({ error: 'You cannot delete your own account.' });
      return;
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [existingRows] = await connection.execute(
        'SELECT id, role, is_active FROM users WHERE id = ? FOR UPDATE',
        [targetId]
      );
      const existingUser = existingRows[0];
      if (!existingUser) {
        await connection.rollback();
        response.status(404).json({ error: 'User account not found.' });
        return;
      }

      if (existingUser.role === 'admin' && existingUser.is_active) {
        const [adminCountRows] = await connection.query(
          "SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND is_active = 1"
        );
        if (Number(adminCountRows[0]?.count ?? 0) <= 1) {
          await connection.rollback();
          response.status(400).json({ error: 'At least one active administrator account must remain.' });
          return;
        }
      }

      await connection.execute('DELETE FROM users WHERE id = ?', [targetId]);
      await connection.commit();
      response.status(204).end();
    } catch (txError) {
      await connection.rollback();
      throw txError;
    } finally {
      connection.release();
    }
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Document Storage Routes (RBAC Protected)
// ---------------------------------------------------------------------------

app.get('/api/documents', requireAuth, async (_request, response, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, size_bytes, mime_type, extracted_text, upload_date, status,
              token_count, error_message, pdf_text_extraction_version,
              original_file IS NOT NULL AS has_file
       FROM documents
       ORDER BY upload_date, id`
    );
    response.json(
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        size: Number(row.size_bytes),
        type: row.mime_type,
        content: row.extracted_text,
        uploadDate: new Date(row.upload_date).toISOString(),
        status: row.status,
        tokenCount: row.token_count,
        error: row.error_message,
        pdfTextExtractionVersion: row.pdf_text_extraction_version,
        hasFile: Boolean(row.has_file),
      }))
    );
  } catch (error) {
    next(error);
  }
});

app.get('/api/documents/:id/file', requireAuth, async (request, response, next) => {
  try {
    const [rows] = await pool.execute(
      'SELECT name, mime_type, original_file FROM documents WHERE id = ?',
      [request.params.id]
    );
    const document = rows[0];
    if (!document?.original_file) {
      response.status(404).json({ error: 'The original uploaded file was not found.' });
      return;
    }

    response.set({
      'Content-Type': document.mime_type || 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(document.name)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
    response.send(document.original_file);
  } catch (error) {
    next(error);
  }
});

app.post(
  '/api/documents',
  requireAuth,
  requireRole('admin', 'writer'),
  upload.single('file'),
  async (request, response, next) => {
    try {
      if (!request.file) {
        response.status(400).json({ error: 'The original uploaded file is required.' });
        return;
      }
      let metadata;
      try {
        metadata = validateDocumentMetadata(JSON.parse(request.body.metadata), request.file);
      } catch (error) {
        response.status(400).json({ error: error instanceof Error ? error.message : 'Invalid metadata.' });
        return;
      }

      const checksum = createHash('sha256').update(request.file.buffer).digest('hex');
      await pool.execute(
        `INSERT INTO documents (
           id, name, size_bytes, mime_type, original_file, file_sha256, extracted_text,
           upload_date, status, token_count, pdf_text_extraction_version
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           name = VALUES(name),
           size_bytes = VALUES(size_bytes),
           mime_type = VALUES(mime_type),
           original_file = VALUES(original_file),
           file_sha256 = VALUES(file_sha256),
           extracted_text = VALUES(extracted_text),
           upload_date = VALUES(upload_date),
           status = VALUES(status),
           token_count = VALUES(token_count),
           pdf_text_extraction_version = VALUES(pdf_text_extraction_version),
           error_message = NULL`,
        [
          metadata.id,
          metadata.name,
          metadata.size,
          metadata.type,
          request.file.buffer,
          checksum,
          metadata.content,
          metadata.uploadDate,
          metadata.status,
          metadata.tokenCount,
          metadata.pdfTextExtractionVersion,
        ]
      );
      if (metadata.content) {
        await replaceDocumentChunks(pool, metadata.id, metadata.content);
      }
      response.status(201).json({ id: metadata.id, fileSha256: checksum });
    } catch (error) {
      next(error);
    }
  }
);

app.put(
  '/api/documents/:id',
  requireAuth,
  requireRole('admin', 'writer'),
  async (request, response, next) => {
    try {
      const { content, status, tokenCount, error, pdfTextExtractionVersion } = request.body ?? {};
      if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > MAX_TEXT_SIZE) {
        response.status(400).json({ error: 'Extracted document text is missing or exceeds the 100 MB limit.' });
        return;
      }
      if (!['indexing', 'ready', 'error'].includes(status)) {
        response.status(400).json({ error: 'Document status is invalid.' });
        return;
      }
      if (
        error !== undefined &&
        error !== null &&
        (typeof error !== 'string' || Buffer.byteLength(error, 'utf8') > 60_000)
      ) {
        response.status(400).json({ error: 'Document error must be text.' });
        return;
      }

      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [documents] = await connection.execute(
          'SELECT id FROM documents WHERE id = ? FOR UPDATE',
          [request.params.id]
        );
        if (!documents.length) {
          await connection.rollback();
          response.status(404).json({ error: 'Document not found in the database.' });
          return;
        }

        await connection.execute(
          `UPDATE documents
           SET extracted_text = ?, status = ?, token_count = ?, error_message = ?,
               pdf_text_extraction_version = ?
           WHERE id = ?`,
          [
            content,
            status,
            Number.isSafeInteger(tokenCount) && tokenCount >= 0 ? tokenCount : null,
            error || null,
            Number.isSafeInteger(pdfTextExtractionVersion) && pdfTextExtractionVersion >= 0
              ? pdfTextExtractionVersion
              : null,
            request.params.id,
          ]
        );
        await replaceDocumentChunks(connection, request.params.id, content);
        await connection.commit();
        response.json({ id: request.params.id, status });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } catch (error) {
      next(error);
    }
  }
);

app.delete(
  '/api/documents/:id',
  requireAuth,
  requireRole('admin', 'writer'),
  async (request, response, next) => {
    try {
      await pool.execute('DELETE FROM documents WHERE id = ?', [request.params.id]);
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  }
);

app.post('/api/external-api', requireAuth, async (request, response, next) => {
  try {
    const { url, headers } = request.body ?? {};
    if (typeof url !== 'string') {
      response.status(400).json({ error: 'API URL is required.' });
      return;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      response.status(400).json({ error: 'Enter a valid HTTP or HTTPS API URL.' });
      return;
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      response.status(400).json({ error: 'Only HTTP and HTTPS API URLs are allowed.' });
      return;
    }

    const hostname = parsedUrl.hostname.toLowerCase();
    const privateAddress =
      hostname === 'localhost'
      || hostname.endsWith('.localhost')
      || hostname === '::1'
      || /^127(?:\.\d{1,3}){3}$/.test(hostname)
      || /^10(?:\.\d{1,3}){3}$/.test(hostname)
      || /^192\.168(?:\.\d{1,3}){2}$/.test(hostname)
      || /^172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}$/.test(hostname)
      || /^169\.254(?:\.\d{1,3}){2}$/.test(hostname);
    if (privateAddress) {
      response.status(400).json({ error: 'Private and local network addresses are not allowed.' });
      return;
    }

    if (typeof headers !== 'object' || headers === null || Array.isArray(headers)) {
      response.status(400).json({ error: 'Request headers must be an object.' });
      return;
    }

    const forbiddenHeaders = new Set([
      'host',
      'content-length',
      'transfer-encoding',
      'connection',
      'cookie',
      'proxy-authorization',
    ]);
    const requestHeaders = {};
    for (const [key, value] of Object.entries(headers)) {
      if (
        typeof key === 'string'
        && key.trim()
        && typeof value === 'string'
        && !forbiddenHeaders.has(key.trim().toLowerCase())
      ) {
        requestHeaders[key.trim()] = value;
      }
    }

    const upstream = await fetch(parsedUrl, {
      method: 'GET',
      headers: requestHeaders,
      signal: AbortSignal.timeout(30_000),
    });
    const contentType = upstream.headers.get('content-type') || '';
    const bodyText = await upstream.text();

    if (contentType.includes('json')) {
      try {
        response.status(upstream.status).json(JSON.parse(bodyText));
        return;
      } catch {
        // Fall through and return the text with an appropriate error status.
      }
    }
    response.status(upstream.status).type(contentType || 'text/plain').send(bodyText);
  } catch (error) {
    if (error?.name === 'TimeoutError') {
      response.status(504).json({ error: 'The external API timed out.' });
      return;
    }
    next(error);
  }
});

app.all('/api/{*path}', (_request, response) => {
  response.status(404).json({ error: 'API endpoint not found.' });
});

if (existsSync(path.join(projectRoot, 'dist', 'index.html'))) {
  app.use(express.static(path.join(projectRoot, 'dist')));
  app.get('/{*path}', (_request, response) => {
    response.sendFile(path.join(projectRoot, 'dist', 'index.html'));
  });
}

app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    response.status(413).json({ error: 'File exceeds the 50 MB upload limit.' });
    return;
  }
  if (error instanceof multer.MulterError || error.message?.startsWith('Unsupported file type.')) {
    response.status(400).json({ error: error.message });
    return;
  }
  if (error?.type === 'entity.too.large') {
    response.status(413).json({ error: 'The request exceeds the API size limit.' });
    return;
  }
  if (error instanceof SyntaxError && 'body' in error) {
    response.status(400).json({ error: 'Request body contains invalid JSON.' });
    return;
  }
  console.error('API request failed:', error);
  response.status(500).json({ error: 'The database request failed. Check the local API logs.' });
});

await initializeDatabase();
const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`AnalytiCore API listening on http://127.0.0.1:${PORT}`);
});

const shutdown = () => {
  server.close(() => {
    void pool.end().then(() => process.exit(0));
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
