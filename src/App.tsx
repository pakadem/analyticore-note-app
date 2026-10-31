import React, { useEffect, useState } from 'react';
import { ApiConfig, KnowledgeDocument, NavTab } from './types/app';
import Sidebar from './components/Sidebar';
import HomePage from './components/HomePage';
import DataUploadPage from './components/DataUploadPage';
import ApiConnectionPage from './components/ApiConnectionPage';
import AgentChatbox from './components/AgentChatbox';
import { getDocumentStorageError, loadStoredDocuments, saveStoredDocument } from './utils/documentStorage';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [documentsLoaded, setDocumentsLoaded] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [apiConfig, setApiConfig] = useState<ApiConfig>({
    hostUrl: 'http://127.0.0.1:11434',
    modelName: 'llama3.1:8b',
    temperature: 0.7,
    contextWindow: 4096,
    isConnected: true,
  });

  useEffect(() => {
    let active = true;

    void loadStoredDocuments()
      .then((storedDocuments) => {
        if (active) setDocuments(storedDocuments);
      })
      .catch((error: unknown) => {
        if (active) setStorageError(getDocumentStorageError(error));
      })
      .finally(() => {
        if (active) setDocumentsLoaded(true);
      });

    return () => {
      active = false;
    };
  }, []);

  const persistDocument = async (document: KnowledgeDocument): Promise<KnowledgeDocument> => {
    try {
      await saveStoredDocument(document);
      setStorageError(null);
      return { ...document, persistenceError: undefined };
    } catch (error) {
      const message = getDocumentStorageError(error);
      setStorageError(message);
      return { ...document, persistenceError: message };
    }
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: '#f8fafc' }}>
      {/* Left Navigation Sidebar */}
      <Sidebar activeTab={activeTab} onSelectTab={setActiveTab} />

      {/* Main Content Area */}
      <main style={{ flex: 1, padding: '32px', overflowY: 'auto' }}>
        {storageError && (
          <div
            role="alert"
            style={{ marginBottom: '20px', padding: '12px 16px', backgroundColor: '#fee2e2', color: '#991b1b', borderRadius: '8px' }}
          >
            MySQL document storage is unavailable: {storageError} New uploads may not be saved to the database.
          </div>
        )}
        {!documentsLoaded ? (
          <p role="status" style={{ color: '#64748b' }}>Restoring saved documents...</p>
        ) : (
          <>
            {activeTab === 'home' && <HomePage documents={documents} onOpenIngestion={() => setActiveTab('upload')} />}
            {activeTab === 'upload' && (
              <DataUploadPage
                documents={documents}
                onDocumentsChange={setDocuments}
                onPersistDocument={persistDocument}
              />
            )}
            {activeTab === 'api' && (
              <ApiConnectionPage config={apiConfig} onUpdateConfig={setApiConfig} />
            )}
          </>
        )}
      </main>

      {/* Floating Agentic AI Chatbox */}
      {documentsLoaded && <AgentChatbox apiConfig={apiConfig} documents={documents} />}
    </div>
  );
};

export default App;
