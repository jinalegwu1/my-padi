import { c as createPcmBuffer } from './modules/chunk-DOJQV6DN.js';

// Go sends complete 24 kHz mono WAV packets. A fast renderer can play packets
// as they arrive. A slow renderer needs a whole phrase to avoid gaps inside words.
export function createPhrasePlayback({ signal, makePlayer, prepare, clean, onStart, delivered }) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  signal.addEventListener('abort', stop, { once: true });
  if (signal.aborted) stop();
  const player = makePlayer(controller.signal);
  let preparing = Promise.resolve();
  let finishing;
  let failure;

  function fail(error) {
    if (!controller.signal.aborted) failure = error;
    stop();
  }

  async function preparePhrase(words) {
    if (controller.signal.aborted) return;
    const buffer = createPcmBuffer();
    let lastPlayed;
    let audioMs = 0;
    let streaming = false;
    const started = performance.now();

    function release() {
      if (!controller.signal.aborted) {
        for (const clip of buffer.clips(8 * 1024 * 1024 - 44)) {
          lastPlayed = player.enqueue(clip.audio, onStart, () => {});
          lastPlayed.catch(fail);
        }
      }
      buffer.clear();
    }

    try {
      await prepare(words, controller.signal, packet => {
        if (controller.signal.aborted) return;
        buffer.append(packet);
        const padding = packet.endsWith('==') ? 2 : packet.endsWith('=') ? 1 : 0;
        audioMs += (packet.length / 4 * 3 - padding - 44) / 48;
        const elapsed = performance.now() - started;
        streaming ||= (audioMs >= 250 && audioMs >= 2 * elapsed) ||
          (audioMs >= 1000 && audioMs >= 1.25 * elapsed);
        if (streaming) release();
      });
      release();
      if (lastPlayed) {
        lastPlayed.then(() => {
          if (!controller.signal.aborted) delivered(words);
        }).catch(fail);
      }
    } finally {
      buffer.clear();
    }
  }

  return {
    enqueue(text) {
      if (finishing || controller.signal.aborted) return;
      const words = clean(text);
      if (words) preparing = preparing.then(() => preparePhrase(words)).catch(fail);
    },
    finish() {
      finishing ??= (async () => {
        try {
          await preparing;
          await player.finish().catch(fail);
          if (failure) throw failure;
        } finally {
          signal.removeEventListener('abort', stop);
        }
      })();
      return finishing;
    },
  };
}
