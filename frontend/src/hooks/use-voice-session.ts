import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { useChat } from '@/hooks/use-chat';
import { usePreferences } from '@/hooks/use-preferences';
import { getVoiceConfiguration, transcribeAudio } from '@/lib/api';
import { readSession, subscribeSession } from '@/lib/session';
import { VoiceCapture } from '@/lib/voice-capture';
import { audioUpload } from '@/lib/voice-audio';
import { speakNaturally } from '@/lib/natural-speech';
import { stopPadiSpeech } from '@/lib/speech';
import type { VoiceSnapshot } from '@/lib/voice-session';
import { HandsfreeSession } from '@/lib/handsfree-session';

export function useVoiceSession() {
  const chat = useChat();
  const { preferences } = usePreferences();
  const current = useRef({ chat, preferences });
  current.current = { chat, preferences };
  const [snapshot, setSnapshot] = useState<VoiceSnapshot & { connected: boolean }>({ phase: 'idle', connected: false, padiText: 'Start a conversation. I’ll listen and reply when you finish speaking.', error: null });
  const latestSnapshot = useRef(snapshot);
  latestSnapshot.current = snapshot;
  const [ready, setReady] = useState(false);
  const [configurationError, setConfigurationError] = useState<string | null>(null);
  const mounted = useRef(true);
  const sessionRef = useRef<HandsfreeSession | null>(null);
  if (!sessionRef.current) sessionRef.current = new HandsfreeSession({
    readSession,
    capture: (frame, interrupted) => new VoiceCapture(frame, interrupted),
    transcribe: async (token, bytes, signal) => {
      const upload = audioUpload(bytes);
      try { return await transcribeAudio(token, upload.form, signal); }
      finally { upload.dispose(); }
    },
    send: (text, accountID, signal) => current.current.chat.sendVoice(text, accountID, signal),
    speak: (text, signal, onStart, completed) => {
      const p = current.current.preferences;
      return speakNaturally(text, p.voiceId, p.voiceRate, signal, onStart, completed);
    },
    delivered: (id, words, interrupted, accountID) => current.current.chat.delivered(id, words, interrupted, accountID),
    changed: next => { if (mounted.current) setSnapshot(next); },
  });
  const session = sessionRef.current;

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    getVoiceConfiguration(controller.signal).then(config => {
      if (controller.signal.aborted) return;
      setReady(config.enabled && config.natural_speech === true);
      if (!config.enabled || !config.natural_speech) setConfigurationError('Voice conversations are not available in this build yet.');
    }).catch(error => { if (!controller.signal.aborted) setConfigurationError(error instanceof Error ? error.message : 'Voice settings could not load.'); });
    const unsubscribe = subscribeSession(() => { void session.cancel('Your account changed. Start a new voice turn after signing in.', true); });
    const background = () => { void session.cancel('Voice paused while the app was away. Tap the microphone to continue.'); };
    // Native permission sheets can briefly make the app inactive.
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'background' || (state === 'inactive' && latestSnapshot.current.phase !== 'preparing')) background();
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

  return { ...snapshot, ready: ready && chat.status === 'ready', configurationError, session, chatError: chat.sendError, chatBusy: chat.isThinking };
}
