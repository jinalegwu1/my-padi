const { useCallback, useEffect, useRef, useState } = require('react');
const { AppState, Platform } = require('react-native');
const { useChat } = require('@/hooks/use-chat');
const { usePreferences } = require('@/hooks/use-preferences');
const { getVoiceConfiguration, transcribeAudio } = require('@/lib/api');
const { readSession, subscribeSession } = require('@/lib/session');
const { VoiceCapture } = require('@/lib/voice-capture');
const { audioUpload } = require('@/lib/voice-audio');
const { createSpeechStream } = require('@/lib/streaming-speech');
const { openLiveRecognition } = require('@/lib/live-recognition');
const { HandsfreeSession } = require('@/lib/handsfree-session');
const { unlockVoicePlayback } = require('@/lib/voice-playback');
const { suppressPlaybackEcho } = require('@/lib/voice-echo');
const { takeReadySpeech } = require('@/lib/voice-audio');

/** @typedef {'idle'|'preparing'|'listening'|'transcribing'|'thinking'|'speaking'} VoicePhase */
/** @typedef {{phase: VoicePhase, connected: boolean, padiText: string, userText?: string, error: string|null}} VoiceSnapshot */

/** Coordinates the full voice turn and exposes one snapshot to the voice screen. */
function useVoiceSession(output = undefined) {
  const chat = useChat();
  const {
    preferences
  } = usePreferences();
  const [voiceConfiguration, setVoiceConfiguration] = useState(/** @type {import('@/lib/api').VoiceConfiguration|null} */ (null));
  const supportsGroqSpeech = voiceConfiguration?.local_speech === true ? voiceConfiguration.speech_languages?.includes(preferences.languageCode) === true : voiceConfiguration?.groq_live_speech === true && preferences.voiceRate === 1 && ['en-NG', 'en-GB', 'pcm-NG'].includes(preferences.languageCode);
  const useLiveInput = voiceConfiguration?.live_recognition_languages?.includes(preferences.languageCode) === true;
  const useAudioChunks = voiceConfiguration?.streaming_speech_languages?.includes(preferences.languageCode) === true;
  const current = useRef({
    chat,
    preferences,
    useLiveInput,
    canTranscribe:voiceConfiguration?.transcription_ready,
    useAudioChunks,
    output
  });
  current.current = {
    chat,
    preferences,
    useLiveInput,
    canTranscribe:voiceConfiguration?.transcription_ready,
    useAudioChunks,
    output
  };
  const [snapshot, setSnapshot] = useState(/** @type {VoiceSnapshot} */ ({
    phase: 'idle',
    connected: false,
    padiText: '',
    error: null
  }));
  const latestSnapshot = useRef(snapshot);
  latestSnapshot.current = snapshot;
  const [ready, setReady] = useState(false);
  const [configurationError, setConfigurationError] = useState(null);
  const mounted = useRef(true);
  const sessionRef = useRef(/** @type {HandsfreeSession|null} */ (null));
  if (!sessionRef.current) sessionRef.current = new HandsfreeSession({
    readSession,
    capture: (frame, interrupted) => new VoiceCapture(frame, interrupted),
    filterFrame: suppressPlaybackEcho,
    openRecognition: async (token, signal, disconnected) => current.current.useLiveInput ? openLiveRecognition(token, current.current.preferences.languageCode, signal, disconnected) : null,
    canTranscribe: () => current.current.canTranscribe,
    transcribe: async (token, bytes, signal) => {
      const upload = audioUpload(bytes);
      try {
        return await transcribeAudio(token, upload.form, signal, current.current.preferences.languageCode);
      } finally {
        upload.dispose();
      }
    },
    send: (text, accountID, signal, onDelta, onStart) => current.current.chat.sendVoice(text, accountID, signal, current.current.preferences.languageCode, onDelta, onStart),
    createSpeech: (signal, onStart, completed) => {
      if (current.current.output) return current.current.output(signal, onStart, completed);
      const p = current.current.preferences;
      return createSpeechStream(p.voiceId, p.voiceRate, p.languageCode, signal, onStart, completed, current.current.useAudioChunks);
    },
    greet: async (signal, onText, onStart) => {
      const p = current.current.preferences;
      const account = await readSession();
      if (signal.aborted) return;
      if (!account) throw new Error('Sign in to talk with PADI.');
      const speechController = new AbortController();
      const abort = () => speechController.abort();
      signal.addEventListener('abort', abort, {
        once: true
      });
      const speech = current.current.output?.(speechController.signal, onStart, () => {}) ?? createSpeechStream(p.voiceId, p.voiceRate, p.languageCode, speechController.signal, onStart, () => {}, current.current.useAudioChunks);
      let text = '',
        remainder = '';
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
        if (!text) {
          onText(result.reply);
          speech.enqueue(result.reply);
        } else if (remainder.trim()) speech.enqueue(remainder);
        await speech.finish();
      } finally {
        speechController.abort();
        signal.removeEventListener('abort', abort);
      }
    },
    delivered: (id, words, interrupted, accountID) => current.current.chat.delivered(id, words, interrupted, accountID),
    changed: next => {
      if (mounted.current) setSnapshot(next);
    }
  });
  const session = sessionRef.current;
  const connect = useCallback((greet = true, wake = false, greetBeforeCapture = false) => {
    // Start unlocking synchronously in the tap handler while capture prepares.
    void unlockVoicePlayback().catch(error => {
      void session.cancel(error instanceof Error ? error.message : 'Tap to chat again to enable sound.');
    });
    void session.start({
      greet,
      wake,
      greetBeforeCapture
    });
  }, [session]);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    getVoiceConfiguration(controller.signal).then(config => {
      if (controller.signal.aborted) return;
      setVoiceConfiguration(config);
      const available = config.enabled && (config.voice_text_streaming === true || config.groq_conversation === true) && config.local_transcription === true && (config.transcription_ready === true || !!config.live_recognition_languages?.length) && config.natural_speech === true && (config.local_speech === true || config.groq_live_speech === true);
      setReady(available);
      if (!config.enabled) setConfigurationError('Local speech recognition is not enabled on this server.');else if (!config.voice_text_streaming && !config.groq_conversation) setConfigurationError('Voice conversations are not configured on this server.');else if (!config.local_transcription || !config.transcription_ready && !config.live_recognition_languages?.length) setConfigurationError('Local speech recognition is not ready yet. Please try again later.');else if (!config.natural_speech) setConfigurationError('PADI’s speech is not configured on this server. Please use text chat.');else if (!config.local_speech && !config.groq_live_speech) setConfigurationError('Spoken replies are not configured on this server. Please use text chat.');else setConfigurationError(null);
    }).catch(error => {
      if (!controller.signal.aborted) setConfigurationError(error instanceof Error ? error.message : 'Voice settings could not load.');
    });
    const unsubscribe = subscribeSession(() => {
      void session.cancel('Your account changed. Start a new voice turn after signing in.', true);
    });
    const background = () => {
      void session.cancel('Voice paused while the app was away. Tap PADI to continue.');
    };
    // Native permission sheets can briefly make the app inactive.
    const subscription = AppState.addEventListener('change', state => {
      if (!current.current.preferences.wakeWordEnabled && (state === 'background' || state === 'inactive' && latestSnapshot.current.phase !== 'preparing')) background();
    });
    const visibility = () => {
      if (document.hidden) background();
    };
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
  const supported = supportsGroqSpeech && (useLiveInput || voiceConfiguration?.transcription_ready === true);
  const selectionError = ready && !supported ? 'The selected language or pace is not supported by the current voice. Choose supported voice settings or use text chat.' : null;
  return {
    ...snapshot,
    configuration: voiceConfiguration,
    ready: ready && supported && chat.status === 'ready',
    configurationError: configurationError ?? selectionError,
    session,
    connect,
    chatError: chat.sendError,
    chatBusy: chat.isThinking
  };
}

module.exports = { useVoiceSession };
