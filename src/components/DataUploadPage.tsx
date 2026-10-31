import React from 'react';
import { KnowledgeDocument } from '../types/app';
import {
  extractDocumentText,
  isSupportedDocument,
  MAX_DOCUMENT_SIZE,
  PDF_TEXT_EXTRACTION_VERSION,
} from '../utils/documentIngestion';

interface DataUploadPageProps {
  documents: KnowledgeDocument[];
  onDocumentsChange: React.Dispatch<React.SetStateAction<KnowledgeDocument[]>>;
  onPersistDocument: (document: KnowledgeDocument) => Promise<KnowledgeDocument>;
  onDeleteDocument: (documentId: string) => Promise<void>;
}

const downloadDocument = (document: KnowledgeDocument) => {
  if (!document.file) return;

  const url = URL.createObjectURL(document.file);
  const link = window.document.createElement('a');
  link.href = url;
  link.download = document.name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

export const DataUploadPage: React.FC<DataUploadPageProps> = ({
  documents,
  onDocumentsChange,
  onPersistDocument,
  onDeleteDocument,
}) => {
  const [downloadError, setDownloadError] = React.useState<string | null>(null);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  const [deletingDocumentIds, setDeletingDocumentIds] = React.useState<Set<string>>(new Set());

  const handleDownload = async (document: KnowledgeDocument) => {
    try {
      setDownloadError(null);
      if (document.file) {
        downloadDocument(document);
        return;
      }

      const response = await fetch(`/api/documents/${encodeURIComponent(document.id)}/file`);
      if (!response.ok) {
        const result: unknown = await response.json().catch(() => null);
        const message =
          typeof result === 'object' &&
          result !== null &&
          'error' in result &&
          typeof result.error === 'string'
            ? result.error
            : `Unable to download the file (HTTP ${response.status}).`;
        throw new Error(message);
      }

      const url = URL.createObjectURL(await response.blob());
      const link = window.document.createElement('a');
      link.href = url;
      link.download = document.name;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : 'Unable to download the file.');
    }
  };

  const handleDelete = async (document: KnowledgeDocument) => {
    if (document.status === 'indexing' || deletingDocumentIds.has(document.id)) return;
    if (!window.confirm(`Delete "${document.name}" and its stored data? This cannot be undone.`)) return;

    setDeleteError(null);
    setDeletingDocumentIds((current) => new Set(current).add(document.id));
    try {
      await onDeleteDocument(document.id);
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : `Unable to delete ${document.name}.`
      );
    } finally {
      setDeletingDocumentIds((current) => {
        const next = new Set(current);
        next.delete(document.id);
        return next;
      });
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';

    files.forEach((file) => {
      const document: KnowledgeDocument = {
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        type: file.type || file.name.split('.').pop()?.toLowerCase() || 'unknown',
        uploadDate: new Date(),
        status: 'indexing',
        content: '',
        file: file.slice(0, file.size, file.type),
        pdfTextExtractionVersion: file.name.toLowerCase().endsWith('.pdf')
          ? PDF_TEXT_EXTRACTION_VERSION
          : undefined,
      };

      onDocumentsChange((current) => [...current, document]);

      void (async () => {
        let validForStorage = false;
        try {
          if (!isSupportedDocument(file)) {
            throw new Error('Unsupported file type. Upload a PDF, CSV, or TXT file.');
          }
          if (file.size > MAX_DOCUMENT_SIZE) {
            throw new Error('File exceeds the 50 MB upload limit.');
          }

          validForStorage = true;
          const initiallyStored = await onPersistDocument(document);
          onDocumentsChange((current) =>
            current.map((item) => item.id === document.id ? initiallyStored : item)
          );

          const content = await extractDocumentText(file);
          if (!content) {
            throw new Error('The file contains no readable text.');
          }

          const readyDocument = {
            ...initiallyStored,
            content,
            status: 'ready' as const,
            tokenCount: Math.ceil(content.length / 4),
            error: undefined,
          };
          const storedReadyDocument = await onPersistDocument(readyDocument);
          onDocumentsChange((current) =>
            current.map((item) => item.id === document.id ? storedReadyDocument : item)
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unable to read this file.';
          const failedDocument = {
            ...document,
            status: 'error' as const,
            error: message,
          };
          const storedFailedDocument = validForStorage
            ? await onPersistDocument(failedDocument)
            : failedDocument;
          onDocumentsChange((current) =>
            current.map((item) =>
              item.id === document.id ? storedFailedDocument : item
            )
          );
        }
      })();
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 'bold' }}>Document & Dataset Ingestion</h1>
        <p style={{ color: '#64748b', fontSize: '0.875rem', marginTop: '4px' }}>
          Upload PDF, CSV, and TXT files up to 50 MB. Original files, extracted text, and metadata are saved in the local MySQL database.
        </p>
      </div>

      <div
        style={{
          border: '2px dashed #cbd5e1',
          borderRadius: '12px',
          padding: '40px',
          textAlign: 'center',
          backgroundColor: '#ffffff',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        }}
      >
        <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>📂</div>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 'bold' }}>Upload Files for AI Retrieval</h3>
        <p style={{ color: '#64748b', fontSize: '0.875rem', marginTop: '4px' }}>
          Supports selectable-text PDF, CSV, and TXT files up to 50 MB
        </p>
        <label
          style={{
            display: 'inline-block',
            marginTop: '20px',
            padding: '10px 20px',
            backgroundColor: '#0284c7',
            color: '#ffffff',
            borderRadius: '8px',
            fontWeight: '600',
            cursor: 'pointer',
            fontSize: '0.875rem',
          }}
        >
          Select Files
          <input
            type="file"
            accept=".pdf,.csv,.txt"
            multiple
            onChange={handleFileUpload}
            style={{ display: 'none' }}
          />
        </label>
      </div>

      <div style={{ backgroundColor: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '20px' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 'bold', marginBottom: '16px' }}>Ingested Knowledge Base</h3>
        {downloadError && (
          <p role="alert" style={{ color: '#b91c1c', fontSize: '0.875rem', marginBottom: '12px' }}>
            {downloadError}
          </p>
        )}
        {deleteError && (
          <p role="alert" style={{ color: '#b91c1c', fontSize: '0.875rem', marginBottom: '12px' }}>
            {deleteError}
          </p>
        )}
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #e2e8f0', textAlign: 'left', color: '#64748b', fontSize: '0.875rem' }}>
              <th style={{ padding: '12px 8px' }}>Filename</th>
              <th style={{ padding: '12px 8px' }}>Size</th>
              <th style={{ padding: '12px 8px' }}>File Format</th>
              <th style={{ padding: '12px 8px' }}>Indexed Tokens (est.)</th>
              <th style={{ padding: '12px 8px' }}>Ingestion Status</th>
              <th style={{ padding: '12px 8px' }}>Stored File</th>
              <th style={{ padding: '12px 8px' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {documents.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: '16px 8px', color: '#64748b', textAlign: 'center' }}>
                  No documents uploaded yet.
                </td>
              </tr>
            ) : (
              documents.map((doc) => (
                <tr key={doc.id} style={{ borderBottom: '1px solid #f1f5f9', fontSize: '0.875rem' }}>
                  <td style={{ padding: '12px 8px', fontWeight: '600', color: '#0f172a' }}>
                    {doc.name}
                    {doc.error && <div style={{ color: '#b91c1c', fontSize: '0.75rem' }}>{doc.error}</div>}
                  </td>
                  <td style={{ padding: '12px 8px', color: '#64748b' }}>{(doc.size / 1024).toFixed(1)} KB</td>
                  <td style={{ padding: '12px 8px', color: '#64748b' }}>{doc.type}</td>
                  <td style={{ padding: '12px 8px', color: '#0284c7', fontWeight: '600' }}>
                    {doc.tokenCount ? doc.tokenCount.toLocaleString() : doc.status === 'indexing' ? 'Reading...' : '—'}
                  </td>
                  <td style={{ padding: '12px 8px' }}>
                    <span
                      style={{
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        fontWeight: 'bold',
                        backgroundColor:
                          doc.status === 'ready' ? '#dcfce7' : doc.status === 'error' ? '#fee2e2' : '#fef3c7',
                        color: doc.status === 'ready' ? '#15803d' : doc.status === 'error' ? '#b91c1c' : '#b45309',
                      }}
                    >
                      {doc.status.toUpperCase()}
                    </span>
                  </td>
                  <td style={{ padding: '12px 8px' }}>
                    {doc.file || doc.hasFile ? (
                      <button
                        type="button"
                        onClick={() => void handleDownload(doc)}
                        style={{ padding: '6px 10px', backgroundColor: '#e0f2fe', color: '#075985', border: 0, borderRadius: '6px', cursor: 'pointer' }}
                      >
                        Download
                      </button>
                    ) : (
                      <span style={{ color: '#64748b' }}>Unavailable</span>
                    )}
                    {doc.persistenceError && (
                      <div style={{ color: '#b91c1c', fontSize: '0.75rem', marginTop: '4px' }}>
                        Not saved: {doc.persistenceError}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '12px 8px' }}>
                    <button
                      type="button"
                      onClick={() => void handleDelete(doc)}
                      disabled={doc.status === 'indexing' || deletingDocumentIds.has(doc.id)}
                      aria-label={`Delete ${doc.name}`}
                      style={{
                        padding: '6px 10px',
                        backgroundColor: '#fee2e2',
                        color: '#991b1b',
                        border: 0,
                        borderRadius: '6px',
                        cursor: doc.status === 'indexing' || deletingDocumentIds.has(doc.id)
                          ? 'not-allowed'
                          : 'pointer',
                        opacity: doc.status === 'indexing' || deletingDocumentIds.has(doc.id) ? 0.6 : 1,
                      }}
                    >
                      {deletingDocumentIds.has(doc.id) ? 'Deleting…' : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default DataUploadPage;
