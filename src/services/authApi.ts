import { LoginResponse } from '../types';
import { apiFetchJson, setApiAuthToken } from './apiClient';
import { buildApiUrl } from './apiBase';

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

export function applyAuthToken(token: string | null) {
  setApiAuthToken(token);
}
