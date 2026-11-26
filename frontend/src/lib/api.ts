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
  greeting = false,
): Promise<{ reply: string; memory_revision: number }> {
  return requestJSON('/v1/chat', { messages, memory_revision: memoryRevision, delivery, voice_context: voiceContext,
    ...(greeting ? { greeting: true } : {}),
    ...(languageCode && (greeting || delivery === 'voice' && voiceLanguageSupported) ? { language: languageCode } : {}),
  }, { token, timeoutMs: 155_000, signal });
}

export function streamVoiceChat(
  token: string,
  messages: { role: 'user' | 'assistant'; content: string }[],
  memoryRevision: number,
  signal: AbortSignal,
  onText: (delta: string) => void,
  voiceContext?: { interrupted_reply: string; spoken_prefix: string },
  languageCode = 'en-NG',
  greeting = false,
): Promise<{ reply: string; memory_revision: number }> {
  return new Promise((resolve, reject) => {
    if (!API_URL) { reject(new Error('The PADI backend address is not configured in this app build.')); return; }
    if (signal.aborted) { reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' })); return; }
    const xhr = new XMLHttpRequest();
    let settled = false;
    let readOffset = 0;
    let buffered = '';
    let eventName = '';
    let eventData: string[] = [];
    let reply = '';
    let completed: { reply: string; memory_revision: number } | null = null;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      xhr.onload = xhr.onerror = xhr.onabort = xhr.ontimeout = xhr.onprogress = null;
      if (error) reject(error);
      else if (completed) resolve(completed);
      else reject(new Error('PADI ended the streamed response before it was complete.'));
    };
    const abort = () => xhr.abort();
    const timeout = setTimeout(() => xhr.abort(), 155_000);
    const failFromBody = (raw: string, status: number) => {
      let payload: { message?: unknown; error?: unknown } = {};
      try { payload = JSON.parse(raw) as typeof payload; } catch { /* use the standard message */ }
      finish(new APIError(typeof payload.message === 'string' ? payload.message : 'PADI could not get a response right now. Please try again.',
        status, typeof payload.error === 'string' ? payload.error : 'provider_unavailable'));
    };
    const dispatch = () => {
      if (!eventName || eventData.length === 0) { eventName = ''; eventData = []; return; }
      const name = eventName;
      const raw = eventData.join('\n');
      eventName = '';
      eventData = [];
      let data: unknown;
      try { data = JSON.parse(raw); }
      catch { throw new Error('PADI returned an invalid streamed response.'); }
      if (!data || typeof data !== 'object') throw new Error('PADI returned an invalid streamed response.');
      const value = data as { text?: unknown; reply?: unknown; memory_revision?: unknown; message?: unknown; error?: unknown };
      if (name === 'delta') {
        if (typeof value.text !== 'string' || !value.text) throw new Error('PADI returned invalid streamed text.');
        reply += value.text;
        if (reply.length > 200_000) throw new Error('PADI returned an oversized streamed response.');
        onText(value.text);
      } else if (name === 'error') {
        throw new APIError(typeof value.message === 'string' ? value.message : 'PADI could not get a response right now. Please try again.',
          502, typeof value.error === 'string' ? value.error : 'provider_unavailable');
      } else if (name === 'done') {
        if (typeof value.reply !== 'string' || value.reply !== reply ||
            !Number.isSafeInteger(value.memory_revision) || Number(value.memory_revision) < 0) {
          throw new Error('PADI returned an invalid completed response.');
        }
        completed = { reply: value.reply, memory_revision: Number(value.memory_revision) };
      } else {
        throw new Error('PADI returned an unsupported streamed event.');
      }
    };
    const consume = (chunk: string) => {
      buffered += chunk;
      let newline = buffered.indexOf('\n');
      while (newline >= 0) {
        const line = buffered.slice(0, newline).replace(/\r$/, '');
        buffered = buffered.slice(newline + 1);
        if (!line) dispatch();
        else if (line.startsWith('event:')) eventName = line.slice(6).trim();
        else if (line.startsWith('data:')) eventData.push(line.slice(5).trimStart());
        newline = buffered.indexOf('\n');
      }
    };
    const readProgress = () => {
      if (settled) return;
      try {
        const raw = xhr.responseText.slice(readOffset);
        readOffset = xhr.responseText.length;
        consume(raw);
      } catch (error) { finish(error instanceof Error ? error : new Error('PADI returned an invalid streamed response.')); xhr.abort(); }
    };
    xhr.open('POST', `${API_URL}/v1/chat`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.timeout = 155_000;
    xhr.onprogress = readProgress;
    xhr.onerror = () => finish(new Error('The live voice connection was interrupted. Please try again.'));
    xhr.ontimeout = () => finish(new Error('PADI took too long to respond. Please try again.'));
    xhr.onabort = () => finish(Object.assign(new Error('Cancelled'), { name: 'AbortError' }));
    xhr.onload = () => {
      if (settled) return;
      if (xhr.status < 200 || xhr.status >= 300) { failFromBody(xhr.responseText, xhr.status); return; }
      if (!xhr.getResponseHeader('Content-Type')?.toLowerCase().includes('text/event-stream')) {
        finish(new Error('PADI did not return a streamed voice response.'));
        return;
      }
      try {
        readProgress();
        if (buffered) { const line = buffered.replace(/\r$/, ''); buffered = ''; if (line.startsWith('data:')) eventData.push(line.slice(5).trimStart()); else if (line.startsWith('event:')) eventName = line.slice(6).trim(); }
        dispatch();
        if (completed && completed.reply.trim()) finish();
        else finish(new Error('PADI ended the streamed response before it was complete.'));
      } catch (error) { finish(error instanceof Error ? error : new Error('PADI returned an invalid streamed response.')); }
    };
    signal.addEventListener('abort', abort, { once: true });
    try {
      xhr.send(JSON.stringify({
        messages, memory_revision: memoryRevision, delivery: 'voice', stream: true, voice_context: voiceContext,
        ...(greeting ? { greeting: true } : {}),
        ...(languageCode && (greeting || voiceLanguageSupported) ? { language: languageCode } : {}),
      }));
    } catch (error) { finish(error instanceof Error ? error : new Error('The live voice request could not be sent.')); }
  });
}

let liveSpeechSupported = false;
let voiceLanguageSupported = false;

export type VoiceConfiguration = { live_recognition_languages?: string[]; streaming_speech_languages?: string[]; local_speech?: boolean; speech_languages?: string[]; voice_text_streaming?: boolean; enabled: boolean; max_seconds: number; natural_speech?: boolean; live_speech?: boolean; language_selection?: boolean; local_transcription?: boolean; transcription_ready?: boolean; transcription_error?: string; transcription_model?: string; groq_conversation?: boolean; groq_live_speech?: boolean };

/** XHR progress is available in Expo native and web, including while the
 * response is still arriving. Only complete newline-delimited packets play. */
export function streamSpeechAudio(token: string, text: string, style: string, rate: number, language: string,
  signal: AbortSignal, onChunk: (wave: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('Speech cancelled.')); return; }
    const xhr = new XMLHttpRequest();
    let offset = 0;
    let done = false;
    let chunks = 0;
    const abort = () => xhr.abort();
    const finish = (error?: Error) => {
      signal.removeEventListener('abort', abort);
      xhr.onload = xhr.onprogress = xhr.onabort = xhr.onerror = xhr.ontimeout = null;
      if (error) reject(error); else resolve();
    };
    const read = () => {
      if (xhr.status !== 200 || signal.aborted) return;
      const raw = xhr.responseText;
      let end = raw.indexOf('\n', offset);
      while (end >= 0) {
        const event = JSON.parse(raw.slice(offset, end));
        offset = end + 1;
        if (done) throw new Error('Unexpected audio after speech ended.');
        if (event.done === true && chunks) done = true;
        else if (typeof event.audio_base64 === 'string' && event.mime_type === 'audio/wav') {
          chunks++; onChunk(event.audio_base64);
        } else throw new Error('Invalid speech audio.');
        end = raw.indexOf('\n', offset);
      }
    };
    xhr.onprogress = () => { try { read(); } catch { finish(new Error('PADI’s speech was interrupted.')); xhr.abort(); } };
    xhr.onload = () => {
      try {
        if (xhr.status !== 200) throw new APIError('PADI’s voice could not play this reply.', xhr.status, 'speech_unavailable');
        read();
        if (!done) throw new Error('PADI’s speech ended early.');
        finish();
      } catch (error) { finish(error instanceof Error ? error : new Error('Invalid speech response.')); }
    };
    xhr.onabort = () => finish(new Error('Speech cancelled.'));
    xhr.onerror = xhr.ontimeout = () => finish(new Error('Could not receive PADI’s voice.'));
    xhr.open('POST', API_URL + '/v1/voice/speak');
    xhr.timeout = 65000;
    xhr.setRequestHeader('Authorization', 'Bearer ' + token);
    xhr.setRequestHeader('Content-Type', 'application/json');
    signal.addEventListener('abort', abort, { once: true });
    xhr.send(JSON.stringify({ text, style, rate, language, live: true, stream: true }));
  });
}

