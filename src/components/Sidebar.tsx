import React from 'react';
import { NavTab, NavigationItem, UserAccount } from '../types/app';
import { canManageUsers, canUserWrite, getUserInitials, ROLE_INFO } from '../utils/authApi';
import logoUrl from '../../analyticore-logo.png';

interface SidebarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  modelName: string;
  currentUser: UserAccount;
  onLogout: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  modelName,
  currentUser,
  onLogout,
}) => {
  const isWriterOrAdmin = canUserWrite(currentUser.role);
  const isAdmin = canManageUsers(currentUser.role);
  const roleMeta = ROLE_INFO[currentUser.role];

  const navItems: NavigationItem[] = [
    {
      id: 'home',
      label: 'Dashboard & Analytics',
      description: 'Overview stats & dynamic graphs',
      iconKey: '📊',
    },
    {
      id: 'upload',
      label: 'Data Ingestion',
      description: isWriterOrAdmin
        ? 'Upload PDF, CSV & TXT files for AI'
        : 'View & download ingested files',
      iconKey: '📁',
    },
    {
      id: 'api',
      label: 'API & Model Setup',
      description: isWriterOrAdmin
        ? 'Configure local Ollama & Llama 3'
        : 'View Ollama & model settings',
      iconKey: '⚙️',
    },
    {
      id: 'profile',
      label: 'My Profile',
      description: 'Account details, security & role',
      iconKey: '👤',
    },
    ...(isAdmin
      ? [
          {
            id: 'users' as const,
            label: 'User Administration',
            description: 'Create & manage user accounts',
            iconKey: '🛡️',
            adminOnly: true,
          },
        ]
      : []),
  ];

  return (
    <aside
      style={{
        width: '280px',
        backgroundColor: '#0f172a',
        color: '#ffffff',
        padding: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        flexShrink: 0,
      }}
    >
      <div style={{ borderBottom: '1px solid #334155' }}>
        <img
          src={logoUrl}
          alt="AnalytiCore"
          style={{
            width: '150px',
            margin: '0 auto',
            display: 'block',
            paddingBottom: '16px',
            height: 'auto',
          }}
        />
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
                <div style={{ fontWeight: isActive ? 'bold' : '500', fontSize: '0.875rem' }}>
                  {item.label}
                </div>
                <div style={{ fontSize: '0.75rem', color: isActive ? '#e0f2fe' : '#94a3b8' }}>
                  {item.description}
                </div>
              </div>
            </button>
          );
        })}
      </nav>

      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {/* Signed-in User Summary */}
        <div
          style={{
            padding: '12px',
            backgroundColor: '#1e293b',
            borderRadius: '10px',
            border: '1px solid #334155',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <div
            onClick={() => onSelectTab('profile')}
            title="Open My Profile"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              cursor: 'pointer',
            }}
          >
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                backgroundColor: '#0284c7',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: '0.82rem',
                flexShrink: 0,
              }}
            >
              {getUserInitials(currentUser.fullName, currentUser.username)}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontWeight: 600,
                  fontSize: '0.84rem',
                  color: '#f8fafc',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {currentUser.fullName}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                <span
                  style={{
                    padding: '1px 6px',
                    borderRadius: '999px',
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    backgroundColor: roleMeta.badgeBg,
                    color: roleMeta.badgeColor,
                  }}
                >
                  {roleMeta.shortLabel}
                </span>
                <span
                  style={{
                    fontSize: '0.72rem',
                    color: '#94a3b8',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  @{currentUser.username}
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onLogout}
            style={{
              width: '100%',
              padding: '7px 10px',
              borderRadius: '6px',
              border: '1px solid #475569',
              backgroundColor: 'transparent',
              color: '#e2e8f0',
              fontSize: '0.76rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Sign Out
          </button>
        </div>

        {/* Engine Status */}
        <div
          style={{
            padding: '12px',
            backgroundColor: '#1e293b',
            borderRadius: '8px',
            fontSize: '0.75rem',
            color: '#cbd5e1',
          }}
        >
          <div>
            🤖 <strong>Engine:</strong> {modelName}
          </div>
          <div style={{ marginTop: '4px' }}>
            ⚡ <strong>Status:</strong> Agent Active
          </div>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
