async function decodePacket(audio, encoded) {
  const bytes = Uint8Array.fromBase64 ? Uint8Array.fromBase64(encoded) : Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Streaming packets are complete 24 kHz, mono, little-endian PCM WAVs.
  // Keeping their native sample rate avoids a codec/resampler job per packet.
  if (bytes.length > 44 && !(bytes.length % 2) && header.getUint32(0) === 0x52494646 &&
      header.getUint32(8) === 0x57415645 && header.getUint32(12) === 0x666d7420 &&
      header.getUint32(16, true) === 16 && header.getUint16(20, true) === 1 &&
      header.getUint16(22, true) === 1 && header.getUint32(24, true) === 24000 &&
      header.getUint16(34, true) === 16 && header.getUint32(36) === 0x64617461 &&
      header.getUint32(40, true) === bytes.length - 44) {
    const buffer = audio.createBuffer(1, (bytes.length - 44) / 2, 24000);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = header.getInt16(44 + i * 2, true) / 32768;
    return buffer;
  }
  return audio.decodeAudioData(bytes.buffer);
}

// The portrait document owns one Web Audio clock on web, Android and iOS.
export function createVoiceOutput({prepareReference, portrait, document: page = globalThis.document} = {}) {
  let context;
  let paused = false;
  let active;
  const controls = () => page?.getElementById('enable-voice-audio');
  const setState = state => {
    if (page && page.documentElement.dataset.voiceOutput !== state) page.documentElement.dataset.voiceOutput = state;
  };
  function audioContext() {
    if (!context || context.state === 'closed') {
      const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Audio) throw new Error('This browser cannot play PADI’s audio.');
      context = new Audio({latencyHint: 'interactive'});
      context.onstatechange = () => {
        const button = controls();
        if (button) button.hidden = !active || paused || context.state === 'running';
      };
    }
    return context;
  }
  async function unlock() {
    const audio = audioContext();
    paused = false;
    if (audio.state === 'running') return Promise.resolve();
    const button = controls();
    if (button) button.hidden = false;
    return audio.resume().then(() => { if (button) button.hidden = audio.state === 'running'; });
  }
  const button = controls();
  if (button) button.onclick = () => { unlock().catch(() => { button.hidden = false; }); };

  function queue(signal, voiceId, echo = true) {
    const token = {stop};
    let stopped = false;
    const clips = new Set();
    let schedule = Promise.resolve();
    let end = 0;
    let sealed = false;
    let finished;
    let pose;
    let timer;
    let failure;
    let cancelled;
    const cancellation = new Promise(resolve => { cancelled = resolve; });
    if (!signal.aborted) {
      active?.stop();
      active = token;
      setState('buffering');
    }

    function stop() {
      if (stopped) return;
      stopped = true;
      cancelled();
      for (const clip of [...clips]) {
        try { clip.node.stop(); } catch { /* It may already have ended. */ }
        clip.endClip(false);
      }
      clearInterval(timer);
      pose?.stop();
      if (active === token) {
        active = null;
        paused = false;
        if (controls()) controls().hidden = true;
        setState('idle');
      }
      signal.removeEventListener('abort', stop);
    }
    function report() {
      if (!context || context.state !== 'running') return;
      const now = context.currentTime;
      for (const clip of clips) {
        if (now < clip.start || now >= clip.end) continue;
        clip.startClip();
        const samples = clip.node.buffer.getChannelData(0);
        const index = Math.floor((now - clip.start) * clip.node.buffer.sampleRate);
        let sum = 0;
        const count = Math.min(256, samples.length - index);
        for (let i = 0; i < count; i++) sum += samples[index + i] ** 2;
        pose?.report(count > 0 ? Math.min(1, Math.sqrt(sum / count) * 6) : 0);
        return;
      }
      pose?.report(0);
      if (!sealed && active === token) setState('buffering');
    }
    signal.addEventListener('abort', stop, {once:true});
    if (signal.aborted) stop();

    function enqueue(encoded, onStart = () => {}, completed = () => {}) {
      if (sealed || stopped || signal.aborted) return Promise.resolve(false);
      let heard;
      const played = new Promise(resolve => { heard = resolve; });
      const next = schedule.then(async () => {
        if (failure) throw failure;
        if (stopped || signal.aborted) return heard(false);
        const audio = audioContext();
        if (!paused && audio.state !== 'running') await Promise.race([unlock(), cancellation]);
        if (stopped || signal.aborted) return heard(false);
        const buffer = await decodePacket(audio, encoded);
        if (stopped || signal.aborted) return heard(false);
        const node = audio.createBufferSource();
        node.buffer = buffer;
        node.connect(audio.destination);
        const reference = echo && prepareReference ? prepareReference(buffer.getChannelData(0), buffer.sampleRate) : null;
        const start = Math.max(end, audio.currentTime + 256 / audio.sampleRate);
        end = start + buffer.duration;
        const stopReference = reference?.(() => audio.currentTime - start);
        let began = false;
        const clip = {node, start, end, played,
          startClip() {
            if (began) return;
            began = true;
            if (active === token) setState('playing');
            onStart();
          },
          endClip(normal) {
            if (!clips.delete(clip)) return;
            node.onended = null;
            node.disconnect();
            stopReference?.();
            if (normal && !signal.aborted) { clip.startClip(); completed(); }
            heard(normal && !signal.aborted);
          }
        };
        clips.add(clip);
        node.onended = () => clip.endClip(true);
        try { node.start(start); } catch (error) { clip.endClip(false); throw error; }
        if (!pose && voiceId) pose = portrait?.(voiceId);
        timer ??= setInterval(report, 20);
        report();
      });
      schedule = next.catch(error => { failure ??= error; stop(); });
      return next.then(() => played);
    }
    return {enqueue, finish() {
      sealed = true;
      return finished ??= (async () => {
        try {
          await schedule;
          if (failure) throw failure;
          await Promise.all([...clips].map(clip => clip.played));
        } finally { stop(); }
      })();
    }};
  }
  return {
    queue, unlock,
    async pause() { paused = true; if (context?.state === 'running') await context.suspend(); },
    resume: unlock,
    async play(encoded, signal, onStart, voiceId) {
      if (signal.aborted) return;
      const player = queue(signal, voiceId);
      const played = player.enqueue(encoded, onStart);
      await Promise.all([played, player.finish()]);
    }
  };
}
