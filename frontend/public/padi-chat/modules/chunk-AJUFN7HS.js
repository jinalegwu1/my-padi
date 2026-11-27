import { g as createVoiceQueue } from "./chunk-4DYWZHQL.js";
import { h as streamSpeechAudio, k as synthesiseSpeech, o as readSession } from "./chunk-PRFFR5IG.js";
import { createPhrasePlayback } from "../phrase-playback.js";
function spokenText(n){return n.replace(/```[^\n]*\n[\s\S]*?```/g,"Code is available in the chat transcript.").replace(/!\[([^\]]*)\]\([^)]*\)/g,"$1").replace(/\[([^\]]+)\]\([^)]*\)/g,"$1").replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+)/gm,"").replace(/(?:\*\*|__|~~|`)/g,"").replace(/\*([^*\n]+)\*/g,"$1").replace(/(?<!\w)_([^_\n]+)_(?!\w)/g,"$1").replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\uFE0F\u200D\u20E3]/gu,"").replace(/[ \t]+/g," ").replace(/\n{3,}/g,`

`).trim()}function trimSpeechPadding(n){if(!n.startsWith("UklG")||n.length<64)return n;let a=Uint8Array.from(atob(n),e=>e.charCodeAt(0)),o=new DataView(a.buffer);if(a.length<44||o.getUint16(20,!0)!==1||o.getUint16(22,!0)!==1||o.getUint32(24,!0)!==24e3||o.getUint16(34,!0)!==16||String.fromCharCode(...a.subarray(36,40))!=="data"||o.getUint32(40,!0)!==a.length-44)return n;let s=(a.length-44)/2,b=240,p=-1,w=-1;for(let e=0;e<s;e+=b){let c=Math.min(s,e+b),f=0;for(let h=e;h<c;h++){let i=o.getInt16(44+h*2,!0)/32768;f+=i*i}Math.sqrt(f/(c-e))>.001&&(p<0&&(p=e),w=c)}if(p<0)return n;let g=Math.max(0,p-1440),r=Math.min(s,w+2400);if(g===0&&r===s)return n;let t=new Uint8Array(44+(r-g)*2);t.set(a.subarray(0,44)),t.set(a.subarray(44+g*2,44+r*2),44);let l=new DataView(t.buffer);l.setUint32(4,t.length-8,!0),l.setUint32(40,t.length-44,!0);let d="";for(let e=0;e<t.length;e+=32768)d+=String.fromCharCode(...t.subarray(e,e+32768));return btoa(d)}

function createSpeechStream(style, rate, language, signal, onStart, delivered, streaming = false, playClip) {
  const voice = ['en-NG','pcm-NG'].includes(language) ? 'baby' : style;
  let session;
  // Automatic text playback uses its pause-aware player. Live calls use the
  // audio-clock queue, which also supplies the microphone's echo reference.
  const makePlayer = playbackSignal => {
    if (!playClip) return createVoiceQueue(playbackSignal, style);
    let playing = Promise.resolve();
    return {
      enqueue(wave) {
        playing = playing.then(() => {
          if (!playbackSignal.aborted) return playClip(wave, playbackSignal, onStart, style);
        });
        return playing;
      },
      finish() { return playing; },
    };
  };
  return createPhrasePlayback({
    signal, makePlayer, clean: spokenText, onStart, delivered,
    async prepare(words, playbackSignal, packet) {
      const account = await (session ??= readSession());
      if (playbackSignal.aborted) return;
      if (!account) throw new Error("Sign in to hear PADI’s reply.");
      if (streaming) {
        await streamSpeechAudio(account.token, words, voice, rate, language, playbackSignal, packet);
      } else {
        const audio = await synthesiseSpeech(account.token, words, voice, rate, playbackSignal, language, true, false);
        packet(trimSpeechPadding(audio.audio_base64));
      }
    },
  });
}
export { createSpeechStream as a };
