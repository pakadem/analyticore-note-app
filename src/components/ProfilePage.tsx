import React, { useEffect, useState } from 'react';
import type { NavTab, UserAccount, UserRole } from '../types/app';
import {
  changeMyPassword,
  getUserInitials,
  ROLE_INFO,
  updateMyProfile,
} from '../utils/authApi';

interface ProfilePageProps {
  user: UserAccount;
  onUserUpdated: (updated: UserAccount) => void;
  onLogout: () => void;
  onSelectTab: (tab: NavTab) => void;
}

const cardStyle: React.CSSProperties = {
  backgroundColor: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '12px',
  padding: '24px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: '8px',
  border: '1px solid #cbd5e1',
  fontSize: '0.875rem',
  backgroundColor: '#ffffff',
  color: '#0f172a',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.825rem',
  fontWeight: 600,
  color: '#334155',
  marginBottom: '6px',
};

const PERMISSION_ROWS: Array<{
  capability: string;
  roles: Record<UserRole, boolean>;
}> = [
  {
    capability: 'View Analytics Dashboard, Forecasts & ML Clustering',
    roles: { admin: true, writer: true, viewer: true },
  },
  {
    capability: 'View & Download Ingested Documents',
    roles: { admin: true, writer: true, viewer: true },
  },
  {
    capability: 'Query Autonomous AI Analyst & Export Reports',
    roles: { admin: true, writer: true, viewer: true },
  },
  {
    capability: 'Update Own Profile & Change Password',
    roles: { admin: true, writer: true, viewer: true },
  },
  {
    capability: 'Upload, Re-index & Delete Knowledge Base Files',
    roles: { admin: true, writer: true, viewer: false },
  },
  {
    capability: 'Modify Ollama Endpoint & Model Parameters',
    roles: { admin: true, writer: true, viewer: false },
  },
  {
    capability: 'Create Users, Assign Roles & Administrate Accounts',
    roles: { admin: true, writer: false, viewer: false },
  },
];

const formatDateTime = (iso: string | null): string => {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
};

