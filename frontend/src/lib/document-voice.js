import { readSession } from '@/lib/session';
import { streamSpeechAudio, synthesiseSpeech } from '@/lib/api';
import { spokenText } from '@/lib/spoken-text';
import { prepareWaveReference } from '@/lib/voice-echo';
import { createPhrasePlayback, prepareVoicePackets } from '../../public/padi-chat/phrase-playback';

// The WebView owns the speaker. The native host retains the session, HTTP,
// microphone and its far-end reference for echo cancellation.
export function createDocumentVoice() {
  let publish;
  let current;
  let serial = 0;

  function queue(signal, echo) {
    let nextClip = 0;
    let failure;
    const id = ++serial;
    const clips = new Map();
    function close(error) {
      if (current?.id !== id) return;
      publish?.({action:'stop', id});
      current = null;
      failure = error;
      for (const clip of clips.values()) {
        clip.stopReference?.();
        if (error) clip.reject(error); else clip.resolve(false);
      }
      clips.clear();
      signal.removeEventListener('abort', abort);
    }
    const abort = () => close();
    function event({clip: number, state}) {
      if (state === 'failed') { close(new Error('PADI’s audio could not play. Tap Play to retry.')); return; }
      const clip = clips.get(number);
      if (!clip || signal.aborted) return;
      if (state === 'playing' && !clip.started) {
        clip.started = true;
        const start = Date.now();
        clip.stopReference = clip.reference?.(() => (Date.now() - start) / 1000);
        clip.onStart();
      } else if (state === 'ended') {
        clips.delete(number);
        clip.stopReference?.();
        clip.completed();
        clip.resolve(true);
      }
    }
    current?.close();
    current = {id, event, close};
    signal.addEventListener('abort', abort, {once:true});
    if (signal.aborted) abort();
    else publish?.({action:'begin', id});
    return {
      enqueue(wave, onStart, completed) {
        if (failure) return Promise.reject(failure);
        if (signal.aborted || current?.id !== id) return Promise.resolve(false);
        if (!publish) return Promise.reject(new Error('The voice screen is still opening. Tap Play again.'));
        const number = ++nextClip;
        const reference = echo ? prepareWaveReference(wave) : null;
        let resolve, reject;
        const done = new Promise((yes, no) => { resolve = yes; reject = no; });
        clips.set(number, {done, resolve, reject, onStart, completed, reference});
        publish({action:'clip', id, clip:number, wave});
        return done;
      },
      async finish() {
        try {
          if (current?.id === id) publish?.({action:'finish', id});
          await Promise.all([...clips.values()].map(clip => clip.done));
          if (failure) throw failure;
        } finally { close(); }
      },
    };
  }
  return {
    attach(send) { publish = send; },
    detach() { current?.close(new Error('Voice screen closed.')); publish = null; },
    receive(event) {
      if (event?.id === current?.id && Number.isSafeInteger(event?.id) &&
          ['playing','ended','failed'].includes(event.state)) current.event(event);
    },
    pause() { if (current) publish?.({action:'pause', id:current.id}); },
    resume() { if (current) publish?.({action:'resume', id:current.id}); },
    stream({owner, languageCode, voiceRate, streaming, live = false, echo = live}, signal, onStart, delivered) {
      let session;
      return createPhrasePlayback({
        signal, live, clean:spokenText, onStart, delivered, makePlayer: stop => queue(stop, echo),
        async prepare(words, stop, packet) {
          const account = await (session ??= readSession());
          if (stop.aborted) return;
          if (!account || account.user.id !== owner) throw new Error('Sign in to hear this reply.');
          const key = JSON.stringify(['baby', voiceRate, languageCode, words]);
          await prepareVoicePackets(owner, key, stop, async emit => {
            if (streaming) return streamSpeechAudio(account.token, words, 'baby', voiceRate, languageCode, stop, emit);
            const result = await synthesiseSpeech(account.token, words, 'baby', voiceRate, stop, languageCode, true);
            emit(result.audio_base64);
          }, packet);
        },
      });
    },
  };
}
