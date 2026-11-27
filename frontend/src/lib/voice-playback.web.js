const { portraitSpeech, speechEnvelope } = require('@/lib/portrait-speech');
const { preparePlaybackReference } = require('@/lib/voice-echo');
let output = null;
const MAX_DECODED_AUDIO_BYTES = 32 * 1024 * 1024;
const decodedAudio = new WeakMap();
function decodeAudio(context, encoded) {
  let cache = decodedAudio.get(context);
  if (!cache) {
    const created = {
      buffers: new Map(),
      pending: new Map(),
      bytes: 0
    };
    decodedAudio.set(context, created);
    cache = created;
  }
  const current = cache;
  const cached = current.buffers.get(encoded);
  if (cached) {
    current.buffers.delete(encoded);
    current.buffers.set(encoded, cached);
    return Promise.resolve(cached.buffer);
  }
  const pending = current.pending.get(encoded);
  if (pending) return pending;
  const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
  const decoding = context.decodeAudioData(bytes.buffer).then(buffer => {
    current.pending.delete(encoded);
    const size = buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
    if (size <= MAX_DECODED_AUDIO_BYTES) {
      while (current.bytes + size > MAX_DECODED_AUDIO_BYTES) {
        const oldest = current.buffers.keys().next().value;
        if (oldest === undefined) break;
        const evicted = current.buffers.get(oldest);
        if (evicted) current.bytes -= evicted.bytes;
        current.buffers.delete(oldest);
      }
      current.buffers.set(encoded, {
        buffer,
        bytes: size
      });
      current.bytes += size;
    }
    return buffer;
  }).catch(error => {
    current.pending.delete(encoded);
    throw error;
  });
  current.pending.set(encoded, decoding);
  return decoding;
}

/** Unlock sound from the actual tap, before navigation or network requests. */
async function unlockVoicePlayback() {
  output ??= new AudioContext();
  if (output.state === 'closed') output = new AudioContext();
  if (output.state === 'running') return;
  let timer;
  try {
    await Promise.race([output.resume(), new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Tap to chat again to enable sound in your browser.')), 1500);
    })]);
    if (output.state !== 'running') throw new Error('Tap to chat again to enable sound in your browser.');
  } finally {
    if (timer) clearTimeout(timer);
  }
}
async function pauseVoicePlayback() {
  if (output?.state === 'running') await output.suspend();
}
async function resumeVoicePlayback() {
  if (output?.state === 'suspended') await output.resume();
}

/** One unlocked output context keeps replies audible after async requests. */
async function playVoice(encoded, signal, onStart, voiceId) {
  if (signal.aborted) return;
  await unlockVoicePlayback();
  const context = output;
  let buffer;
  try {
    buffer = await decodeAudio(context, encoded);
  } catch {
    throw new Error('Voice playback failed. Your reply is available in the transcript.');
  }
  if (signal.aborted) return;
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  const envelope = voiceId ? speechEnvelope(encoded) : null;
  let face;
  let progress;
  try {
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', stop);
        resolve();
      };
      const stop = () => {
        try {
          source.stop();
        } finally {
          finish();
        }
      };
      source.onended = finish;
      signal.addEventListener('abort', stop, {
        once: true
      });
      if (signal.aborted) {
        finish();
        return;
      }
      try {
        source.start();
        if (voiceId && envelope) {
          face = portraitSpeech(voiceId);
          const began = context.currentTime;
          progress = setInterval(() => face?.report(envelope.levelAt(context.currentTime - began)), 40);
        }
        onStart();
      } catch {
        signal.removeEventListener('abort', stop);
        reject(new Error('PADI’s audio could not start. Tap to chat again to enable sound.'));
      }
    });
  } finally {
    if (progress) clearInterval(progress);
    face?.stop();
    source.onended = null;
    source.disconnect();
  }
}

/** One output context and one audio-clock timeline for the whole response.
 * Buffer sources are single-use Web Audio nodes, not separate audio players. */
function createVoiceQueue(signal, voiceId) {
  let scheduling = Promise.resolve();
  const played = [];
  const clips = new Set();
  let end = 0;
  let face;
  let progress;
  let sealed = false;
  const stop = () => {
    for (const clip of [...clips]) {
      try {
        clip.source.stop();
      } finally {
        clip.finish();
      }
    }
    if (progress) clearInterval(progress);
    face?.stop();
  };
  signal.addEventListener('abort', stop, {
    once: true
  });
  const report = () => {
    const now = output?.currentTime ?? 0;
    for (const clip of clips) {
      if (now < clip.start || now >= clip.end) continue;
      if (!clip.began) {
        clip.began = true;
        clip.onStart();
      }
      face?.report(clip.envelope?.levelAt(now - clip.start) ?? 0);
      return;
    }
    face?.report(0);
  };
  return {
    enqueue(encoded, onStart, completed) {
      if (sealed || signal.aborted) return Promise.resolve();
      let resolve;
      let reject;
      const done = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
      });
      played.push(done);
      scheduling = scheduling.then(async () => {
        if (signal.aborted) {
          resolve();
          return;
        }
        await unlockVoicePlayback();
        const context = output;
        const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
        let buffer;
        try {
          buffer = await context.decodeAudioData(bytes.buffer);
        } catch {
          throw new Error('Voice audio could not be decoded. The reply is available in text chat.');
        }
        if (signal.aborted) {
          resolve();
          return;
        }
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        // Do CPU work before reserving an audio-clock slot. Otherwise decoding
        // the envelope can make the first slot stale and overlap the next clip.
        const envelope = voiceId ? speechEnvelope(encoded) : null;
        const reference = preparePlaybackReference(buffer.getChannelData(0), buffer.sampleRate);
        const start = Math.max(context.currentTime + 256 / context.sampleRate, end);
        end = start + buffer.duration;
        const clip = {
          source,
          start,
          end,
          began: false,
          onStart,
          envelope,
          stopReference: reference(() => context.currentTime - start),
          finish() {
            if (!clips.delete(clip)) return;
            clip.stopReference();
            source.onended = null;
            source.disconnect();
            if (!signal.aborted) {
              if (!clip.began) onStart();
              completed();
            }
            resolve();
          }
        };
        clips.add(clip);
        source.onended = clip.finish;
        try {
          source.start(start);
        } catch (error) {
          clips.delete(clip);
          clip.stopReference();
          source.onended = null;
          source.disconnect();
          throw error;
        }
        if (!face && voiceId) face = portraitSpeech(voiceId);
        progress ??= setInterval(report, 20);
        report();
      }).catch(error => {
        reject(error);
        throw error;
      });
      void scheduling.catch(() => undefined);
      return done;
    },
    async finish() {
      sealed = true;
      try {
        await scheduling;
        await Promise.all(played);
      } finally {
        if (progress) clearInterval(progress);
        face?.stop();
        signal.removeEventListener('abort', stop);
        stop();
      }
    }
  };
}

module.exports = { unlockVoicePlayback, pauseVoicePlayback, resumeVoicePlayback, playVoice, createVoiceQueue };
