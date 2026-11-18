import * as Speech from 'expo-speech';

import { findVoice } from '@/data/languages';
import { spokenText } from '@/lib/spoken-text';

export function padiVoiceOptions(
  voiceId: string,
  rate: number,
): { pitch: number; rate: number } {
  const voice = findVoice(voiceId);
  return {
    pitch: voice.id === 'baby' ? 1.08 : 1,
    rate: Math.max(0.5, Math.min(1.5, rate)),
  };
}

export function padiSpeechLanguage(languageCode: string): string {
  return languageCode === 'pcm-NG' ? 'en-NG' : languageCode;
}

/** Resolve only from real playback callbacks; offer replay on autoplay failure. */
export async function speakPadiReply(text: string, voiceId: string, rate: number, languageCode: string, signal: AbortSignal, onStart: () => void): Promise<void> {
  const words = spokenText(text);
  if (!words) throw new Error('This reply is available in the transcript. There are no words to play.');
  const voices = await Speech.getAvailableVoicesAsync();
  if (signal.aborted) return;
  const language = padiSpeechLanguage(languageCode);
  const voice = voices.find(item => item.language.toLowerCase() === language.toLowerCase())
    ?? voices.find(item => item.language.split('-')[0] === language.split('-')[0]);
  if (!voice) throw new Error('No device speech voice is installed for this language. Read the reply in chat, or choose another language in Settings.');
  const limit = Math.min(3000, Speech.maxSpeechInputLength || 3000);
  const chunks: string[] = [];
  for (let offset = 0; offset < words.length;) {
    let end = Math.min(offset + limit, words.length);
    if (end < words.length) { const boundary = words.lastIndexOf(' ', end); if (boundary > offset) end = boundary; }
    chunks.push(words.slice(offset, end));
    offset = end;
  }
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let started = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(startTimer);
      clearTimeout(endTimer);
      signal.removeEventListener('abort', abort);
      if (error) { void stopPadiSpeech(); reject(error); } else resolve();
    };
    const abort = () => { void stopPadiSpeech(); finish(); };
    const startTimer = setTimeout(() => finish(new Error('Playback did not start. Tap Replay reply, or read the transcript.')), 8000);
    const endTimer = setTimeout(() => finish(new Error('Playback stopped responding. Tap Replay reply, or read the transcript.')), 10 * 60_000);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    try { chunks.forEach((chunk, index) => Speech.speak(chunk, {
      ...padiVoiceOptions(voiceId, rate), language, voice: voice.identifier,
      onStart: () => { if (!settled) { if (!started) { started = true; clearTimeout(startTimer); } onStart(); } },
      onDone: () => { if (index === chunks.length - 1) finish(); },
      onStopped: () => finish(new Error('Playback was interrupted. Tap Replay reply to hear it again.')),
      onError: () => finish(new Error('PADI could not play this reply. Tap Replay reply, or read the transcript.')),
    })); } catch { finish(new Error('PADI could not start playback. Tap Replay reply, or read the transcript.')); }
  });
}

export function stopPadiSpeech(): Promise<void> {
  return Speech.stop().catch((error: unknown) => {
    console.error('Could not stop PADI speech:', error);
  });
}
