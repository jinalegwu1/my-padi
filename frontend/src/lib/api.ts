import { createConversationAPI } from './conversation-api';
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

export type VoiceConfiguration = { live_recognition_languages?: string[]; streaming_speech_languages?: string[]; local_speech?: boolean; speech_languages?: string[]; voice_text_streaming?: boolean; enabled: boolean; max_seconds: number; natural_speech?: boolean; live_speech?: boolean; language_selection?: boolean; local_transcription?: boolean; transcription_ready?: boolean; transcription_error?: string; transcription_model?: string; groq_conversation?: boolean; groq_live_speech?: boolean };

export const {
  sendChat, streamChat, streamVoiceChat, streamSpeechAudio, getVoiceConfiguration,
  synthesiseSpeech, fetchVoiceSample, transcribeAudio,
} = createConversationAPI(API_URL, APIError, requestJSON);

export type TranscriptResult = {
  text: string; user_id: string; request_id: string; language: string; language_probability: number; language_detected: boolean; model: string;
  duration_seconds: number; audio_bytes: number; decoded_pcm_bytes: number; codec: string; container: string;
  sample_rate: number; channels: number; decode_ms: number; prepare_ms: number; transcription_ms: number; processing_ms: number; service_ms: number;
};

function transcriptResponse(value: unknown): TranscriptResult {
  const result = value as TranscriptResult;
  if (!result || typeof result.text !== 'string' || !result.text.trim() || result.text.length > 8192 ||
      typeof result.user_id !== 'string' || !result.user_id || !/^[a-f0-9]{32}$/.test(result.request_id) ||
      typeof result.language !== 'string' || !/^[a-z]{2,3}$/.test(result.language) || typeof result.language_detected !== 'boolean' ||
      typeof result.model !== 'string' || !result.model || result.model.length > 128 || result.sample_rate !== 16000 || result.channels !== 1 ||
      !['opus', 'aac', 'pcm_s16le'].includes(result.codec) || !['webm', 'mp4', 'wav'].includes(result.container)) throw new Error('PADI returned an invalid transcription response.');
  for (const field of ['duration_seconds', 'audio_bytes', 'decoded_pcm_bytes', 'decode_ms', 'prepare_ms', 'transcription_ms', 'processing_ms', 'service_ms', 'language_probability'] as const) {
    if (!Number.isFinite(result[field]) || result[field] < 0) throw new Error('PADI returned invalid speech measurements.');
  }
  if (!Number.isSafeInteger(result.audio_bytes) || result.audio_bytes < 12 || result.audio_bytes > 8 * 1024 * 1024 ||
      !Number.isSafeInteger(result.decoded_pcm_bytes) || result.decoded_pcm_bytes < 2 || result.decoded_pcm_bytes > 1923200 || result.decoded_pcm_bytes % 2 ||
      Math.abs(result.decoded_pcm_bytes / 32000 - result.duration_seconds) > .001 || result.duration_seconds <= 0 || result.duration_seconds > 60.1 || result.language_probability > 1) throw new Error('PADI returned invalid speech measurements.');
  for (const field of ['decode_ms', 'prepare_ms', 'transcription_ms', 'processing_ms', 'service_ms'] as const) {
    if (result[field] > 200_000) throw new Error('PADI returned invalid speech measurements.');
  }
  return result;
}

/** Upload progress is measured by XHR; credentials and multipart boundaries are
 * handled separately so neither audio nor private text enters application logs. */
export function transcribeRecording(token: string, form: FormData, language: string, signal: AbortSignal,
  progress: (percent: number, uploaded: boolean) => void): Promise<TranscriptResult> {
  return new Promise((resolve, reject) => {
    if (!API_URL) { reject(new Error('The PADI backend address is not configured.')); return; }
    if (signal.aborted) { reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' })); return; }
    const xhr = new XMLHttpRequest();
    let settled = false;
    const abort = () => xhr.abort();
    const finish = (error?: Error, result?: TranscriptResult) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      xhr.onload = xhr.onerror = xhr.ontimeout = xhr.onabort = null;
      xhr.upload.onprogress = xhr.upload.onload = null;
      if (error) reject(error); else resolve(result!);
    };
    xhr.open('POST', `${API_URL}/v1/voice/transcribe?language=${encodeURIComponent(language)}`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.timeout = 200_000;
    xhr.upload.onprogress = event => { if (!settled && !signal.aborted) progress(event.lengthComputable && event.total > 0 ? Math.max(0, Math.min(100, event.loaded / event.total * 100)) : 0, false); };
    xhr.upload.onload = () => { if (!settled && !signal.aborted) progress(100, true); };
    xhr.onabort = () => finish(Object.assign(new Error('Cancelled'), { name: 'AbortError' }));
    xhr.onerror = () => finish(new Error('The recording could not upload. Check your connection and try again.'));
    xhr.ontimeout = () => finish(new Error('Speech processing timed out. Try a shorter recording.'));
    xhr.onload = () => {
      try {
        if (xhr.responseText.length > 64 * 1024) throw new Error('PADI returned an invalid speech response.');
        const body = JSON.parse(xhr.responseText);
        if (xhr.status < 200 || xhr.status >= 300) throw new APIError(typeof body.message === 'string' ? body.message : 'Speech processing failed.', xhr.status, typeof body.error === 'string' ? body.error : 'transcription_failed');
        finish(undefined, transcriptResponse(body));
      } catch (error) { finish(error instanceof SyntaxError ? new Error('The speech service returned an invalid response. Please try again.') : error instanceof Error ? error : new Error('Invalid speech response.')); }
    };
    signal.addEventListener('abort', abort, { once: true });
    try { xhr.send(form); } catch (error) { finish(error instanceof Error ? error : new Error('The recording could not upload.')); }
  });
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
