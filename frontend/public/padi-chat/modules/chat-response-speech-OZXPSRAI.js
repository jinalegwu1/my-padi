import { a as createSpeechStream } from './chunk-AJUFN7HS.js';
import { d as pause, e as resume } from './chunk-4DYWZHQL.js';
import { b as splitDeltas } from './chunk-DOJQV6DN.js';

export function createChatResponseSpeech({text, voiceId, voiceRate, languageCode, signal, streaming, owner, onStart}) {
  let playing;
  return {
    pause, resume,
    play() {
      if (!playing) {
        const audio = createSpeechStream(voiceId, voiceRate, languageCode, signal, onStart, () => {}, streaming, owner);
        splitDeltas(words => audio.enqueue(words)).finish(text);
        playing = audio.finish().finally(() => { playing = undefined; });
      }
      return playing;
    },
  };
}