export async function getVoiceConfiguration(signal?: AbortSignal): Promise<VoiceConfiguration> {
  const result = await requestJSON<VoiceConfiguration>('/v1/voice/config', undefined, { method: 'GET', signal });
  if (typeof result?.enabled !== 'boolean' || result.max_seconds !== 60) throw new Error('PADI returned invalid voice settings.');
  liveSpeechSupported = result.live_speech === true;
  voiceLanguageSupported = result.language_selection === true;
  return result;
}

export async function synthesiseSpeech(token:string,text:string,style:string,rate:number,signal:AbortSignal,languageCode='en-NG',live=false,groqOnly=false):Promise<{audio_base64:string;mime_type:string}> {
  const result=await requestJSON<{audio_base64:string;mime_type:string}>('/v1/voice/speak',{text,style,rate,language:languageCode,...(live&&liveSpeechSupported?{live:true}:{}),...(groqOnly?{groq_only:true}:{})},{token,signal,timeoutMs:65_000});
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
  const result = await requestJSON<{ text: string }>(`/v1/voice/transcribe${query}`, audio, { token, multipart: true, timeoutMs: 200_000, signal });
  if (typeof result?.text !== 'string' || !result.text.trim()) throw new Error('PADI could not hear clear speech. Please try again.');
  return result.text.trim();
}

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
