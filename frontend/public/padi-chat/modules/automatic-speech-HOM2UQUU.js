import { a as createSpeechStream } from './chunk-AJUFN7HS.js';
import { b as splitDeltas } from './chunk-DOJQV6DN.js';
import { d as pause, e as resume } from './chunk-4DYWZHQL.js';

export function automaticSpeech({voiceId, voiceRate, languageCode, signal, config, owner, onStart}) {
  const streaming = config.streaming_speech_languages?.includes(languageCode) === true;
  const audio = createSpeechStream(voiceId, voiceRate, languageCode, signal, onStart, () => {}, streaming, owner);
  const text = splitDeltas(words => audio.enqueue(words));
  return {
    append: text.append, pause, resume,
    finish(reply) { text.finish(reply); return audio.finish(); },
  };
}
