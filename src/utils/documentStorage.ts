import type { KnowledgeDocument } from '../types/app';
import { extractDocumentText, PDF_TEXT_EXTRACTION_VERSION } from './documentIngestion';

const DATABASE_NAME = 'analyticore-document-store';
const DATABASE_VERSION = 1;
const DOCUMENTS_STORE = 'documents';
const persistedDocumentIds = new Set<string>();

const requestJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Network request failed.';
    throw new Error(`Unable to reach the local document database API. Start the app with "npm run dev". ${detail}`);
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
        ? body.error
        : `Request failed with status ${response.status}.`;
    throw new Error(message);
  }
  return body as T;
};

const toKnowledgeDocument = (record: Omit<KnowledgeDocument, 'uploadDate'> & { uploadDate: string }): KnowledgeDocument => ({
  ...record,
  uploadDate: new Date(record.uploadDate),
});

const openLegacyDatabase = (): Promise<IDBDatabase | undefined> => {
  if (!('indexedDB' in window)) return Promise.resolve(undefined);

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DOCUMENTS_STORE)) {
        database.createObjectStore(DOCUMENTS_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to access legacy browser documents.'));
    request.onblocked = () => reject(new Error('Legacy browser document storage is blocked by another app tab.'));
  });
};

const loadLegacyDocuments = async (): Promise<KnowledgeDocument[]> => {
  const database = await openLegacyDatabase();
  if (!database) return [];

  try {
    const transaction = database.transaction(DOCUMENTS_STORE, 'readonly');
    const request = transaction.objectStore(DOCUMENTS_STORE).getAll() as IDBRequest<KnowledgeDocument[]>;
    return await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Unable to read legacy browser documents.'));
    });
  } finally {
    database.close();
  }
};

const uploadDocument = async (document: KnowledgeDocument): Promise<void> => {
  if (!document.file) {
    throw new Error(`Cannot migrate ${document.name}: its original file is not available in browser storage.`);
  }

  const form = new FormData();
  const { file, persistenceError: _persistenceError, analyticsError: _analyticsError, ...metadata } = document;
  form.append('metadata', JSON.stringify(metadata));
  form.append('file', file, document.name);
  await requestJson('/api/documents', { method: 'POST', body: form });
  persistedDocumentIds.add(document.id);
};

const updateDocument = async (document: KnowledgeDocument): Promise<void> => {
  await requestJson(`/api/documents/${encodeURIComponent(document.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: document.content,
      status: document.status,
      tokenCount: document.tokenCount,
      error: document.error,
      pdfTextExtractionVersion: document.pdfTextExtractionVersion,
    }),
  });
};

const fetchStoredFile = async (documentId: string): Promise<Blob> => {
  const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}/file`);
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message =
      typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
        ? body.error
        : `Unable to download stored file (HTTP ${response.status}).`;
    throw new Error(message);
  }
  return response.blob();
};

export const loadStoredDocuments = async (): Promise<KnowledgeDocument[]> => {
  let documents = (
    await requestJson<Array<Omit<KnowledgeDocument, 'uploadDate'> & { uploadDate: string }>>('/api/documents')
  ).map(toKnowledgeDocument);
  documents.forEach((document) => persistedDocumentIds.add(document.id));

  const existingIds = new Set(documents.map((document) => document.id));
  const legacyDocuments = await loadLegacyDocuments();
  for (const legacyDocument of legacyDocuments) {
    if (!existingIds.has(legacyDocument.id)) {
      await uploadDocument(legacyDocument);
      existingIds.add(legacyDocument.id);
    }
  }

  if (legacyDocuments.length) {
    documents = (
      await requestJson<Array<Omit<KnowledgeDocument, 'uploadDate'> & { uploadDate: string }>>('/api/documents')
    ).map(toKnowledgeDocument);
    documents.forEach((document) => persistedDocumentIds.add(document.id));
  }

  const restoredDocuments: KnowledgeDocument[] = [];
  for (const document of documents) {
    if (document.status === 'indexing') {
      const interruptedDocument = {
        ...document,
        status: 'error' as const,
        error: 'Indexing stopped before the app closed. Download the file or upload it again to re-index.',
      };
      await updateDocument(interruptedDocument);
      restoredDocuments.push(interruptedDocument);
      continue;
    }

    const isOutdatedPdf =
      document.name.toLowerCase().endsWith('.pdf') &&
      document.hasFile &&
      document.status === 'ready' &&
      (document.pdfTextExtractionVersion ?? 0) < PDF_TEXT_EXTRACTION_VERSION;
    if (!isOutdatedPdf) {
      restoredDocuments.push(document);
      continue;
    }

    try {
      const blob = await fetchStoredFile(document.id);
      const file = new File([blob], document.name, { type: document.type });
      const content = await extractDocumentText(file);
      const refreshedDocument: KnowledgeDocument = {
        ...document,
        content,
        pdfTextExtractionVersion: PDF_TEXT_EXTRACTION_VERSION,
        analyticsError: undefined,
        persistenceError: undefined,
      };
      await updateDocument(refreshedDocument);
      restoredDocuments.push(refreshedDocument);
    } catch (error) {
      restoredDocuments.push({
        ...document,
        analyticsError: `Unable to read PDF table layout: ${getDocumentStorageError(error)}`,
      });
    }
  }

  return restoredDocuments;
};

export const saveStoredDocument = async (document: KnowledgeDocument): Promise<void> => {
  if (!persistedDocumentIds.has(document.id)) {
    await uploadDocument(document);
    return;
  }
  await updateDocument(document);
};

export const deleteStoredDocument = async (documentId: string): Promise<void> => {
  await requestJson<void>(`/api/documents/${encodeURIComponent(documentId)}`, {
    method: 'DELETE',
  });
  persistedDocumentIds.delete(documentId);
};

export const getDocumentStorageError = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return 'An unknown error prevented access to saved documents.';
};
