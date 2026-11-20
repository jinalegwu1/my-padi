import { speakVoicePreview } from '@/lib/speech';

/** The selected style uses Go's cached fixed sample and Python's voice model. */
export async function previewVoice(_text: string, style: string, rate: number, signal: AbortSignal, onStart: () => void, languageCode = 'en-NG', onText?: (text:string)=>void): Promise<void> {
  await speakVoicePreview(style, rate, signal, onStart, languageCode, onText);
}
