import { fetchVoiceSample } from '@/lib/api';
import { playVoice } from '@/lib/voice-playback';

/** A fixed, localized greeting can be cached without storing personal speech. */
export async function greetLive(style: string, language: string, rate: number, signal: AbortSignal,
  onText: (text: string) => void, onStart: () => void): Promise<void> {
  const greeting = await fetchVoiceSample('call', style, language, rate, signal);
  if (signal.aborted) return;
  onText(greeting.text!);
  await playVoice(greeting.audio_base64, signal, onStart, style);
}
