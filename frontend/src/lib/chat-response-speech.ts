import { synthesiseSpeech } from '@/lib/api';
import { readSession } from '@/lib/session';
import { pauseStandaloneSpeech, playStandaloneSpeech, resumeStandaloneSpeech } from '@/lib/standalone-speech';
import { speechSegments } from '@/lib/voice-audio';

type SpeechAudio = Awaited<ReturnType<typeof synthesiseSpeech>>;

const MAX_CACHED_AUDIO_CHARS = 24 * 1024 * 1024;
const generatedAudio = new Map<string, SpeechAudio>();
let cachedAudioChars = 0;

function cachedSpeech(key: string): SpeechAudio | undefined {
  const audio = generatedAudio.get(key);
  if (!audio) return undefined;
  generatedAudio.delete(key);
  generatedAudio.set(key, audio);
  return audio;
}

function cacheSpeech(key: string, audio: SpeechAudio): void {
  const size = audio.audio_base64.length;
  if (size > MAX_CACHED_AUDIO_CHARS) return;
  const previous = generatedAudio.get(key);
  if (previous) {
    cachedAudioChars -= previous.audio_base64.length;
    generatedAudio.delete(key);
  }
  while (cachedAudioChars + size > MAX_CACHED_AUDIO_CHARS) {
    const oldestKey = generatedAudio.keys().next().value;
    if (oldestKey === undefined) break;
    const oldest = generatedAudio.get(oldestKey);
    if (oldest) cachedAudioChars -= oldest.audio_base64.length;
    generatedAudio.delete(oldestKey);
  }
  generatedAudio.set(key, audio);
  cachedAudioChars += size;
}

type Options = {
  text: string;
  voiceId: string;
  voiceRate: number;
  languageCode: string;
  signal: AbortSignal;
  onStart: () => void;
};

/** Speak the stored AI response itself, split only to respect the synthesis request limit. */
export function createChatResponseSpeech({ text, voiceId, voiceRate, languageCode, signal, onStart }: Options) {
  let paused = false;
  let resumePlayback: (() => void) | undefined;
  let playing: Promise<void> | undefined;

  const waitUntilResumed = () => paused
    ? new Promise<void>(resolve => { resumePlayback = resolve; })
    : Promise.resolve();

  const playResponse = async (): Promise<void> => {
    const session = await readSession();
    if (signal.aborted) return;
    if (!session) throw new Error('Sign in to hear PADI’s reply.');

    for (const segment of speechSegments(text)) {
      const key = JSON.stringify([session.user.id, voiceId, voiceRate, languageCode, segment]);
      let audio = cachedSpeech(key);
      if (!audio) {
        audio = await synthesiseSpeech(session.token, segment, voiceId, voiceRate, signal, languageCode);
        cacheSpeech(key, audio);
      }
      if (signal.aborted) return;
      await waitUntilResumed();
      if (signal.aborted) return;
      await playStandaloneSpeech(audio.audio_base64, signal, onStart, voiceId);
    }
  };

  return {
    play(): Promise<void> {
      if (playing) return playing;
      playing = playResponse().finally(() => { playing = undefined; });
      return playing;
    },
    async pause(): Promise<void> {
      paused = true;
      await pauseStandaloneSpeech();
    },
    async resume(): Promise<void> {
      paused = false;
      resumePlayback?.();
      resumePlayback = undefined;
      await resumeStandaloneSpeech();
    },
  };
}
