import * as Speech from 'expo-speech';

import { findVoice } from '@/data/languages';

export function padiVoiceOptions(
  voiceId: string,
  rate: number,
): { pitch: number; rate: number } {
  const voice = findVoice(voiceId);
  return {
    pitch: voice.id === 'baby' ? 1.5 : voice.gender === 'female' ? 1.2 : 1,
    rate: Math.max(0.5, Math.min(1.5, rate * 0.9)),
  };
}

export function padiSpeechLanguage(languageCode: string): string {
  return ['en-NG', 'en-GB', 'pcm-NG', 'fr-FR'].includes(languageCode) ? languageCode : 'en-GB';
}

export function stopPadiSpeech(): Promise<void> {
  return Speech.stop().catch((error: unknown) => {
    console.error('Could not stop PADI speech:', error);
  });
}
