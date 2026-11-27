const { requireOptionalNativeModule } = require('expo');
const { portraitSpeech, speechEnvelope } = require('@/lib/portrait-speech');
const { prepareWaveReference } = require('@/lib/voice-echo');
async function unlockVoicePlayback() {}
async function pauseVoicePlayback() {}
async function resumeVoicePlayback() {}
async function playVoice(encoded, signal, onStart, voiceId) {
  const voice = requireOptionalNativeModule('PadiVoice');
  if (!voice) throw new Error('Natural hands-free voice requires the PADI development build.');
  let stopReference;
  const stop = () => {
    voice.stopPlayback();
    stopReference?.();
  };
  signal.addEventListener('abort', stop, {
    once: true
  });
  let face;
  let progress;
  try {
    if (signal.aborted) return;
    const reference = prepareWaveReference(encoded),
      start = Date.now() / 1000;
    stopReference = reference(() => Date.now() / 1000 - start);
    const playing = voice.play(encoded);
    if (voiceId) {
      face = portraitSpeech(voiceId);
      const envelope = speechEnvelope(encoded),
        began = Date.now();
      progress = setInterval(() => face?.report(envelope.levelAt((Date.now() - began) / 1000)), 40);
    }
    onStart();
    await playing;
  } finally {
    stopReference?.();
    if (progress) clearInterval(progress);
    face?.stop();
    signal.removeEventListener('abort', stop);
  }
}

/** Updated native builds keep their player/AudioTrack for the entire response. */
function createVoiceQueue(signal, voiceId) {
  const voice = requireOptionalNativeModule('PadiVoice');
  const queued = !!voice?.beginQueuedPlayback && !!voice.enqueueAudio && !!voice.finishQueuedPlayback;
  let begun = false;
  let serial = Promise.resolve();
  const pending = [];
  const clips = [];
  let end = 0;
  let face;
  let progress;
  const stopReferences = [];
  const stop = () => {
    voice?.stopPlayback();
    stopReferences.forEach(stop => stop());
    if (progress) clearInterval(progress);
    face?.stop();
  };
  signal.addEventListener('abort', stop, {
    once: true
  });
  return {
    enqueue(encoded, onStart, completed) {
      if (signal.aborted) return Promise.resolve();
      if (!voice) return Promise.reject(new Error('Voice playback requires the PADI development build.'));
      if (!queued) {
        serial = serial.then(() => playVoice(encoded, signal, onStart, voiceId)).then(() => {
          if (!signal.aborted) completed();
        });
        return serial;
      }
      if (!begun) {
        voice.beginQueuedPlayback();
        begun = true;
        onStart();
      }
      const reference = prepareWaveReference(encoded);
      const referenceStart = Math.max(Date.now() / 1000, end);
      const stopReference = reference(() => Date.now() / 1000 - referenceStart);
      stopReferences.push(stopReference);
      if (voiceId) {
        face ??= portraitSpeech(voiceId);
        const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
        const start = Math.max(Date.now() / 1000, end);
        end = start + (bytes.byteLength - 44) / 48000;
        clips.push({
          start,
          end,
          envelope: speechEnvelope(encoded)
        });
        progress ??= setInterval(() => {
          const now = Date.now() / 1000;
          const clip = clips.find(clip => now >= clip.start && now < clip.end);
          face?.report(clip?.envelope.levelAt(now - clip.start) ?? 0);
        }, 40);
      }
      const playing = voice.enqueueAudio(encoded).then(() => {
        stopReference();
        if (!signal.aborted) completed();
      });
      pending.push(playing);
      return playing;
    },
    async finish() {
      try {
        if (queued && begun && !signal.aborted) await voice.finishQueuedPlayback();
        await serial;
        await Promise.all(pending);
      } finally {
        if (progress) clearInterval(progress);
        face?.stop();
        signal.removeEventListener('abort', stop);
      }
    }
  };
}

module.exports = { unlockVoicePlayback, pauseVoicePlayback, resumeVoicePlayback, playVoice, createVoiceQueue };
