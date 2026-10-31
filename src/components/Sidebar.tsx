import React from 'react';
import { NavTab, NavigationItem } from '../types/app';
import logoUrl from '../../analyticore-logo.png';

const navItems: NavigationItem[] = [
  { id: 'home', label: 'Dashboard & Analytics', description: 'Overview stats & dynamic graphs', iconKey: '📊' },
  { id: 'upload', label: 'Data Ingestion', description: 'Upload PDF, CSV & TXT files for AI', iconKey: '📁' },
  { id: 'api', label: 'API & Model Setup', description: 'Configure local Ollama & Llama 3', iconKey: '⚙️' },
];

interface SidebarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onSelectTab }) => {
  return (
    <aside style={{ width: '280px', backgroundColor: '#0f172a', color: '#ffffff', padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px', flexShrink: 0 }}>
      <div style={{ borderBottom: '1px solid #334155' }}>
        <img src={logoUrl} alt="AnalytiCore" style={{ width: '150px', margin: '0 auto',display: 'block', paddingBottom: '16px', height: 'auto' }} />
        {/* <p style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '4px' }}>Llama 3 Agentic Note Platform</p> */}
      </div>
      

      <nav style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px 14px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: isActive ? '#0284c7' : 'transparent',
                color: '#ffffff',
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'background-color 0.2s ease',
              }}
            >
              <span style={{ fontSize: '1.25rem' }}>{item.iconKey}</span>
              <div>
                <div style={{ fontWeight: isActive ? 'bold' : '500', fontSize: '0.875rem' }}>{item.label}</div>
                <div style={{ fontSize: '0.75rem', color: isActive ? '#e0f2fe' : '#94a3b8' }}>{item.description}</div>
              </div>
            </button>
          );
        })}
      </nav>

      <div style={{ marginTop: 'auto', padding: '12px', backgroundColor: '#1e293b', borderRadius: '8px', fontSize: '0.75rem', color: '#cbd5e1' }}>
        <div>🤖 <strong>Engine:</strong> Llama 3 (8B)</div>
        <div style={{ marginTop: '4px' }}>⚡ <strong>Status:</strong> Agent Active</div>
      </div>
    </aside>
  );
};

export default Sidebar;
