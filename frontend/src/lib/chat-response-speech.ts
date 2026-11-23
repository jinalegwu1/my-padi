import { synthesiseSpeech } from '@/lib/api';
import { readSession } from '@/lib/session';
import { pauseStandaloneSpeech, playStandaloneSpeech, resumeStandaloneSpeech } from '@/lib/standalone-speech';
import { speechSegments } from '@/lib/voice-audio';

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

  const waitUntilResumed = () => paused
    ? new Promise<void>(resolve => { resumePlayback = resolve; })
    : Promise.resolve();

  return {
    async play(): Promise<void> {
      const session = await readSession();
      if (signal.aborted) return;
      if (!session) throw new Error('Sign in to hear PADI’s reply.');

      for (const segment of speechSegments(text)) {
        const audio = await synthesiseSpeech(session.token, segment, voiceId, voiceRate, signal, languageCode);
        if (signal.aborted) return;
        await waitUntilResumed();
        if (signal.aborted) return;
        await playStandaloneSpeech(audio.audio_base64, signal, onStart, voiceId);
      }
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
