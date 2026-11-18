import React, { useCallback, useEffect, useState } from 'react';
import type { UserAccount, UserRole } from '../types/app';
import {
  createUserAccount,
  deleteUserAccount,
  fetchUsers,
  getUserInitials,
  ROLE_INFO,
  updateUserAccount,
} from '../utils/authApi';

interface UserManagementPageProps {
  currentUser: UserAccount;
  onCurrentUserUpdated: (updated: UserAccount) => void;
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
  padding: '9px 11px',
  borderRadius: '8px',
  border: '1px solid #cbd5e1',
  fontSize: '0.85rem',
  backgroundColor: '#ffffff',
  color: '#0f172a',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.8rem',
  fontWeight: 600,
  color: '#334155',
  marginBottom: '5px',
};

const formatShortDate = (iso: string | null): string => {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

export const UserManagementPage: React.FC<UserManagementPageProps> = ({
  currentUser,
  onCurrentUserUpdated,
}) => {
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Create user form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newFullName, setNewFullName] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newJobTitle, setNewJobTitle] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('writer');
  const [newPassword, setNewPassword] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [bannerSuccess, setBannerSuccess] = useState<string | null>(null);

  // Edit user modal state
  const [editingUser, setEditingUser] = useState<UserAccount | null>(null);
  const [editFullName, setEditFullName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editJobTitle, setEditJobTitle] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editRole, setEditRole] = useState<UserRole>('viewer');
  const [editIsActive, setEditIsActive] = useState(true);
  const [editResetPassword, setEditResetPassword] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);

  const loadAllUsers = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const list = await fetchUsers();
      setUsers(list);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Failed to load user accounts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAllUsers();
  }, [loadAllUsers]);

  const openEditModal = (target: UserAccount) => {
    setEditingUser(target);
    setEditFullName(target.fullName);
    setEditUsername(target.username);
    setEditEmail(target.email);
    setEditJobTitle(target.jobTitle);
    setEditBio(target.bio);
    setEditRole(target.role);
    setEditIsActive(target.isActive);
    setEditResetPassword('');
    setEditError(null);
  };

  const handleCreateSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setCreateError(null);
    setBannerSuccess(null);

    if (newPassword.length < 8) {
      setCreateError('Password must be at least 8 characters.');
      return;
    }

    setCreating(true);
    try {
      const created = await createUserAccount({
        fullName: newFullName.trim(),
        username: newUsername.trim(),
        email: newEmail.trim(),
        jobTitle: newJobTitle.trim() || undefined,
        role: newRole,
        password: newPassword,
      });
      setUsers((prev) => [...prev, created]);
      setNewFullName('');
      setNewUsername('');
      setNewEmail('');
      setNewJobTitle('');
      setNewRole('writer');
      setNewPassword('');
      setShowCreateForm(false);
      setBannerSuccess(`Created ${ROLE_INFO[created.role].label} account for ${created.fullName} (@${created.username}).`);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Unable to create user.');
    } finally {
      setCreating(false);
    }
  };

  const handleEditSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingUser) return;
    setEditError(null);
    setBannerSuccess(null);

    if (editResetPassword && editResetPassword.length < 8) {
      setEditError('Reset password must be at least 8 characters.');
      return;
    }

    setSavingEdit(true);
    try {
      const updated = await updateUserAccount(editingUser.id, {
        fullName: editFullName.trim(),
        username: editUsername.trim(),
        email: editEmail.trim(),
        jobTitle: editJobTitle.trim(),
        bio: editBio.trim(),
        role: editRole,
        isActive: editIsActive,
        newPassword: editResetPassword || undefined,
      });
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      if (updated.id === currentUser.id) {
        onCurrentUserUpdated(updated);
      }
      setEditingUser(null);
      setBannerSuccess(`Updated account settings for ${updated.fullName}.`);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : 'Unable to update user.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async (target: UserAccount) => {
    if (target.id === currentUser.id) return;
    if (!window.confirm(`Permanently delete user "${target.fullName}" (@${target.username})? This cannot be undone.`)) {
      return;
    }

    setDeletingUserId(target.id);
    setBannerSuccess(null);
    setLoadError(null);
    try {
      await deleteUserAccount(target.id);
      setUsers((prev) => prev.filter((u) => u.id !== target.id));
      setBannerSuccess(`Deleted user account @${target.username}.`);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Unable to delete user.');
    } finally {
      setDeletingUserId(null);
    }
  };

  const adminCount = users.filter((u) => u.role === 'admin').length;
  const writerCount = users.filter((u) => u.role === 'writer').length;
  const viewerCount = users.filter((u) => u.role === 'viewer').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 'bold' }}>User Administration</h1>
          <p style={{ color: '#64748b', fontSize: '0.875rem', marginTop: '4px' }}>
            Create accounts, assign Admin, Writer, or View roles, reset passwords, and manage access.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setCreateError(null);
            setShowCreateForm((prev) => !prev);
          }}
          style={{
            padding: '10px 18px',
            borderRadius: '8px',
            border: 'none',
            backgroundColor: showCreateForm ? '#475569' : '#0284c7',
            color: '#ffffff',
            fontWeight: 700,
            fontSize: '0.875rem',
            cursor: 'pointer',
          }}
        >
          {showCreateForm ? 'Cancel' : '+ Create New User'}
        </button>
      </div>

      {/* Role Summary Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px' }}>
        <article style={{ ...cardStyle, padding: '16px' }}>
          <div style={{ color: '#64748b', fontSize: '0.8rem' }}>Total Accounts</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: '#0f172a', margin: '6px 0' }}>{users.length}</div>
          <div style={{ color: '#94a3b8', fontSize: '0.75rem' }}>Registered AnalytiCore users</div>
        </article>
        <article style={{ ...cardStyle, padding: '16px' }}>
          <div style={{ color: '#64748b', fontSize: '0.8rem' }}>1. Admin Users</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: '#6d28d9', margin: '6px 0' }}>{adminCount}</div>
          <div style={{ color: '#94a3b8', fontSize: '0.75rem' }}>Full system & user administration</div>
        </article>
        <article style={{ ...cardStyle, padding: '16px' }}>
          <div style={{ color: '#64748b', fontSize: '0.8rem' }}>2. Writer Users</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: '#0369a1', margin: '6px 0' }}>{writerCount}</div>
          <div style={{ color: '#94a3b8', fontSize: '0.75rem' }}>Actions & uploads, no user creation</div>
        </article>
        <article style={{ ...cardStyle, padding: '16px' }}>
          <div style={{ color: '#64748b', fontSize: '0.8rem' }}>3. View Users</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: '#475569', margin: '6px 0' }}>{viewerCount}</div>
          <div style={{ color: '#94a3b8', fontSize: '0.75rem' }}>Read-only access without write permissions</div>
        </article>
      </div>

      {bannerSuccess && (
        <div
          role="status"
          style={{
            padding: '12px 16px',
            borderRadius: '8px',
            backgroundColor: '#dcfce7',
            border: '1px solid #bbf7d0',
            color: '#166534',
            fontSize: '0.85rem',
            fontWeight: 500,
          }}
        >
          {bannerSuccess}
        </div>
      )}

      {loadError && (
        <div
          role="alert"
          style={{
            padding: '12px 16px',
            borderRadius: '8px',
            backgroundColor: '#fee2e2',
            color: '#991b1b',
            fontSize: '0.85rem',
          }}
        >
          {loadError}
        </div>
      )}

      {/* Create New User Panel */}
      {showCreateForm && (
        <section style={{ ...cardStyle, border: '1px solid #7dd3fc', backgroundColor: '#f8fafc' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '4px' }}>Create New User Account</h2>
          <p style={{ color: '#64748b', fontSize: '0.8rem', marginBottom: '16px' }}>
            Assign one of the three access layers. The user can sign in immediately and update their password from their Profile page.
          </p>

          {createError && (
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
              {createError}
            </div>
          )}

          <form onSubmit={(e) => void handleCreateSubmit(e)} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '12px' }}>
              <div>
                <label htmlFor="create-fullname" style={labelStyle}>
                  Full Name *
                </label>
                <input
                  id="create-fullname"
                  type="text"
                  required
                  placeholder="Sipho Dlamini"
                  value={newFullName}
                  onChange={(e) => setNewFullName(e.target.value)}
                  style={inputStyle}
                />
              </div>

              <div>
                <label htmlFor="create-username" style={labelStyle}>
                  Username *
                </label>
                <input
                  id="create-username"
                  type="text"
                  required
                  placeholder="sipho.dlamini"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  style={inputStyle}
                />
              </div>

              <div>
                <label htmlFor="create-email" style={labelStyle}>
                  Email Address *
                </label>
                <input
                  id="create-email"
                  type="email"
                  required
                  placeholder="sipho@company.co.za"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  style={inputStyle}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '12px' }}>
              <div>
                <label htmlFor="create-role" style={labelStyle}>
                  Access Role *
                </label>
                <select
                  id="create-role"
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as UserRole)}
                  style={inputStyle}
                >
                  <option value="admin">1. Admin User (Full Administration)</option>
                  <option value="writer">2. Writer User (Actions, No User Creation)</option>
                  <option value="viewer">3. View User (Read-Only, No Write Access)</option>
                </select>
              </div>

              <div>
                <label htmlFor="create-jobtitle" style={labelStyle}>
                  Job Title (Optional)
                </label>
                <input
                  id="create-jobtitle"
                  type="text"
                  placeholder="e.g. Data Analyst"
                  value={newJobTitle}
                  onChange={(e) => setNewJobTitle(e.target.value)}
                  style={inputStyle}
                />
              </div>

              <div>
                <label htmlFor="create-password" style={labelStyle}>
                  Initial Password * (min. 8 chars)
                </label>
                <input
                  id="create-password"
                  type="password"
                  required
                  minLength={8}
                  placeholder="Minimum 8 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  style={inputStyle}
                />
              </div>
            </div>

            <div
              style={{
                padding: '10px 12px',
                borderRadius: '8px',
                backgroundColor: ROLE_INFO[newRole].badgeBg,
                color: ROLE_INFO[newRole].badgeColor,
                border: `1px solid ${ROLE_INFO[newRole].borderColor}`,
                fontSize: '0.8rem',
              }}
            >
              <strong>{ROLE_INFO[newRole].label}:</strong> {ROLE_INFO[newRole].summary}
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="submit"
                disabled={creating}
                style={{
                  padding: '10px 18px',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: creating ? '#94a3b8' : '#0284c7',
                  color: '#ffffff',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  cursor: creating ? 'not-allowed' : 'pointer',
                }}
              >
                {creating ? 'Creating Account…' : 'Create User Account'}
              </button>
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                style={{
                  padding: '10px 16px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  backgroundColor: '#ffffff',
                  color: '#334155',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      {/* User Directory Table */}
      <section style={cardStyle}>
        <h2 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '16px' }}>Registered User Directory</h2>

        {loading ? (
          <p role="status" style={{ color: '#64748b', fontSize: '0.875rem' }}>Loading user accounts…</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e2e8f0', textAlign: 'left', color: '#64748b' }}>
                  <th style={{ padding: '12px 8px' }}>User</th>
                  <th style={{ padding: '12px 8px' }}>Email</th>
                  <th style={{ padding: '12px 8px' }}>Access Layer</th>
                  <th style={{ padding: '12px 8px' }}>Status</th>
                  <th style={{ padding: '12px 8px' }}>Last Sign-In</th>
                  <th style={{ padding: '12px 8px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((account) => {
                  const roleMeta = ROLE_INFO[account.role];
                  const isSelf = account.id === currentUser.id;
                  return (
                    <tr key={account.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '12px 8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <div
                            style={{
                              width: '34px',
                              height: '34px',
                              borderRadius: '50%',
                              backgroundColor: account.isActive ? '#0f172a' : '#94a3b8',
                              color: '#ffffff',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '0.78rem',
                              fontWeight: 700,
                              flexShrink: 0,
                            }}
                          >
                            {getUserInitials(account.fullName, account.username)}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, color: '#0f172a' }}>
                              {account.fullName}{' '}
                              {isSelf && (
                                <span style={{ fontSize: '0.72rem', color: '#0284c7', fontWeight: 700 }}>(You)</span>
                              )}
                            </div>
                            <div style={{ fontSize: '0.76rem', color: '#64748b' }}>
                              @{account.username}
                              {account.jobTitle ? ` · ${account.jobTitle}` : ''}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '12px 8px', color: '#334155' }}>{account.email}</td>
                      <td style={{ padding: '12px 8px' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '4px 10px',
                            borderRadius: '999px',
                            fontSize: '0.73rem',
                            fontWeight: 700,
                            backgroundColor: roleMeta.badgeBg,
                            color: roleMeta.badgeColor,
                            border: `1px solid ${roleMeta.borderColor}`,
                          }}
                        >
                          {roleMeta.label}
                        </span>
                      </td>
                      <td style={{ padding: '12px 8px' }}>
                        <span
                          style={{
                            padding: '3px 8px',
                            borderRadius: '4px',
                            fontSize: '0.73rem',
                            fontWeight: 700,
                            backgroundColor: account.isActive ? '#dcfce7' : '#fee2e2',
                            color: account.isActive ? '#15803d' : '#b91c1c',
                          }}
                        >
                          {account.isActive ? 'ACTIVE' : 'DEACTIVATED'}
                        </span>
                      </td>
                      <td style={{ padding: '12px 8px', color: '#64748b', fontSize: '0.8rem' }}>
                        {formatShortDate(account.lastLoginAt)}
                      </td>
                      <td style={{ padding: '12px 8px' }}>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            onClick={() => openEditModal(account)}
                            style={{
                              padding: '6px 10px',
                              borderRadius: '6px',
                              border: 'none',
                              backgroundColor: '#f1f5f9',
                              color: '#1e293b',
                              fontWeight: 600,
                              fontSize: '0.78rem',
                              cursor: 'pointer',
                            }}
                          >
                            Edit / Role
                          </button>
                          {!isSelf && (
                            <button
                              type="button"
                              disabled={deletingUserId === account.id}
                              onClick={() => void handleDelete(account)}
                              style={{
                                padding: '6px 10px',
                                borderRadius: '6px',
                                border: 'none',
                                backgroundColor: '#fee2e2',
                                color: '#991b1b',
                                fontWeight: 600,
                                fontSize: '0.78rem',
                                cursor: deletingUserId === account.id ? 'not-allowed' : 'pointer',
                              }}
                            >
                              {deletingUserId === account.id ? 'Deleting…' : 'Delete'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Edit User Modal */}
      {editingUser && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditingUser(null);
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1100,
            backgroundColor: 'rgba(15, 23, 42, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-user-dialog-title"
            style={{
              width: 'min(560px, 100%)',
              maxHeight: '90vh',
              overflowY: 'auto',
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              padding: '24px',
              boxShadow: '0 25px 50px rgba(0, 0, 0, 0.3)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 id="edit-user-dialog-title" style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0 }}>
                Edit User: {editingUser.fullName}
              </h2>
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                style={{
                  padding: '6px 10px',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: '#e2e8f0',
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>

            {editError && (
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
                {editError}
              </div>
            )}

            <form onSubmit={(e) => void handleEditSubmit(e)} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label htmlFor="edit-fullname" style={labelStyle}>
                    Full Name
                  </label>
                  <input
                    id="edit-fullname"
                    type="text"
                    required
                    value={editFullName}
                    onChange={(e) => setEditFullName(e.target.value)}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label htmlFor="edit-username" style={labelStyle}>
                    Username
                  </label>
                  <input
                    id="edit-username"
                    type="text"
                    required
                    value={editUsername}
                    onChange={(e) => setEditUsername(e.target.value)}
                    style={inputStyle}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label htmlFor="edit-email" style={labelStyle}>
                    Email Address
                  </label>
                  <input
                    id="edit-email"
                    type="email"
                    required
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label htmlFor="edit-jobtitle" style={labelStyle}>
                    Job Title
                  </label>
                  <input
                    id="edit-jobtitle"
                    type="text"
                    value={editJobTitle}
                    onChange={(e) => setEditJobTitle(e.target.value)}
                    style={inputStyle}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label htmlFor="edit-role" style={labelStyle}>
                    Access Role
                  </label>
                  <select
                    id="edit-role"
                    value={editRole}
                    disabled={editingUser.id === currentUser.id}
                    onChange={(e) => setEditRole(e.target.value as UserRole)}
                    style={{
                      ...inputStyle,
                      backgroundColor: editingUser.id === currentUser.id ? '#f1f5f9' : '#ffffff',
                    }}
                  >
                    <option value="admin">1. Admin User</option>
                    <option value="writer">2. Writer User</option>
                    <option value="viewer">3. View User</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="edit-status" style={labelStyle}>
                    Account Status
                  </label>
                  <select
                    id="edit-status"
                    value={editIsActive ? 'active' : 'inactive'}
                    disabled={editingUser.id === currentUser.id}
                    onChange={(e) => setEditIsActive(e.target.value === 'active')}
                    style={{
                      ...inputStyle,
                      backgroundColor: editingUser.id === currentUser.id ? '#f1f5f9' : '#ffffff',
                    }}
                  >
                    <option value="active">Active (Can Sign In)</option>
                    <option value="inactive">Deactivated (Access Suspended)</option>
                  </select>
                </div>
              </div>

              {editingUser.id === currentUser.id && (
                <p style={{ fontSize: '0.76rem', color: '#64748b', margin: 0 }}>
                  Your own Admin role and active status are locked to prevent accidental self-lockout.
                </p>
              )}

              <div>
                <label htmlFor="edit-reset-pwd" style={labelStyle}>
                  Reset Password (Optional — leave blank to keep current password)
                </label>
                <input
                  id="edit-reset-pwd"
                  type="password"
                  minLength={8}
                  placeholder="Enter new password (min. 8 characters)"
                  value={editResetPassword}
                  onChange={(e) => setEditResetPassword(e.target.value)}
                  style={inputStyle}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  style={{
                    padding: '9px 16px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    backgroundColor: '#ffffff',
                    color: '#334155',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  style={{
                    padding: '9px 18px',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: savingEdit ? '#94a3b8' : '#0284c7',
                    color: '#ffffff',
                    fontWeight: 700,
                    cursor: savingEdit ? 'not-allowed' : 'pointer',
                  }}
                >
                  {savingEdit ? 'Saving…' : 'Save User Changes'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
};

export default UserManagementPage;
