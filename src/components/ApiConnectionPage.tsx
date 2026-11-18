import React from 'react';
import { ApiConfig } from '../types/app';

interface ApiPageProps {
  config: ApiConfig;
  canEdit: boolean;
  onUpdateConfig: (config: ApiConfig) => void;
}

export const ApiConnectionPage: React.FC<ApiPageProps> = ({ config, canEdit, onUpdateConfig }) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '680px' }}>
      <div>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 'bold' }}>LLM & API Setup</h1>
        <p style={{ color: '#64748b', fontSize: '0.875rem', marginTop: '4px' }}>
          Configure the Ollama endpoint and model parameters.
        </p>
      </div>

      {!canEdit && (
        <div
          role="status"
          style={{
            padding: '14px 16px',
            borderRadius: '10px',
            backgroundColor: '#f8fafc',
            border: '1px solid #cbd5e1',
            color: '#334155',
            fontSize: '0.85rem',
          }}
        >
          <strong>🔒 View-Only Mode:</strong> You can inspect the active Ollama endpoint and model parameters, but modifying these settings requires a <strong>Writer</strong> or <strong>Admin</strong> role.
        </div>
      )}

      <div
        style={{
          backgroundColor: '#ffffff',
          padding: '24px',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        }}
      >
        {/* Status Indicator */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '12px',
            backgroundColor: '#f0fdf4',
            border: '1px solid #bbf7d0',
            borderRadius: '8px',
            marginBottom: '20px',
          }}
        >
          <div
            style={{
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              backgroundColor: config.isConnected ? '#22c55e' : '#ef4444',
            }}
          />
          <span
            style={{
              fontSize: '0.875rem',
              fontWeight: '600',
              color: config.isConnected ? '#166534' : '#991b1b',
            }}
          >
            {config.isConnected ? 'Ollama endpoint configured' : 'Ollama service unreachable'}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '600', marginBottom: '6px' }}>
              Ollama Endpoint
            </label>
            <input
              type="text"
              disabled={!canEdit}
              value={config.hostUrl}
              onChange={(e) => canEdit && onUpdateConfig({ ...config, hostUrl: e.target.value })}
              style={{
                width: '100%',
                padding: '10px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '0.875rem',
                backgroundColor: canEdit ? '#ffffff' : '#f1f5f9',
                color: canEdit ? '#0f172a' : '#64748b',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '600', marginBottom: '6px' }}>
              Active LLM Model
            </label>
            <select
              disabled={!canEdit}
              value={config.modelName}
              onChange={(e) => canEdit && onUpdateConfig({ ...config, modelName: e.target.value })}
              style={{
                width: '100%',
                padding: '10px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '0.875rem',
                backgroundColor: canEdit ? '#ffffff' : '#f1f5f9',
                color: canEdit ? '#0f172a' : '#64748b',
              }}
            >
              <option value="llama3:8b">Meta Llama 3 (8B Instruct)</option>
              <option value="llama3.1:8b">Meta Llama 3.1 (8B)</option>
              <option value="qwen2.5:7b">Qwen 2.5 (7B)</option>
              <option value="mistral-nemo">Mistral Nemo</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '600', marginBottom: '6px' }}>
              Temperature (Creativity): {config.temperature}
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              disabled={!canEdit}
              value={config.temperature}
              onChange={(e) => canEdit && onUpdateConfig({ ...config, temperature: parseFloat(e.target.value) })}
              style={{ width: '100%' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '600', marginBottom: '6px' }}>
              Context Window Tokens
            </label>
            <input
              type="number"
              disabled={!canEdit}
              value={config.contextWindow}
              onChange={(e) =>
                canEdit && onUpdateConfig({ ...config, contextWindow: parseInt(e.target.value) || 4096 })
              }
              style={{
                width: '100%',
                padding: '10px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '0.875rem',
                backgroundColor: canEdit ? '#ffffff' : '#f1f5f9',
                color: canEdit ? '#0f172a' : '#64748b',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ApiConnectionPage;
