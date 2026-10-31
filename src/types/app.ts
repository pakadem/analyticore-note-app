export type NavTab = 'home' | 'upload' | 'api';

export interface NavigationItem {
  id: NavTab;
  label: string;
  description: string;
  iconKey: string;
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
