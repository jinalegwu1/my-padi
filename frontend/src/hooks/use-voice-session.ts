import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { useChat } from '@/hooks/use-chat';
import { usePreferences } from '@/hooks/use-preferences';
import { getVoiceConfiguration, transcribeAudio, type VoiceConfiguration } from '@/lib/api';
import { readSession, subscribeSession } from '@/lib/session';
import { VoiceCapture } from '@/lib/voice-capture';
import { audioUpload } from '@/lib/voice-audio';
import { createGroqSpeechStream } from '@/lib/streaming-speech';
import type { VoiceSnapshot } from '@/lib/voice-session';
import { HandsfreeSession } from '@/lib/handsfree-session';
import { unlockVoicePlayback } from '@/lib/voice-playback';
import { suppressPlaybackEcho } from '@/lib/voice-echo';
import { takeReadySpeech } from '@/lib/voice-audio';

/** Coordinates the full voice turn and exposes one snapshot to the voice screen. */
export function useVoiceSession() {
  const chat = useChat();
  const { preferences } = usePreferences();
  const [voiceConfiguration, setVoiceConfiguration] = useState<VoiceConfiguration | null>(null);
  const supportsGroqSpeech = voiceConfiguration?.groq_live_speech === true &&
    preferences.voiceRate === 1 && ['en-NG', 'en-GB', 'pcm-NG'].includes(preferences.languageCode);
  const current = useRef({ chat, preferences, supportsGroqSpeech });
  current.current = { chat, preferences, supportsGroqSpeech };
  const [snapshot, setSnapshot] = useState<VoiceSnapshot & { connected: boolean }>({ phase: 'idle', connected: false, padiText: '', error: null });
  const latestSnapshot = useRef(snapshot);
  latestSnapshot.current = snapshot;
  const [ready, setReady] = useState(false);
  const [configurationError, setConfigurationError] = useState<string | null>(null);
  const mounted = useRef(true);
  const sessionRef = useRef<HandsfreeSession | null>(null);
  if (!sessionRef.current) sessionRef.current = new HandsfreeSession({
    readSession,
    capture: (frame, interrupted) => new VoiceCapture(frame, interrupted),
    filterFrame:suppressPlaybackEcho,
    transcribe: async (token, bytes, signal) => {
      const upload = audioUpload(bytes);
      try { return await transcribeAudio(token, upload.form, signal, current.current.preferences.languageCode); }
      finally { upload.dispose(); }
    },
    send: (text, accountID, signal, onDelta, onStart) => current.current.chat.sendVoice(
      text, accountID, signal, current.current.preferences.languageCode, onDelta, onStart),
    createSpeech: (signal, onStart, completed) => {
      const p = current.current.preferences;
      return createGroqSpeechStream(p.voiceId,p.voiceRate,p.languageCode,signal,onStart,completed);
    },
    greet: async (signal, onText, onStart) => {
      const p = current.current.preferences;
      const account = await readSession();
      if (signal.aborted) return;
      if (!account) throw new Error('Sign in to talk with PADI.');
      const speechController = new AbortController();
      const abort = () => speechController.abort();
      signal.addEventListener('abort', abort, { once: true });
      const speech=createGroqSpeechStream(p.voiceId,p.voiceRate,p.languageCode,speechController.signal,onStart,()=>{});
      let text = '', remainder = '';
      try {
        const result = await current.current.chat.greet(account.user.id, p.languageCode, signal, delta => {
          if (signal.aborted) return;
          text += delta;
          onText(text);
          const ready = takeReadySpeech(remainder + delta);
          remainder = ready.remainder;
          ready.sentences.forEach(sentence => speech.enqueue(sentence));
        });
        if (signal.aborted) return;
        if (result.status !== 'sent' || !result.reply) throw new Error('PADI’s greeting could not load. You can still talk to me.');
        if (!text) { onText(result.reply); speech.enqueue(result.reply); }
        else if (remainder.trim()) speech.enqueue(remainder);
        await speech.finish();
      } finally {
        speechController.abort();
        signal.removeEventListener('abort', abort);
      }
    },
    delivered: (id, words, interrupted, accountID) => current.current.chat.delivered(id, words, interrupted, accountID),
    changed: next => { if (mounted.current) setSnapshot(next); },
  });
  const session = sessionRef.current;
  const connect = useCallback((greet = true, wake = false) => {
    // Start unlocking synchronously in the tap handler while capture prepares.
    void unlockVoicePlayback().catch(error => { void session.cancel(error instanceof Error ? error.message : 'Tap to chat again to enable sound.'); });
    void session.start({ greet, wake });
  }, [session]);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    getVoiceConfiguration(controller.signal).then(config => {
      if (controller.signal.aborted) return;
      setVoiceConfiguration(config);
      const available = config.enabled && config.groq_conversation === true &&
        config.local_transcription === true && config.transcription_ready === true && config.natural_speech === true && config.groq_live_speech === true;
      setReady(available);
      if (!config.enabled) setConfigurationError('Local speech recognition is not enabled on this server.');
      else if (!config.groq_conversation) setConfigurationError('Groq voice conversations are not configured on this server.');
      else if (!config.local_transcription || !config.transcription_ready) setConfigurationError('Local speech recognition is not ready yet. Please try again later.');
      else if (!config.natural_speech) setConfigurationError('PADI’s speech is not configured on this server. Please use text chat.');
      else if (!config.groq_live_speech) setConfigurationError('Groq speech is not configured on this server. Please use text chat.');
      else setConfigurationError(null);
    }).catch(error => { if (!controller.signal.aborted) setConfigurationError(error instanceof Error ? error.message : 'Voice settings could not load.'); });
    const unsubscribe = subscribeSession(() => { void session.cancel('Your account changed. Start a new voice turn after signing in.', true); });
    const background = () => { void session.cancel('Voice paused while the app was away. Tap PADI to continue.'); };
    // Native permission sheets can briefly make the app inactive.
    const subscription = AppState.addEventListener('change', state => {
      if (!current.current.preferences.wakeWordEnabled &&
          (state === 'background' || (state === 'inactive' && latestSnapshot.current.phase !== 'preparing'))) background();
    });
    const visibility = () => { if (document.hidden) background(); };
    if (Platform.OS === 'web') document.addEventListener('visibilitychange', visibility);
    return () => {
      mounted.current = false;
      controller.abort();
      unsubscribe();
      subscription.remove();
      if (Platform.OS === 'web') document.removeEventListener('visibilitychange', visibility);
      void session.cancel();
    };
  }, [session]);

  const selectionError=ready&&!supportsGroqSpeech?'Groq speech needs English or Nigerian Pidgin at normal speed. Choose these voice settings or use text chat.':null;
  return { ...snapshot, ready: ready && supportsGroqSpeech && chat.status === 'ready', configurationError:configurationError??selectionError, session, connect, chatError: chat.sendError, chatBusy: chat.isThinking };
}
