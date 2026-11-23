import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { APIError, getVoiceConfiguration, transcribeRecording } from '@/lib/api';
import { VoiceRecording } from '@/lib/recording';
import { clearSession, readSession, subscribeSession } from '@/lib/session';
import { TranscriptionSession, type TranscriptionSnapshot } from '@/lib/transcription-session';

export function useTranscriptionSession() {
  const [snapshot, setSnapshot] = useState<TranscriptionSnapshot>({ phase: 'idle', transcript: null, recording: null, error: null, progress: 0, uploadMs: 0, totalMs: 0 });
  const [ready, setReady] = useState(false);
  const [configurationError, setConfigurationError] = useState<string | null>(null);
  const mounted = useRef(true);
  const ref = useRef<TranscriptionSession | null>(null);
  if (!ref.current) ref.current = new TranscriptionSession({
    readSession, recording: interrupted => new VoiceRecording(interrupted),
    transcribe: async (...args) => {
      try { return await transcribeRecording(...args); }
      catch (error) { if (error instanceof APIError && error.status === 401) await clearSession(); throw error; }
    },
    changed: state => { if (mounted.current) setSnapshot(state); },
  });
  const session = ref.current;
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const configure = async () => {
      try {
        const config = await getVoiceConfiguration(controller.signal);
        if (controller.signal.aborted) return;
        const available = config.enabled && config.local_transcription === true && config.transcription_ready === true;
        setReady(available);
        setConfigurationError(available ? null : config.transcription_error === 'model_loading' ? 'Speech recognition is warming up.' : 'Local speech recognition is not ready on this server.');
      } catch (error) {
        if (!controller.signal.aborted) { setReady(false); setConfigurationError(error instanceof Error ? error.message : 'Speech recognition could not connect.'); }
      }
      if (!controller.signal.aborted) timer = setTimeout(configure, 4000);
    };
    void configure();
    const account = subscribeSession(() => { void session.cancel('Your account changed. Start a new recording after signing in.', true); });
    const background = () => { void session.cancel('Recording was cancelled while the app was away.'); };
    const subscription = AppState.addEventListener('change', state => { if (state === 'background') background(); });
    const visibility = () => { if (document.hidden) background(); };
    if (Platform.OS === 'web') document.addEventListener('visibilitychange', visibility);
    return () => {
      mounted.current = false; controller.abort(); clearTimeout(timer);
      account(); subscription.remove();
      if (Platform.OS === 'web') document.removeEventListener('visibilitychange', visibility);
      void session.cancel();
    };
  }, [session]);
  return { ...snapshot, ready, configurationError, session };
}
