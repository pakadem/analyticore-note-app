export type UserRole = 'admin' | 'writer' | 'viewer';

export type NavTab = 'home' | 'upload' | 'api' | 'profile' | 'users';

export interface UserAccount {
  id: string;
  username: string;
  email: string;
  fullName: string;
  jobTitle: string;
  bio: string;
  role: UserRole;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NavigationItem {
  id: NavTab;
  label: string;
  description: string;
  iconKey: string;
  adminOnly?: boolean;
}

export interface DocumentFile {
  id: string;
  name: string;
  size: number;
  type: string;
  uploadDate: Date;
  status: 'indexing' | 'ready' | 'error';
  tokenCount?: number;
  error?: string;
  hasFile?: boolean;
}

export interface KnowledgeDocument extends DocumentFile {
  content: string;
  file?: Blob;
  persistenceError?: string;
  analyticsError?: string;
  pdfTextExtractionVersion?: number;
}

export interface GeneratedFileArtifact {
  id: string;
  title: string;
  filename: string;
  mimeType: string;
  content: string;
  binaryContent?: Uint8Array;
  headers?: string[];
  rows?: Record<string, string>[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  toolCalls?: Array<{
    id: string;
    name: string;
    args: Record<string, any>;
  }>;
  artifacts?: GeneratedFileArtifact[];
}

export interface ApiConfig {
  hostUrl: string;
  modelName: string;
  temperature: number;
  contextWindow: number;
  isConnected: boolean;
}

export interface DashboardMetric {
  title: string;
  value: string | number;
  change: string;
  description: string;
}
