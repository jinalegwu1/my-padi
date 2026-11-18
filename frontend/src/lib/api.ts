import { API_URL } from '@/lib/config';
import type { AppSession } from '@/lib/session';

export class APIError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'APIError';
  }
}

type ChallengeResponse =
  | { challenge_id: string; message: string; session?: never }
  | { session: AppSession; message: string; challenge_id?: never };

async function requestJSON<T>(
  path: string,
  body: unknown,
  options: { token?: string; timeoutMs?: number; method?: 'GET' | 'POST' } = {},
): Promise<T> {
  if (!API_URL) {
    throw new Error('The PADI backend address is not configured in this app build.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  try {
    const response = await fetch(`${API_URL}${path}`, {
      method: options.method ?? 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (response.status === 204) return undefined as T;
    const raw = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      if (!response.ok) {
        throw new APIError('The request could not be completed.', response.status, 'request_failed');
      }
      throw new Error('The PADI backend returned an invalid response.');
    }
    if (!response.ok) {
      const error = data as { message?: unknown; error?: unknown } | null;
      throw new APIError(
        typeof error?.message === 'string' ? error.message : 'The request could not be completed.',
        response.status,
        typeof error?.error === 'string' ? error.error : 'request_failed',
      );
    }
    return data as T;
  } catch (error) {
    if (error instanceof APIError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('The request timed out. Please try again.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getAuthConfiguration(): Promise<{ otp_required: boolean }> {
  const config = await requestJSON<{ otp_required: unknown }>('/v1/auth/config', undefined, { method: 'GET' });
  if (typeof config?.otp_required !== 'boolean') {
    throw new Error('PADI could not load the sign-in settings. Please try again.');
  }
  return { otp_required: config.otp_required };
}

export function requestRegistration(input: {
  full_name: string;
  date_of_birth: string;
  phone_number: string;
}): Promise<ChallengeResponse> {
  return requestJSON('/v1/auth/register', input);
}

export function requestLogin(phone_number: string): Promise<ChallengeResponse> {
  return requestJSON('/v1/auth/login', { phone_number });
}

export function verifyCode(challenge_id: string, code: string): Promise<AppSession> {
  return requestJSON('/v1/auth/verify', { challenge_id, code });
}

export function revokeSession(token: string): Promise<void> {
  return requestJSON('/v1/auth/logout', {}, { token }).then(() => undefined);
}

export function sendChat(
  token: string,
  messages: { role: 'user' | 'assistant'; content: string }[],
): Promise<{ reply: string }> {
  return requestJSON('/v1/chat', { messages }, { token, timeoutMs: 155_000 });
}
