import 'dotenv/config';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
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

  const { id, name, size, type, uploadDate, status, tokenCount, pdfTextExtractionVersion } = metadata;
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

  return {
    id,
    name: safeName,
    size,
    type,
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

app.get('/api/health', async (_request, response, next) => {
  try {
    await pool.query('SELECT 1');
    response.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    next(error);
  }
});

app.get('/api/documents', async (_request, response, next) => {
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

app.get('/api/documents/:id/file', async (request, response, next) => {
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

app.post('/api/documents', upload.single('file'), async (request, response, next) => {
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
       ) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         size_bytes = VALUES(size_bytes),
         mime_type = VALUES(mime_type),
         original_file = VALUES(original_file),
         file_sha256 = VALUES(file_sha256),
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
        metadata.uploadDate,
        metadata.status,
        metadata.tokenCount,
        metadata.pdfTextExtractionVersion,
      ]
    );
    response.status(201).json({ id: metadata.id, fileSha256: checksum });
  } catch (error) {
    next(error);
  }
});

app.put('/api/documents/:id', async (request, response, next) => {
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
});

app.delete('/api/documents/:id', async (request, response, next) => {
  try {
    await pool.execute('DELETE FROM documents WHERE id = ?', [request.params.id]);
    response.status(204).end();
  } catch (error) {
    next(error);
  }
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
