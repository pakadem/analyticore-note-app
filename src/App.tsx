import React, { useCallback, useEffect, useState } from 'react';
import { ApiConfig, KnowledgeDocument, NavTab, UserAccount } from './types/app';
import Sidebar from './components/Sidebar';
import HomePage from './components/HomePage';
import DataUploadPage from './components/DataUploadPage';
import ApiConnectionPage from './components/ApiConnectionPage';
import ProfilePage from './components/ProfilePage';
import UserManagementPage from './components/UserManagementPage';
import AuthPage from './components/AuthPage';
import AgentChatbox from './components/AgentChatbox';
import {
  canManageUsers,
  canUserWrite,
  fetchAuthStatus,
  logoutUser,
} from './utils/authApi';
import {
  deleteStoredDocument,
  getDocumentStorageError,
  loadStoredDocuments,
  resetDocumentStorageCache,
  saveStoredDocument,
} from './utils/documentStorage';

export const App: React.FC = () => {
  const [authLoading, setAuthLoading] = useState(true);
  const [hasUsers, setHasUsers] = useState(true);
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(null);
  const [authConnectionError, setAuthConnectionError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [documentsLoaded, setDocumentsLoaded] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [apiConfig, setApiConfig] = useState<ApiConfig>({
    hostUrl: 'http://localhost:11434',
    modelName: 'llama3.1:8b',
    temperature: 0.7,
    contextWindow: 16384,
    isConnected: true,
  });

  const checkAuth = useCallback(async () => {
    setAuthLoading(true);
    setAuthConnectionError(null);
    try {
      const status = await fetchAuthStatus();
      setHasUsers(status.hasUsers);
      setCurrentUser(status.user);
    } catch (error) {
      setAuthConnectionError(
        error instanceof Error ? error.message : 'Unable to verify authentication status.'
      );
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  const userCanWrite = currentUser ? canUserWrite(currentUser.role) : false;
  const userIsAdmin = currentUser ? canManageUsers(currentUser.role) : false;

  useEffect(() => {
    if (!currentUser) {
      setDocuments([]);
      setDocumentsLoaded(false);
      setStorageError(null);
      return;
    }

    let active = true;
    setDocumentsLoaded(false);

    void loadStoredDocuments(canUserWrite(currentUser.role))
      .then((storedDocuments) => {
        if (active) {
          setDocuments(storedDocuments);
          setStorageError(null);
        }
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
  }, [currentUser?.id, currentUser?.role]);

  const handleAuthenticated = (user: UserAccount) => {
    setHasUsers(true);
    setAuthConnectionError(null);
    setCurrentUser(user);
    setActiveTab('home');
  };

  const handleLogout = async () => {
    try {
      await logoutUser();
    } catch {
      // Clear local session state even if network request fails
    }
    resetDocumentStorageCache();
    setCurrentUser(null);
    setDocuments([]);
    setDocumentsLoaded(false);
    setActiveTab('home');
  };

  const handleSelectTab = (tab: NavTab) => {
    if (tab === 'users' && !userIsAdmin) {
      setActiveTab('profile');
      return;
    }
    setActiveTab(tab);
  };

  const handleUpdateApiConfig = (nextConfig: ApiConfig) => {
    if (!userCanWrite) return;
    setApiConfig(nextConfig);
  };

  const persistDocument = async (document: KnowledgeDocument): Promise<KnowledgeDocument> => {
    if (!userCanWrite) {
      return {
        ...document,
        persistenceError: 'View-only users do not have write permissions.',
      };
    }
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

  const removeDocument = async (documentId: string): Promise<void> => {
    if (!userCanWrite) {
      throw new Error('View-only users do not have permission to delete documents.');
    }
    await deleteStoredDocument(documentId);
    setDocuments((current) => current.filter((document) => document.id !== documentId));
    setStorageError(null);
  };

  if (authLoading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0f172a',
          color: '#e2e8f0',
          fontSize: '0.95rem',
        }}
      >
        Verifying session…
      </div>
    );
  }

  if (!currentUser) {
    return (
      <AuthPage
        hasUsers={hasUsers}
        connectionError={authConnectionError}
        onRetryConnection={() => void checkAuth()}
        onAuthenticated={handleAuthenticated}
      />
    );
  }

  const effectiveTab: NavTab = activeTab === 'users' && !userIsAdmin ? 'home' : activeTab;

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: '#f8fafc' }}>
      {/* Left Navigation Sidebar */}
      <Sidebar
        activeTab={effectiveTab}
        onSelectTab={handleSelectTab}
        modelName={apiConfig.modelName}
        currentUser={currentUser}
        onLogout={() => void handleLogout()}
      />

      {/* Main Content Area */}
      <main style={{ flex: 1, padding: '32px', overflowY: 'auto' }}>
        {storageError && (
          <div
            role="alert"
            style={{
              marginBottom: '20px',
              padding: '12px 16px',
              backgroundColor: '#fee2e2',
              color: '#991b1b',
              borderRadius: '8px',
            }}
          >
            MySQL document storage is unavailable: {storageError}
          </div>
        )}

        {effectiveTab === 'profile' ? (
          <ProfilePage
            user={currentUser}
            onUserUpdated={setCurrentUser}
            onLogout={() => void handleLogout()}
            onSelectTab={handleSelectTab}
          />
        ) : effectiveTab === 'users' && userIsAdmin ? (
          <UserManagementPage
            currentUser={currentUser}
            onCurrentUserUpdated={setCurrentUser}
          />
        ) : !documentsLoaded ? (
          <p role="status" style={{ color: '#64748b' }}>
            Restoring saved documents...
          </p>
        ) : (
          <>
            {effectiveTab === 'home' && (
              <HomePage
                documents={documents}
                canWrite={userCanWrite}
                onOpenIngestion={() => handleSelectTab('upload')}
              />
            )}
            {effectiveTab === 'upload' && (
              <DataUploadPage
                documents={documents}
                canWrite={userCanWrite}
                onDocumentsChange={setDocuments}
                onPersistDocument={persistDocument}
                onDeleteDocument={removeDocument}
              />
            )}
            {effectiveTab === 'api' && (
              <ApiConnectionPage
                config={apiConfig}
                canEdit={userCanWrite}
                onUpdateConfig={handleUpdateApiConfig}
              />
            )}
          </>
        )}
      </main>

      {/* Floating Agentic AI Chatbox */}
      {documentsLoaded && (
        <AgentChatbox
          key={currentUser.id}
          apiConfig={apiConfig}
          documents={documents}
          userId={currentUser.id}
          userRole={currentUser.role}
          onSelectTab={handleSelectTab}
        />
      )}
    </div>
  );
};

export default App;
