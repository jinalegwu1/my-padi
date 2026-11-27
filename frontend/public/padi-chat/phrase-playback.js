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
  let first = true;

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
        lastPlayed.then(heard => {
          if (heard !== false && !controller.signal.aborted) delivered(words);
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
      for (const phrase of playbackPhrases(words, first)) {
        first = false;
        preparing = preparing.then(() => preparePhrase(phrase)).catch(fail);
      }
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

// A slow synthesizer can finish a short opening thought quickly. Subsequent
// requests can prepare during playback, with breaths at punctuation when possible.
export function playbackPhrases(text, first = true) {
  if (!text) return [];
  const parts = [];
  let rest = text.trim();
  while (rest) {
    const limit = first ? 38 : 110;
    const head = rest.slice(0, limit + 1);
    const boundary = /[.!?](?:["”’)]*)(?=\s|$)|(?<=.{12})[,;:—](?=\s)/u.exec(head);
    let cut = rest.length;
    if (boundary && !/\b(?:mr|mrs|ms|dr|prof|st|e\.g|i\.e)\.$/i.test(head.slice(0, boundary.index + 1))) {
      cut = boundary.index + boundary[0].length;
    } else if (rest.length > limit) {
      const space = head.lastIndexOf(' ');
      cut = space > 0 ? space : Math.min(rest.indexOf(' ') < 0 ? rest.length : rest.indexOf(' '), 650);
    }
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trimStart();
    first = false;
  }
  return parts;
}

const maxCacheChars = 16 * 1024 * 1024;
let owner;
let cache = new Map();
let cacheChars = 0;

// Only completed phrases enter this account-scoped, in-memory replay cache.
export async function prepareVoicePackets(account, key, signal, produce, packet) {
  if (signal.aborted) return;
  if (owner !== account) { owner = account; cache = new Map(); cacheChars = 0; }
  const entries = cache;
  const known = entries.get(key);
  if (known) {
    entries.delete(key);
    entries.set(key, known);
    for (const wave of known.waves) { if (signal.aborted) return; packet(wave); }
    return;
  }
  const waves = [];
  let size = 0;
  await produce(wave => {
    if (signal.aborted) return;
    packet(wave);
    size += wave.length;
    if (size <= maxCacheChars) waves.push(wave);
  });
  if (!size || signal.aborted || cache !== entries || entries.has(key) || size > maxCacheChars) return;
  while (cacheChars + size > maxCacheChars) {
    const oldest = entries.keys().next().value;
    cacheChars -= entries.get(oldest).size;
    entries.delete(oldest);
  }
  entries.set(key, {waves, size});
  cacheChars += size;
}
