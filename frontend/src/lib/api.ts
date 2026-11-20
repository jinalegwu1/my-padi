import { API_URL } from '@/lib/config';
import type { AppSession } from '@/lib/session';
import type { CheckInPreferences, CheckInPreferencesPatch, MemoryCategory, MemoryItem, MemorySnapshot, PersonalityPreferencePatch, PersonalityPreferences, ResponseRating } from '@/types';

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

export function submitResponseFeedback(token: string, messageID: string, rating: ResponseRating): Promise<void> {
  return requestJSON('/v1/personality/feedback', { message_id: messageID, rating }, { token }).then(() => undefined);
}

export type PushDeviceRegistration = {
  device_id: string;
  expo_push_token: string;
  platform: 'ios' | 'android';
  language: string;
};

export function registerPushDevice(token: string, registration: PushDeviceRegistration): Promise<void> {
  return requestJSON('/v1/push/devices', registration, { token }).then(() => undefined);
}

export function unregisterPushDevice(token: string, deviceID: string): Promise<void> {
  return requestJSON('/v1/push/devices', { device_id: deviceID }, { token, method: 'DELETE' }).then(() => undefined);
}

function personalityPreferences(value: unknown): PersonalityPreferences {
  if (!value || typeof value !== 'object') throw new Error('PADI returned invalid conversation preferences.');
  const result = value as Partial<PersonalityPreferences>;
  if (!['off', 'subtle', 'occasional', 'frequent'].includes(result.humour as string) ||
      typeof result.humour_explicit !== 'boolean' ||
      !['adaptive', 'playful', 'serious', 'gentle', 'direct'].includes(result.tone as string) ||
      typeof result.learn_from_feedback !== 'boolean') {
    throw new Error('PADI returned invalid conversation preferences.');
  }
  return result as PersonalityPreferences;
}

export async function fetchPersonalityPreferences(token: string): Promise<PersonalityPreferences> {
  return personalityPreferences(await requestJSON('/v1/personality/preferences', undefined, { token, method: 'GET' }));
}

export async function updatePersonalityPreferences(token: string, patch: PersonalityPreferencePatch): Promise<PersonalityPreferences> {
  return personalityPreferences(await requestJSON('/v1/personality/preferences', patch, { token, method: 'PATCH' }));
}

function checkInPreferences(value: unknown): CheckInPreferences {
  if (!value || typeof value !== 'object') throw new Error('PADI returned invalid check-in preferences.');
  const result = value as Partial<CheckInPreferences>;
  const validTime = (clock: unknown): clock is string =>
    typeof clock === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(clock);
  if (typeof result.morning_enabled !== 'boolean' || !validTime(result.morning_time) ||
      typeof result.afternoon_enabled !== 'boolean' || !validTime(result.afternoon_time) ||
      typeof result.evening_enabled !== 'boolean' || !validTime(result.evening_time) ||
      typeof result.timezone !== 'string' || result.timezone.length > 128 ||
      typeof result.quiet_hours_enabled !== 'boolean' || !validTime(result.quiet_hours_start) ||
      !validTime(result.quiet_hours_end)) {
    throw new Error('PADI returned invalid check-in preferences.');
  }
  return result as CheckInPreferences;
}

export async function fetchCheckInPreferences(token: string): Promise<CheckInPreferences> {
  return checkInPreferences(await requestJSON('/v1/check-ins/preferences', undefined, { token, method: 'GET' }));
}

export async function updateCheckInPreferences(token: string, patch: CheckInPreferencesPatch): Promise<CheckInPreferences> {
  return checkInPreferences(await requestJSON('/v1/check-ins/preferences', patch, { token, method: 'PATCH' }));
}

export function sendChat(
  token: string,
  messages: { role: 'user' | 'assistant'; content: string }[],
  memoryRevision = 0,
  signal?: AbortSignal,
  delivery: 'text' | 'voice' = 'text',
  voiceContext?: { interrupted_reply: string; spoken_prefix: string },
  languageCode?: string,
): Promise<{ reply: string; memory_revision: number }> {
  return requestJSON('/v1/chat', { messages, memory_revision: memoryRevision, delivery, voice_context: voiceContext,
    ...(delivery === 'voice' && voiceLanguageSupported && languageCode ? {language:languageCode} : {}),
  }, { token, timeoutMs: 155_000, signal });
}

let liveSpeechSupported = false;
let voiceLanguageSupported = false;

export async function getVoiceConfiguration(signal?: AbortSignal): Promise<{ enabled: boolean; max_seconds: number; natural_speech?: boolean; live_speech?: boolean; language_selection?: boolean }> {
  const result = await requestJSON<{ enabled: boolean; max_seconds: number; natural_speech?: boolean; live_speech?: boolean; language_selection?: boolean }>('/v1/voice/config', undefined, { method: 'GET', signal });
  if (typeof result?.enabled !== 'boolean' || result.max_seconds !== 60) throw new Error('PADI returned invalid voice settings.');
  liveSpeechSupported = result.live_speech === true;
  voiceLanguageSupported = result.language_selection === true;
  return result;
}

export async function synthesiseSpeech(token:string,text:string,style:string,rate:number,signal:AbortSignal,languageCode='en-NG',live=false):Promise<{audio_base64:string;mime_type:string}> {
  const result=await requestJSON<{audio_base64:string;mime_type:string}>('/v1/voice/speak',{text,style,rate,language:languageCode,...(live&&liveSpeechSupported?{live:true}:{})},{token,signal,timeoutMs:65_000});
  if(result?.mime_type!=='audio/wav' || typeof result.audio_base64!=='string' || !result.audio_base64 || result.audio_base64.length>12*1024*1024) throw new Error('PADI returned invalid speech audio.');
  return result;
}

export async function fetchVoiceSample(kind: 'welcome' | 'preview' | 'call', style: string, languageCode: string, rate: number, signal: AbortSignal): Promise<{audio_base64:string;mime_type:string;text?:string}> {
  const language = languageCode === 'pcm-NG' ? 'pcm-NG' : languageCode.toLowerCase().startsWith('fr') ? 'fr' : 'en-NG';
  const pace = rate < 0.95 ? 0.85 : rate > 1.05 ? 1.15 : 1;
  const query = kind === 'welcome' ? `style=${encodeURIComponent(style)}&language=${language}`
    : kind === 'call' ? `style=${encodeURIComponent(style)}&language=${encodeURIComponent(languageCode)}&rate=${pace}`
    : `style=${encodeURIComponent(style)}&rate=${pace}${voiceLanguageSupported ? `&language=${encodeURIComponent(languageCode)}` : ''}`;
  const result = await requestJSON<{audio_base64:string;mime_type:string;text?:string}>(`/v1/voice/${kind}?${query}`, undefined, {method:'GET',signal,timeoutMs:65_000});
  if(result?.mime_type!=='audio/wav'||typeof result.audio_base64!=='string'||!result.audio_base64||result.audio_base64.length>12*1024*1024) throw new Error('PADI returned invalid natural speech audio.');
  if(kind === 'call' && (typeof result.text !== 'string' || !result.text.trim())) throw new Error('PADI’s live greeting could not load.');
  return result;
}

export async function transcribeAudio(token: string, audio: FormData, signal: AbortSignal, languageCode?: string): Promise<string> {
  const query = voiceLanguageSupported && languageCode ? `?language=${encodeURIComponent(languageCode)}` : '';
  const result = await requestJSON<{ text: string }>(`/v1/voice/transcribe${query}`, audio, { token, multipart: true, timeoutMs: 55_000, signal });
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
