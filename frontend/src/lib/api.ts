import { API_URL } from '@/lib/config';
import type { AppSession } from '@/lib/session';
import type { MemoryCategory, MemoryItem, MemorySnapshot } from '@/types';

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
  options: { token?: string; timeoutMs?: number; method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; signal?: AbortSignal; multipart?: boolean } = {},
): Promise<T> {
  if (!API_URL) {
    throw new Error('The PADI backend address is not configured in this app build.');
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  try {
    const response = await fetch(`${API_URL}${path}`, {
      method: options.method ?? 'POST',
      headers: {
        ...(!options.multipart ? { 'Content-Type': 'application/json' } : {}),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.multipart ? body as FormData : JSON.stringify(body),
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
      if (options.signal?.aborted) throw error;
      throw new Error('The request timed out. Please try again.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
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
  memoryRevision = 0,
  signal?: AbortSignal,
  delivery: 'text' | 'voice' = 'text',
  voiceContext?: { interrupted_reply: string; spoken_prefix: string },
): Promise<{ reply: string; memory_revision: number }> {
  return requestJSON('/v1/chat', { messages, memory_revision: memoryRevision, delivery, voice_context: voiceContext }, { token, timeoutMs: 155_000, signal });
}

export async function getVoiceConfiguration(signal?: AbortSignal): Promise<{ enabled: boolean; max_seconds: number; natural_speech?: boolean }> {
  const result = await requestJSON<{ enabled: boolean; max_seconds: number; natural_speech?: boolean }>('/v1/voice/config', undefined, { method: 'GET', signal });
  if (typeof result?.enabled !== 'boolean' || result.max_seconds !== 60) throw new Error('PADI returned invalid voice settings.');
  return result;
}

export async function synthesiseSpeech(token:string,text:string,style:string,rate:number,signal:AbortSignal,languageCode='en-NG'):Promise<{audio_base64:string;mime_type:string}> {
  const result=await requestJSON<{audio_base64:string;mime_type:string}>('/v1/voice/speak',{text,style,rate,language:languageCode},{token,signal,timeoutMs:65_000});
  if(result?.mime_type!=='audio/wav' || typeof result.audio_base64!=='string' || !result.audio_base64 || result.audio_base64.length>12*1024*1024) throw new Error('PADI returned invalid speech audio.');
  return result;
}

export async function fetchVoiceSample(kind: 'welcome' | 'preview', style: string, languageCode: string, rate: number, signal: AbortSignal): Promise<{audio_base64:string;mime_type:string}> {
  const language = languageCode === 'pcm-NG' ? 'pcm-NG' : languageCode.toLowerCase().startsWith('fr') ? 'fr' : 'en-NG';
  const pace = rate < 0.95 ? 0.85 : rate > 1.05 ? 1.15 : 1;
  const query = kind === 'welcome' ? `style=${encodeURIComponent(style)}&language=${language}` : `style=${encodeURIComponent(style)}&rate=${pace}`;
  const result = await requestJSON<{audio_base64:string;mime_type:string}>(`/v1/voice/${kind}?${query}`, undefined, {method:'GET',signal,timeoutMs:65_000});
  if(result?.mime_type!=='audio/wav'||typeof result.audio_base64!=='string'||!result.audio_base64||result.audio_base64.length>12*1024*1024) throw new Error('PADI returned invalid natural speech audio.');
  return result;
}

export async function transcribeAudio(token: string, audio: FormData, signal: AbortSignal): Promise<string> {
  const result = await requestJSON<{ text: string }>('/v1/voice/transcribe', audio, { token, multipart: true, timeoutMs: 55_000, signal });
  if (typeof result?.text !== 'string' || !result.text.trim()) throw new Error('PADI could not hear clear speech. Please try again.');
  return result.text.trim();
}

const memoryCategories: MemoryCategory[] = ['name', 'interests', 'relationships', 'preferences', 'plans'];

function memorySnapshot(value: unknown): MemorySnapshot {
  if (!value || typeof value !== 'object') throw new Error('PADI returned invalid memory data.');
  const snapshot = value as { enabled?: unknown; revision?: unknown; items?: unknown };
  if (typeof snapshot.enabled !== 'boolean' || !Number.isSafeInteger(snapshot.revision) || Number(snapshot.revision) < 0 || !Array.isArray(snapshot.items) || snapshot.items.length > 100) {
    throw new Error('PADI returned invalid memory data.');
  }
  const items = snapshot.items.map((raw): MemoryItem => {
    const item = raw as Record<string, unknown> | null;
    if (!item || typeof item.id !== 'string' || !item.id || typeof item.category !== 'string' || !memoryCategories.includes(item.category as MemoryCategory) ||
      typeof item.label !== 'string' || !item.label.trim() || Array.from(item.label).length > 100 ||
      typeof item.value !== 'string' || !item.value.trim() || Array.from(item.value).length > 500 || typeof item.paused !== 'boolean' || typeof item.source !== 'string' ||
      typeof item.created_at !== 'string' || !Number.isFinite(Date.parse(item.created_at))) {
      throw new Error('PADI returned an invalid memory entry.');
    }
    return { id: item.id, category: item.category as MemoryCategory, label: item.label, value: item.value,
      paused: item.paused, source: item.source, createdAt: Date.parse(item.created_at) };
  });
  return { enabled: snapshot.enabled, revision: Number(snapshot.revision), items };
}

export async function fetchMemory(token: string): Promise<MemorySnapshot> {
  return memorySnapshot(await requestJSON('/v1/memory', undefined, { token, method: 'GET' }));
}

export async function setMemoryEnabled(token: string, enabled: boolean): Promise<MemorySnapshot> {
  return memorySnapshot(await requestJSON('/v1/memory/settings', { enabled }, { token, method: 'PATCH' }));
}

export async function createMemory(token: string, draft: { category: MemoryCategory; label: string; value: string }): Promise<MemorySnapshot> {
  return memorySnapshot(await requestJSON('/v1/memory', { ...draft, approved: true }, { token }));
}

export async function updateMemory(token: string, id: string, update: { value?: string; paused?: boolean }): Promise<MemorySnapshot> {
  return memorySnapshot(await requestJSON(`/v1/memory/${encodeURIComponent(id)}`, update, { token, method: 'PATCH' }));
}

export async function deleteMemory(token: string, id: string): Promise<MemorySnapshot> {
  return memorySnapshot(await requestJSON(`/v1/memory/${encodeURIComponent(id)}`, undefined, { token, method: 'DELETE' }));
}
