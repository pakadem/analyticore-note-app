import type { UserAccount, UserRole } from '../types/app';

export interface AuthStatusResponse {
  hasUsers: boolean;
  user: UserAccount | null;
}

export interface SetupAdminPayload {
  username: string;
  email: string;
  fullName: string;
  password: string;
  jobTitle?: string;
}

export interface UpdateProfilePayload {
  username: string;
  email: string;
  fullName: string;
  jobTitle?: string;
  bio?: string;
}

export interface CreateUserPayload {
  username: string;
  email: string;
  fullName: string;
  password: string;
  role: UserRole;
  jobTitle?: string;
  bio?: string;
}

export interface AdminUpdateUserPayload {
  username: string;
  email: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  jobTitle?: string;
  bio?: string;
  newPassword?: string;
}

export const ROLE_INFO: Record<
  UserRole,
  {
    label: string;
    shortLabel: string;
    badgeBg: string;
    badgeColor: string;
    borderColor: string;
    summary: string;
  }
> = {
  admin: {
    label: 'Admin User',
    shortLabel: 'ADMIN',
    badgeBg: '#ede9fe',
    badgeColor: '#6d28d9',
    borderColor: '#c4b5fd',
    summary: 'Full administration rights, document management, system setup, and user creation.',
  },
  writer: {
    label: 'Writer User',
    shortLabel: 'WRITER',
    badgeBg: '#e0f2fe',
    badgeColor: '#0369a1',
    borderColor: '#7dd3fc',
    summary: 'Can upload/delete documents, configure LLM settings, and run AI actions, but cannot create or manage users.',
  },
  viewer: {
    label: 'View User',
    shortLabel: 'VIEWER',
    badgeBg: '#f1f5f9',
    badgeColor: '#475569',
    borderColor: '#cbd5e1',
    summary: 'View-only access to dashboards, ingested documents, and AI analysis without write permissions.',
  },
};

export const canUserWrite = (role: UserRole): boolean =>
  role === 'admin' || role === 'writer';

export const canManageUsers = (role: UserRole): boolean =>
  role === 'admin';

export const getUserInitials = (fullName: string, username?: string): string => {
  const source = (fullName || username || 'U').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
};

const apiRequest = async <T>(url: string, init?: RequestInit): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(url, {
      credentials: 'same-origin',
      ...init,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Network error.';
    throw new Error(`Unable to reach the AnalytiCore API server. Start the app with "npm run dev" and ensure MySQL is running. (${detail})`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
        ? body.error
        : `Request failed with status ${response.status}.`;
    throw new Error(message);
  }

  return body as T;
};

export const fetchAuthStatus = (): Promise<AuthStatusResponse> =>
  apiRequest<AuthStatusResponse>('/api/auth/status');

export const setupInitialAdmin = async (payload: SetupAdminPayload): Promise<UserAccount> => {
  const result = await apiRequest<{ user: UserAccount }>('/api/auth/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return result.user;
};

export const loginUser = async (identifier: string, password: string): Promise<UserAccount> => {
  const result = await apiRequest<{ user: UserAccount }>('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  return result.user;
};

export const logoutUser = (): Promise<void> =>
  apiRequest<void>('/api/auth/logout', { method: 'POST' });

export const updateMyProfile = async (payload: UpdateProfilePayload): Promise<UserAccount> => {
  const result = await apiRequest<{ user: UserAccount }>('/api/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return result.user;
};

export const changeMyPassword = async (
  currentPassword: string,
  newPassword: string
): Promise<void> => {
  await apiRequest<{ status: string }>('/api/profile/password', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
};

export const fetchUsers = (): Promise<UserAccount[]> =>
  apiRequest<UserAccount[]>('/api/users');

export const createUserAccount = async (payload: CreateUserPayload): Promise<UserAccount> => {
  const result = await apiRequest<{ user: UserAccount }>('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return result.user;
};

export const updateUserAccount = async (
  userId: string,
  payload: AdminUpdateUserPayload
): Promise<UserAccount> => {
  const result = await apiRequest<{ user: UserAccount }>(`/api/users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return result.user;
};

export const deleteUserAccount = (userId: string): Promise<void> =>
  apiRequest<void>(`/api/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });
