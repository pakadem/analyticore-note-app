import React, { useState } from 'react';
import logoUrl from '../../analyticore-logo.png';
import type { UserAccount } from '../types/app';
import { loginUser, setupInitialAdmin } from '../utils/authApi';

interface AuthPageProps {
  hasUsers: boolean;
  connectionError: string | null;
  onRetryConnection: () => void;
  onAuthenticated: (user: UserAccount) => void;
}

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

export const AuthPage: React.FC<AuthPageProps> = ({
  hasUsers,
  connectionError,
  onRetryConnection,
  onAuthenticated,
}) => {
  const [identifier, setIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [jobTitle, setJobTitle] = useState('System Administrator');
  const [setupPassword, setSetupPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleLoginSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMessage(null);

    if (!identifier.trim() || !loginPassword) {
      setErrorMessage('Please enter your username/email and password.');
      return;
    }

    setSubmitting(true);
    try {
      const user = await loginUser(identifier.trim(), loginPassword);
      onAuthenticated(user);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Sign-in failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSetupSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMessage(null);

    if (setupPassword.length < 8) {
      setErrorMessage('Password must be at least 8 characters long.');
      return;
    }
    if (setupPassword !== confirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const user = await setupInitialAdmin({
        fullName: fullName.trim(),
        username: username.trim(),
        email: email.trim(),
        jobTitle: jobTitle.trim() || undefined,
        password: setupPassword,
      });
      onAuthenticated(user);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Initial setup failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0c4a6e 100%)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: hasUsers ? '440px' : '540px',
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.45)',
          overflow: 'hidden',
        }}
      >
        {/* Top Branding Header */}
        <div
          style={{
            backgroundColor: '#0f172a',
            padding: '28px 32px 22px',
            textAlign: 'center',
            borderBottom: '1px solid #1e293b',
          }}
        >
          <img
            src={logoUrl}
            alt="AnalytiCore"
            style={{ width: '160px', height: 'auto', display: 'block', margin: '0 auto 12px' }}
          />
          <h1 style={{ color: '#ffffff', fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>
            {hasUsers ? 'Sign in to AnalytiCore' : 'Initial Administrator Setup'}
          </h1>
          <p style={{ color: '#94a3b8', fontSize: '0.825rem', marginTop: '6px' }}>
            {hasUsers
              ? 'Enter your credentials to access analytics, data ingestion & AI tools.'
              : 'Create the first Admin user account to initialize role-based access control.'}
          </p>
        </div>

        <div style={{ padding: '28px 32px 32px' }}>
          {connectionError && (
            <div
              role="alert"
              style={{
                marginBottom: '20px',
                padding: '12px 14px',
                borderRadius: '8px',
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#991b1b',
                fontSize: '0.825rem',
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: '4px' }}>Database API Unavailable</div>
              <div>{connectionError}</div>
              <button
                type="button"
                onClick={onRetryConnection}
                style={{
                  marginTop: '10px',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: '1px solid #dc2626',
                  backgroundColor: '#ffffff',
                  color: '#b91c1c',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Retry Connection
              </button>
            </div>
          )}

          {errorMessage && (
            <div
              role="alert"
              style={{
                marginBottom: '18px',
                padding: '10px 14px',
                borderRadius: '8px',
                backgroundColor: '#fee2e2',
                color: '#991b1b',
                fontSize: '0.84rem',
                fontWeight: 500,
              }}
            >
              {errorMessage}
            </div>
          )}

          {hasUsers ? (
            <form onSubmit={(e) => void handleLoginSubmit(e)} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label htmlFor="auth-identifier" style={labelStyle}>
                  Username or Email
                </label>
                <input
                  id="auth-identifier"
                  type="text"
                  autoComplete="username"
                  autoFocus
                  required
                  placeholder="e.g. admin or admin@company.co.za"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  style={inputStyle}
                />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label htmlFor="auth-password" style={{ ...labelStyle, marginBottom: 0 }}>
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#0284c7',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                <input
                  id="auth-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  placeholder="Enter your password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  style={inputStyle}
                />
              </div>

              <button
                type="submit"
                disabled={submitting || Boolean(connectionError)}
                style={{
                  marginTop: '6px',
                  padding: '12px',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: submitting || connectionError ? '#94a3b8' : '#0284c7',
                  color: '#ffffff',
                  fontSize: '0.925rem',
                  fontWeight: 700,
                  cursor: submitting || connectionError ? 'not-allowed' : 'pointer',
                }}
              >
                {submitting ? 'Signing in…' : 'Sign In'}
              </button>

              <p style={{ marginTop: '4px', fontSize: '0.78rem', color: '#64748b', textAlign: 'center' }}>
                Need an account or role upgrade? Contact an AnalytiCore Administrator.
              </p>
            </form>
          ) : (
            <form onSubmit={(e) => void handleSetupSubmit(e)} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div
                style={{
                  padding: '12px 14px',
                  borderRadius: '8px',
                  backgroundColor: '#f0f9ff',
                  border: '1px solid #bae6fd',
                  fontSize: '0.8rem',
                  color: '#0c4a6e',
                  lineHeight: 1.5,
                }}
              >
                <strong>3-Layer Access Control Enabled:</strong> This initial account is granted{' '}
                <strong>Admin</strong> rights. Once signed in, you can create <strong>Admin</strong>,{' '}
                <strong>Writer</strong> (actions without user creation), and <strong>View</strong> (read-only) accounts.
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                <div>
                  <label htmlFor="setup-fullname" style={labelStyle}>
                    Full Name
                  </label>
                  <input
                    id="setup-fullname"
                    type="text"
                    required
                    autoFocus
                    placeholder="Jane Doe"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label htmlFor="setup-username" style={labelStyle}>
                    Username
                  </label>
                  <input
                    id="setup-username"
                    type="text"
                    required
                    placeholder="admin"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    style={inputStyle}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                <div>
                  <label htmlFor="setup-email" style={labelStyle}>
                    Email Address
                  </label>
                  <input
                    id="setup-email"
                    type="email"
                    required
                    placeholder="admin@company.co.za"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label htmlFor="setup-jobtitle" style={labelStyle}>
                    Job Title (Optional)
                  </label>
                  <input
                    id="setup-jobtitle"
                    type="text"
                    placeholder="System Administrator"
                    value={jobTitle}
                    onChange={(e) => setJobTitle(e.target.value)}
                    style={inputStyle}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                <div>
                  <label htmlFor="setup-password" style={labelStyle}>
                    Password (min. 8 characters)
                  </label>
                  <input
                    id="setup-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={8}
                    placeholder="Create a strong password"
                    value={setupPassword}
                    onChange={(e) => setSetupPassword(e.target.value)}
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label htmlFor="setup-confirm" style={labelStyle}>
                    Confirm Password
                  </label>
                  <input
                    id="setup-confirm"
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={8}
                    placeholder="Repeat password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    style={inputStyle}
                  />
                </div>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', color: '#475569', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={showPassword}
                  onChange={(e) => setShowPassword(e.target.checked)}
                />
                Show passwords
              </label>

              <button
                type="submit"
                disabled={submitting || Boolean(connectionError)}
                style={{
                  marginTop: '4px',
                  padding: '12px',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: submitting || connectionError ? '#94a3b8' : '#0284c7',
                  color: '#ffffff',
                  fontSize: '0.925rem',
                  fontWeight: 700,
                  cursor: submitting || connectionError ? 'not-allowed' : 'pointer',
                }}
              >
                {submitting ? 'Creating Admin Account…' : 'Create Admin Account & Sign In'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default AuthPage;
