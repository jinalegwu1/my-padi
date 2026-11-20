import { fetchVoiceSample, synthesiseSpeech } from '@/lib/api';
import { readSession, subscribeSession } from '@/lib/session';
import { speechSegments } from '@/lib/voice-audio';
import { spokenText } from '@/lib/spoken-text';
import { playStandaloneSpeech } from '@/lib/standalone-speech';
import { unlockVoicePlayback } from '@/lib/voice-playback';

export type SpeechOutcome = 'played' | 'cancelled';
let active: AbortController | null = null;

// Preference mapping retained for compatibility; all PADI speech uses its
// expressive engine and every style keeps a normal pitch.
export function padiVoiceOptions(_voiceId: string, rate: number): { pitch: number; rate: number } {
  return { pitch: 1, rate: Math.max(0.5, Math.min(1.5, rate)) };
}

export function padiSpeechLanguage(languageCode: string): string {
  return languageCode;
}

async function performSpeech(signal: AbortSignal, play: (signal: AbortSignal) => Promise<void>): Promise<SpeechOutcome> {
  active?.abort();
  const controller = new AbortController(); active = controller;
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  const unsubscribe = subscribeSession(abort);
  const unlocked = unlockVoicePlayback();
  if (signal.aborted) abort();
  try {
    await unlocked;
    if (!controller.signal.aborted) await play(controller.signal);
    return controller.signal.aborted ? 'cancelled' : 'played';
  } catch (error) {
    if (controller.signal.aborted) return 'cancelled';
    throw error;
  } finally {
    unsubscribe(); signal.removeEventListener('abort', abort);
    if (active === controller) active = null;
  }
}

/** Personal text stays behind Go account authentication. */
export function speakPadiReply(text: string, voiceId: string, rate: number, languageCode: string, signal: AbortSignal, onStart: () => void): Promise<SpeechOutcome> {
  return performSpeech(signal, async current => {
    const words = spokenText(text);
    if (!words) throw new Error('This reply is available as text. There are no words to speak.');
    const session = await readSession();
    if (current.aborted) return;
    if (!session) throw new Error('Sign in to hear PADI’s natural spoken greeting. Your greeting is available as text.');
    for (const passage of speechSegments(words)) {
      const audio = await synthesiseSpeech(session.token, passage, voiceId, rate, current, languageCode);
      if (current.aborted) return;
      await playStandaloneSpeech(audio.audio_base64, current, onStart, voiceId);
      if (current.aborted) return;
    }
  });
}

/** Go supplies only fixed public introduction text before sign-in. */
export function speakPadiWelcome(voiceId: string, languageCode: string, signal: AbortSignal, onStart: () => void): Promise<SpeechOutcome> {
  return performSpeech(signal, async current => {
    const audio = await fetchVoiceSample('welcome', voiceId, languageCode, 1, current);
    if (!current.aborted) await playStandaloneSpeech(audio.audio_base64, current, onStart, voiceId);
  });
}

export function speakVoicePreview(voiceId: string, rate: number, signal: AbortSignal, onStart: () => void, languageCode = 'en-NG', onText?: (text:string)=>void): Promise<SpeechOutcome> {
  return performSpeech(signal, async current => {
    const audio = await fetchVoiceSample('preview', voiceId, languageCode, rate, current);
    if (!current.aborted && audio.text) onText?.(audio.text);
    if (!current.aborted) await playStandaloneSpeech(audio.audio_base64, current, onStart, voiceId);
  });
}

export function speakPortraitGreeting(voiceId:string,languageCode:string,rate:number,signal:AbortSignal,
  onStart:()=>void,onText:(text:string)=>void):Promise<SpeechOutcome> {
  return performSpeech(signal,async current=>{
    const audio=await fetchVoiceSample('call',voiceId,languageCode,rate,current);
    if(current.aborted)return;
    onText(audio.text!);
    await playStandaloneSpeech(audio.audio_base64,current,onStart,voiceId);
  });
}

export async function stopPadiSpeech(): Promise<void> { active?.abort(); }
