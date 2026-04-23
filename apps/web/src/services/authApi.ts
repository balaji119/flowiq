import { ActiveUsersResponse, LoginResponse } from '@flowiq/shared';
import { apiFetchJson, setApiAuthToken } from './apiClient';
import { buildApiUrl } from './apiBase';

type PasswordResetResponse = {
  message: string;
};

export async function login(email: string, password: string): Promise<LoginResponse> {
  const response = await fetch(buildApiUrl('/api/auth/login'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  const body = await response.json();

  if (!response.ok) {
    throw new Error(body?.error || 'Unable to sign in');
  }

  return body;
}

export async function fetchCurrentSession() {
  return apiFetchJson<LoginResponse['user']>('/api/auth/me');
}

export async function logout() {
  return apiFetchJson<{ loggedOut: boolean }>('/api/auth/logout', {
    method: 'POST',
  });
}

export async function fetchActiveUsersCount() {
  return apiFetchJson<ActiveUsersResponse>('/api/auth/active-users');
}

export function applyAuthToken(token: string | null) {
  setApiAuthToken(token);
}

export async function requestPasswordReset(email: string): Promise<PasswordResetResponse> {
  const response = await fetch(buildApiUrl('/api/auth/password-reset/request'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email }),
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error || 'Unable to send password reset email');
  }
  return body;
}

export async function confirmPasswordReset(token: string, password: string): Promise<PasswordResetResponse> {
  const response = await fetch(buildApiUrl('/api/auth/password-reset/confirm'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ token, password }),
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error || 'Unable to reset password');
  }
  return body;
}