export const ProfilePage: React.FC<ProfilePageProps> = ({
  user,
  onUserUpdated,
  onLogout,
  onSelectTab,
}) => {
  const [fullName, setFullName] = useState(user.fullName);
  const [username, setUsername] = useState(user.username);
  const [email, setEmail] = useState(user.email);
  const [jobTitle, setJobTitle] = useState(user.jobTitle);
  const [bio, setBio] = useState(user.bio);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

  useEffect(() => {
    setFullName(user.fullName);
    setUsername(user.username);
    setEmail(user.email);
    setJobTitle(user.jobTitle);
    setBio(user.bio);
  }, [user]);

  const roleMeta = ROLE_INFO[user.role];

  const handleSaveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    setProfileError(null);
    setProfileSuccess(null);
    setSavingProfile(true);

    try {
      const updated = await updateMyProfile({
        fullName: fullName.trim(),
        username: username.trim(),
        email: email.trim(),
        jobTitle: jobTitle.trim(),
        bio: bio.trim(),
      });
      onUserUpdated(updated);
      setProfileSuccess('Profile information updated.');
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : 'Unable to save profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handlePasswordChange = async (event: React.FormEvent) => {
    event.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);

    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New password and confirmation do not match.');
      return;
    }

    setSavingPassword(true);
    try {
      await changeMyPassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordSuccess('Password updated. Other active sessions have been signed out.');
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : 'Unable to change password.');
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '980px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 'bold' }}>My Profile & Access Permissions</h1>
          <p style={{ color: '#64748b', fontSize: '0.875rem', marginTop: '4px' }}>
            Manage your personal details, password security, and review your role permissions.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {user.role === 'admin' && (
            <button
              type="button"
              onClick={() => onSelectTab('users')}
              style={{
                padding: '10px 16px',
                borderRadius: '8px',
                border: '1px solid #c4b5fd',
                backgroundColor: '#ede9fe',
                color: '#5b21b6',
                fontWeight: 600,
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
            >
              🛡️ User Administration
            </button>
          )}
          <button
            type="button"
            onClick={onLogout}
            style={{
              padding: '10px 16px',
              borderRadius: '8px',
              border: '1px solid #fecaca',
              backgroundColor: '#fef2f2',
              color: '#991b1b',
              fontWeight: 600,
              fontSize: '0.85rem',
              cursor: 'pointer',
            }}
          >
            Sign Out
          </button>
        </div>
      </div>

      {/* Identity Overview Banner */}
      <section
        style={{
          ...cardStyle,
          display: 'flex',
          flexWrap: 'wrap',
          gap: '20px',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '18px', flexWrap: 'wrap' }}>
          <div
            style={{
              width: '68px',
              height: '68px',
              borderRadius: '50%',
              backgroundColor: '#0284c7',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.45rem',
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {getUserInitials(user.fullName, user.username)}
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: '1.3rem', fontWeight: 700, margin: 0 }}>{user.fullName}</h2>
              <span
                style={{
                  padding: '4px 10px',
                  borderRadius: '999px',
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  backgroundColor: roleMeta.badgeBg,
                  color: roleMeta.badgeColor,
                  border: `1px solid ${roleMeta.borderColor}`,
                }}
              >
                {roleMeta.label}
              </span>
            </div>
            <div style={{ color: '#475569', fontSize: '0.875rem', marginTop: '4px' }}>
              @{user.username} · {user.email}
              {user.jobTitle ? ` · ${user.jobTitle}` : ''}
            </div>
            {user.bio && (
              <p style={{ color: '#64748b', fontSize: '0.825rem', marginTop: '8px', maxWidth: '620px' }}>
                {user.bio}
              </p>
            )}
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gap: '6px',
            fontSize: '0.78rem',
            color: '#64748b',
            backgroundColor: '#f8fafc',
            padding: '12px 16px',
            borderRadius: '8px',
            border: '1px solid #e2e8f0',
          }}
        >
          <div>
            <strong>Member since:</strong> {formatDateTime(user.createdAt)}
          </div>
          <div>
            <strong>Last sign-in:</strong> {formatDateTime(user.lastLoginAt)}
          </div>
        </div>
      </section>

      {/* Edit Profile + Password Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 400px), 1fr))',
          gap: '20px',
          alignItems: 'start',
        }}
      >
        {/* Personal Info Form */}
        <section style={cardStyle}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '4px' }}>Personal Information</h2>
          <p style={{ color: '#64748b', fontSize: '0.8rem', marginBottom: '18px' }}>
            Update your display name, username, contact email, and profile bio.
          </p>

          {profileError && (
            <div
              role="alert"
              style={{
                marginBottom: '14px',
                padding: '10px 12px',
                borderRadius: '8px',
                backgroundColor: '#fee2e2',
                color: '#991b1b',
                fontSize: '0.825rem',
              }}
            >
              {profileError}
            </div>
          )}
          {profileSuccess && (
            <div
              role="status"
              style={{
                marginBottom: '14px',
                padding: '10px 12px',
                borderRadius: '8px',
                backgroundColor: '#dcfce7',
                color: '#166534',
                fontSize: '0.825rem',
              }}
            >
              {profileSuccess}
            </div>
          )}

          <form onSubmit={(e) => void handleSaveProfile(e)} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label htmlFor="profile-fullname" style={labelStyle}>
                Full Name
              </label>
              <input
                id="profile-fullname"
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label htmlFor="profile-username" style={labelStyle}>
                  Username
                </label>
                <input
                  id="profile-username"
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div>
                <label htmlFor="profile-jobtitle" style={labelStyle}>
                  Job Title
                </label>
                <input
                  id="profile-jobtitle"
                  type="text"
                  placeholder="e.g. Financial Analyst"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  style={inputStyle}
                />
              </div>
            </div>

            <div>
              <label htmlFor="profile-email" style={labelStyle}>
                Email Address
              </label>
              <input
                id="profile-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div>
              <label htmlFor="profile-bio" style={labelStyle}>
                Bio / Notes
              </label>
              <textarea
                id="profile-bio"
                rows={3}
                maxLength={1000}
                placeholder="Optional short bio, department, or focus area..."
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                style={{ ...inputStyle, resize: 'vertical' }}
              />
            </div>

            <button
              type="submit"
              disabled={savingProfile}
              style={{
                alignSelf: 'flex-start',
                padding: '10px 18px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: savingProfile ? '#94a3b8' : '#0284c7',
                color: '#ffffff',
                fontWeight: 600,
                fontSize: '0.875rem',
                cursor: savingProfile ? 'not-allowed' : 'pointer',
              }}
            >
              {savingProfile ? 'Saving…' : 'Save Profile Changes'}
            </button>
          </form>
        </section>

        {/* Change Password Form */}
        <section style={cardStyle}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '4px' }}>Change Password</h2>
          <p style={{ color: '#64748b', fontSize: '0.8rem', marginBottom: '18px' }}>
            Use a strong password of at least 8 characters. Changing your password revokes other active sessions.
          </p>

          {passwordError && (
            <div
              role="alert"
              style={{
                marginBottom: '14px',
                padding: '10px 12px',
                borderRadius: '8px',
                backgroundColor: '#fee2e2',
                color: '#991b1b',
                fontSize: '0.825rem',
              }}
            >
              {passwordError}
            </div>
          )}
          {passwordSuccess && (
            <div
              role="status"
              style={{
                marginBottom: '14px',
                padding: '10px 12px',
                borderRadius: '8px',
                backgroundColor: '#dcfce7',
                color: '#166534',
                fontSize: '0.825rem',
              }}
            >
              {passwordSuccess}
            </div>
          )}

          <form onSubmit={(e) => void handlePasswordChange(e)} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label htmlFor="pwd-current" style={labelStyle}>
                Current Password
              </label>
              <input
                id="pwd-current"
                type="password"
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div>
              <label htmlFor="pwd-new" style={labelStyle}>
                New Password (min. 8 characters)
              </label>
              <input
                id="pwd-new"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div>
              <label htmlFor="pwd-confirm" style={labelStyle}>
                Confirm New Password
              </label>
              <input
                id="pwd-confirm"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                style={inputStyle}
              />
            </div>

            <button
              type="submit"
              disabled={savingPassword}
              style={{
                alignSelf: 'flex-start',
                padding: '10px 18px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: savingPassword ? '#94a3b8' : '#0f172a',
                color: '#ffffff',
                fontWeight: 600,
                fontSize: '0.875rem',
                cursor: savingPassword ? 'not-allowed' : 'pointer',
              }}
            >
              {savingPassword ? 'Updating Password…' : 'Update Password'}
            </button>
          </form>
        </section>
      </div>

      {/* 3-Layer Role Permissions Matrix */}
      <section style={cardStyle}>
        <div style={{ marginBottom: '14px' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Role & Access Layers Overview</h2>
          <p style={{ color: '#64748b', fontSize: '0.82rem', marginTop: '4px' }}>
            Your current account tier is <strong>{roleMeta.label}</strong>: {roleMeta.summary}
          </p>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e8f0', textAlign: 'left', color: '#475569' }}>
                <th style={{ padding: '10px 12px' }}>Capability</th>
                {(['admin', 'writer', 'viewer'] as UserRole[]).map((tier) => {
                  const isCurrent = user.role === tier;
                  return (
                    <th
                      key={tier}
                      style={{
                        padding: '10px 12px',
                        textAlign: 'center',
                        backgroundColor: isCurrent ? '#f0f9ff' : 'transparent',
                        color: isCurrent ? '#0369a1' : '#475569',
                      }}
                    >
                      {ROLE_INFO[tier].label}
                      {isCurrent ? ' (You)' : ''}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_ROWS.map((row) => (
                <tr key={row.capability} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '10px 12px', color: '#1e293b', fontWeight: 500 }}>
                    {row.capability}
                  </td>
                  {(['admin', 'writer', 'viewer'] as UserRole[]).map((tier) => {
                    const allowed = row.roles[tier];
                    const isCurrent = user.role === tier;
                    return (
                      <td
                        key={tier}
                        style={{
                          padding: '10px 12px',
                          textAlign: 'center',
                          backgroundColor: isCurrent ? '#f8fafc' : 'transparent',
                          fontWeight: 700,
                          color: allowed ? '#15803d' : '#94a3b8',
                        }}
                      >
                        {allowed ? '✓ Allowed' : '✕ Restricted'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default ProfilePage;
