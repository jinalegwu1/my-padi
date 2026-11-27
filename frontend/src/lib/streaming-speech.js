const { synthesiseSpeech, streamSpeechAudio } = require('@/lib/api');
const { readSession } = require('@/lib/session');
const { spokenText } = require('@/lib/spoken-text');
const { createVoiceQueue } = require('@/lib/voice-playback');
/** Remove only outer near-silence from normalized PCM. Keep a margin
 * around speech so quiet consonants and the provider's internal pauses survive. */
function trimSpeechPadding(encoded) {
  if (!encoded.startsWith('UklG') || encoded.length < 64) return encoded;
  const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  if (bytes.length < 44 || view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1 || view.getUint32(24, true) !== 24000 || view.getUint16(34, true) !== 16 || String.fromCharCode(...bytes.subarray(36, 40)) !== 'data' || view.getUint32(40, true) !== bytes.length - 44) return encoded;
  const count = (bytes.length - 44) / 2,
    window = 240;
  let first = -1,
    last = -1;
  for (let offset = 0; offset < count; offset += window) {
    const end = Math.min(count, offset + window);
    let energy = 0;
    for (let index = offset; index < end; index++) {
      const sample = view.getInt16(44 + index * 2, true) / 32768;
      energy += sample * sample;
    }
    if (Math.sqrt(energy / (end - offset)) > .001) {
      if (first < 0) first = offset;
      last = end;
    }
  }
  if (first < 0) return encoded;
  const start = Math.max(0, first - 1440),
    end = Math.min(count, last + 2400);
  if (start === 0 && end === count) return encoded;
  const trimmed = new Uint8Array(44 + (end - start) * 2);
  trimmed.set(bytes.subarray(0, 44));
  trimmed.set(bytes.subarray(44 + start * 2, 44 + end * 2), 44);
  const header = new DataView(trimmed.buffer);
  header.setUint32(4, trimmed.length - 8, true);
  header.setUint32(40, trimmed.length - 44, true);
  let text = '';
  for (let i = 0; i < trimmed.length; i += 32768) text += String.fromCharCode(...trimmed.subarray(i, i + 32768));
  return btoa(text);
}

/** Prepare ahead of playback, with at most two synthesis requests in flight.
 * Audio submission follows text order even when requests finish out of order. */
function createSpeechStream(style, rate, language, signal, onStart, completed, incrementalAudio = false) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, {
    once: true
  });
  if (signal.aborted) abort();
  const player = createVoiceQueue(controller.signal, style);
  const account = readSession();
  let running = 0;
  let sealed = false;
  let failure;
  let submission = Promise.resolve();
  const waiting = [];
  const fail = error => {
    if (!signal.aborted && !failure) failure = error ?? new Error('Speech preparation failed.');
    controller.abort();
  };
  void account.catch(fail);
  const pump = () => {
    if (controller.signal.aborted) {
      waiting.splice(0).forEach(job => job.skip());
      return;
    }
    while (running < 2 && waiting.length) {
      running++;
      waiting.shift().run();
    }
  };
  controller.signal.addEventListener('abort', pump, {
    once: true
  });
  return {
    enqueue(text) {
      if (sealed || controller.signal.aborted) return;
      const words = spokenText(text);
      if (!words) return;
      if (incrementalAudio) {
        // Measure the actual delivery rate, including synthesis and transport.
        // A slow producer needs a buffer to avoid gaps in the middle of words.
        submission = submission.then(async () => {
          const session = await account;
          if (controller.signal.aborted) return;
          if (!session) throw new Error('Sign in to hear PADI’s reply.');
          const started = performance.now();
          let suppliedMs = 0;
          let playing = false;
          let played = Promise.resolve();
          const held = [];
          const play = wave => {
            played = player.enqueue(wave, onStart, () => {});
            void played.catch(fail);
          };
          const release = () => {
            if (controller.signal.aborted) return;
            playing = true;
            held.splice(0).forEach(play);
          };
          await streamSpeechAudio(session.token, words, style, rate, language, controller.signal, wave => {
            if (controller.signal.aborted) return;
            if (playing) {
              play(wave);
              return;
            }
            held.push(wave);
            // Each validated packet is canonical 24 kHz, 16-bit mono PCM WAV.
            const padding = wave.endsWith('==') ? 2 : wave.endsWith('=') ? 1 : 0;
            suppliedMs += (wave.length / 4 * 3 - padding - 44) / 48;
            const elapsed = performance.now() - started;
            if (suppliedMs >= 250 && suppliedMs >= 2 * elapsed || suppliedMs >= 1000 && suppliedMs >= 1.25 * elapsed) release();
          });
          // A slow renderer can safely release this complete phrase while the
          // next one is still generating. Never wait for the entire reply.
          release();
          void played.then(() => {
            if (!controller.signal.aborted) completed(words);
          }).catch(fail);
        }).catch(fail);
        return;
      }
      // Keep the first requests immediate. Combine only text still waiting for
      // a synthesis slot, reducing tiny clips and repeated provider round trips.
      const tail = waiting.at(-1);
      if (tail && tail.words.length + words.length + 1 <= 650) {
        tail.words += ' ' + words;
        return;
      }
      let job;
      const ready = new Promise((resolve, reject) => {
        job = {
          words,
          skip: () => resolve(undefined),
          run: () => {
            void (async () => {
              try {
                const session = await account;
                if (controller.signal.aborted) {
                  resolve(undefined);
                  return;
                }
                if (!session) throw new Error('Sign in to hear PADI’s reply.');
                // The configured Python speech engine supplies audio; text comes from the chat model.
                const audio = await synthesiseSpeech(session.token, job.words, style, rate, controller.signal, language, true, false);
                resolve(trimSpeechPadding(audio.audio_base64));
              } catch (error) {
                reject(error);
                fail(error);
              } finally {
                running--;
                pump();
              }
            })();
          }
        };
        waiting.push(job);
        pump();
      });
      void ready.catch(() => undefined);
      submission = submission.then(async () => {
        const audio = await ready;
        if (!audio || controller.signal.aborted) return;
        // Enqueue without awaiting the clip's playback completion. The player
        // decodes and schedules later audio while the current clip is playing.
        void player.enqueue(audio, onStart, () => completed(job.words)).catch(fail);
      });
      void submission.catch(fail);
    },
    async finish() {
      sealed = true;
      try {
        await submission.catch(fail);
        await player.finish().catch(fail);
        if (failure) throw failure;
      } finally {
        signal.removeEventListener('abort', abort);
        controller.signal.removeEventListener('abort', pump);
      }
    }
  };
}

module.exports = { trimSpeechPadding, createSpeechStream };
