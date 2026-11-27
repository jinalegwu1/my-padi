import { HandsfreeSession, openLiveRecognition, prepareUpload } from './modules/voice-O2A7VXYY.js';
import { a as VoiceCapture } from './modules/chunk-Z7CSBWWK.js';
import { a as createSpeechStream } from './modules/chunk-AJUFN7HS.js';
import { b as collectSentences } from './modules/chunk-DOJQV6DN.js';
import { b as filterEcho } from './modules/chunk-4DYWZHQL.js';
import {
  a as supportsVoice, i as getVoiceConfig, l as transcribeAudio, o as readSession,
} from './modules/chunk-PRFFR5IG.js';

function inputError(config, language) {
  if (!config.enabled) return 'Speech recognition is turned off on this server.';
  if (!config.voice_text_streaming && !config.groq_conversation) return 'Voice conversations are unavailable on this server.';
  if (config.live_recognition_languages?.includes(language) || (config.local_transcription && config.transcription_ready)) return '';
  if (config.transcription_error === 'model_not_installed') return 'The server needs its speech recognition model before you can call.';
  return 'Speech recognition is getting ready. Tap the portrait to retry.';
}

export function openVoice({ chat, preferences, report, changed, expired, wake = false, autoStart = false }) {
  const { languageCode, voiceId, voiceRate } = preferences;
  const { token, user } = chat.account;
  let config;
  const englishCall = ['en-NG', 'pcm-NG', 'en-GB'].includes(languageCode);
  const lifetime = new AbortController();
  let initialConfig;
  let starting;
  let closed = false;
  let offer = null;
  let captionsOnly = false;
  let state = { phase: 'idle', connected: false, padiText: '' };
  function fastEnglishAvailable() {
    return englishCall && config?.enabled && config.natural_speech && config.local_speech &&
      config.speech_languages?.includes('en-GB') === true;
  }
  function useFastEnglish() {
    return preferences.fastEnglishVoice === true && fastEnglishAvailable();
  }
  function publish(next) {
    state = next;
    if (closed) return;
    if (!wake) changed({
      ...next, offer, captionsOnly,
      fastEnglishAvailable: !!fastEnglishAvailable(),
      defaultVoiceAvailable: !!config && supportsVoice(config, languageCode),
    });
    if (!wake || next.error) report(next.error || '');
  }

  function speech(signal, onStart, delivered) {
    if (captionsOnly) return null;
    // Capture the output choice once for the entire reply, including queued phrases.
    const fast = useFastEnglish();
    const streaming = !fast && config.streaming_speech_languages?.includes(languageCode) === true;
    return createSpeechStream(voiceId, voiceRate, fast ? 'en-GB' : languageCode, signal, onStart, delivered, streaming, user.id, true);
  }

  async function send(text, options) {
    const result = await chat.send(text, { ...options, voice: true });
    if (result.status === 'unauthorized') await expired(token);
    return result;
  }

  async function greet(signal, caption, onStart) {
    const output = new AbortController();
    const stop = () => output.abort();
    signal.addEventListener('abort', stop, { once: true });
    const player = speech(output.signal, onStart, () => {});
    const sentences = collectSentences(sentence => player?.enqueue(sentence), { live: true });
    let words = '';
    try {
      const result = await send('Hi', {
        greeting: true, signal,
        onDelta(delta) {
          words += delta;
          caption(words);
          sentences.append(delta);
        },
      });
      if (signal.aborted || result.status === 'unauthorized') return;
      if (result.status !== 'sent') throw new Error(chat.error || 'PADI could not load the greeting.');
      caption(result.reply);
      sentences.finish(result.reply);
      await player?.finish();
    } finally {
      stop();
      signal.removeEventListener('abort', stop);
    }
  }

  const session = new HandsfreeSession({
    readSession,
    capture: (frame, interrupted) => new VoiceCapture(frame, interrupted),
    filterFrame: filterEcho,
    canTranscribe: () => config.local_transcription && config.transcription_ready,
    openRecognition: (token, signal, disconnected) => config.live_recognition_languages?.includes(languageCode)
      ? openLiveRecognition(token, languageCode, signal, disconnected) : null,
    async transcribe(token, audio, signal) {
      const upload = prepareUpload(audio, config.lossless_voice_upload === true);
      try {
        return await transcribeAudio(token, upload.form, signal, languageCode);
      } catch (error) {
        if (error.status === 401) await expired(token);
        throw error;
      } finally {
        upload.dispose();
      }
    },
    send: (text, owner, signal, onDelta, onStart) => owner === user.id
      ? send(text, { signal, onDelta, onStart }) : Promise.resolve({ status: 'unauthorized' }),
    createSpeech: speech,
    delivered: (...args) => chat.delivered(...args).catch(error => { if (!closed) report(error.message); }),
    greet,
    changed: publish,
  });

  async function start(useCaptions = captionsOnly) {
    if (closed || starting || state.connected) return;
    const request = new AbortController();
    starting = request;
    offer = null;
    publish({ ...state, phase: 'checking', error: null });
    try {
      await session.stopping;
      if (request.signal.aborted) return;
      const prefetched = initialConfig;
      initialConfig = undefined;
      let available = await prefetched;
      if (request.signal.aborted) return;
      available ??= await getVoiceConfig(request.signal);
      if (request.signal.aborted) return;
      config = available;
      const error = inputError(config, languageCode);
      if (error) {
        publish({ ...state, phase: 'idle', error });
        return;
      }
      if (!useCaptions && !useFastEnglish() && !supportsVoice(config, languageCode)) {
        offer = { language: languageCode, speechEnabled: !!config.natural_speech };
        publish({ ...state, phase: 'idle', error: null });
        return;
      }
      captionsOnly = useCaptions;
      await session.start({ wake, greet: !wake, greetBeforeCapture: autoStart && !wake });
    } catch (error) {
      if (!request.signal.aborted) publish({ ...state, phase: 'idle', error: error.message });
    } finally {
      if (starting === request) starting = null;
    }
  }

  function stop(clearTranscript) {
    starting?.abort();
    starting = null;
    offer = null;
    return session.cancel(null, clearTranscript);
  }

  // A manual call can choose a voice before its greeting, without opening the mic.
  if (englishCall && !autoStart && !wake) {
    initialConfig = getVoiceConfig(lifetime.signal).then(available => {
      if (!closed && !config) {
        config = available;
        publish(state);
      }
      return available;
    }).catch(() => null);
  }

  return {
    start,
    touch(choice) {
      if (state.connected) return session.reactToTouch();
      return start((captionsOnly && !useFastEnglish()) || (!!offer && choice === 'captions'));
    },
    pause: () => stop(false),
    close() { closed = true; lifetime.abort(); return stop(true); },
  };
}
