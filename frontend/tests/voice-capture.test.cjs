const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTS } = require('./helpers/load-ts.cjs');
const { captureHarness, joinPCM, tone, pcm16 } = require('./helpers/voice-capture.cjs');
const { VoiceActivity, wavAudio } = loadTS('src/lib/voice-activity.ts');
const { audioUpload } = loadTS('src/lib/voice-audio.ts', { 'react-native': { Platform: { OS: 'web' } }, 'expo-file-system': {} });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function assertWave(bytes, seconds) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(Buffer.from(bytes.subarray(0, 4)).toString(), 'RIFF');
  assert.equal(Buffer.from(bytes.subarray(8, 16)).toString(), 'WAVEfmt ');
  assert.equal(view.getUint32(4, true), bytes.length - 8);
  assert.equal(view.getUint16(20, true), 1, 'PCM');
  assert.equal(view.getUint16(22, true), 1, 'mono');
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint32(28, true), 32000);
  assert.equal(view.getUint16(32, true), 2);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), bytes.length - 44);
  if (seconds !== undefined) assert.equal((bytes.length - 44) / 32000, seconds);
}

test('the same ten-second audio uploads valid 16 kHz PCM from 44.1, 48 and 16 kHz engines', async t => {
  for (const rate of [44100, 48000, 16000]) {
    const f = captureHarness({ engineRate: rate, ignoreRequestedRate: true });
    try {
      await f.capture.start(new AbortController().signal);
      const source = tone(rate, 10);
      f.feed(source);
      assert.equal(f.frames.length, 200);
      assert.ok(f.frames.every(frame => frame.sampleRate === 16000 && frame.channels === 1 && frame.data.byteLength === 1600));
      const bytes = wavAudio({ pcm: joinPCM(f.frames), sampleRate: 16000 });
      const upload = audioUpload(bytes);
      const file = upload.form.get('audio');
      assert.equal(file.type, 'audio/wav');
      const uploaded = new Uint8Array(await file.arrayBuffer());
      assertWave(uploaded, 10);
      assert.equal(file.size, 320044);
      const baseline = wavAudio({ pcm: pcm16(source), sampleRate: rate });
      assert.equal(baseline.length, 44 + rate * 20);
      if (rate === 16000) assert.deepEqual(uploaded, baseline, 'native 16 kHz samples stay unchanged');
      t.diagnostic(`${rate} Hz: ${baseline.length} -> ${file.size} upload bytes (${(100 * (1 - file.size / baseline.length)).toFixed(2)}% reduction)`);
      upload.dispose();
    } finally { await f.close(); }
  }
});

test('resampling preserves speech-band energy and suppresses high-frequency aliasing', async () => {
  const rms = pcm => {
    const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    let energy = 0;
    // Exclude the short causal filter startup from the steady-state measurement.
    for (let index = 320; index < pcm.length / 2; index++) energy += (view.getInt16(index * 2, true) / 32768) ** 2;
    return Math.sqrt(energy / (pcm.length / 2 - 320));
  };
  for (const rate of [44100, 48000]) {
    const levels = [];
    for (const frequency of [1000, 4000, 10000]) {
      const f = captureHarness({ engineRate: rate, ignoreRequestedRate: true });
      try {
        await f.capture.start(new AbortController().signal);
        f.feed(tone(rate, 1, frequency));
        levels.push(rms(joinPCM(f.frames)));
      } finally { await f.close(); }
    }
    assert.ok(Math.abs(levels[0] - 0.05 / Math.sqrt(2)) < 0.0001);
    assert.ok(Math.abs(levels[1] / levels[0] - 1) < 0.01);
    assert.ok(levels[2] < levels[0] * 0.005, '10 kHz must not alias into the 16 kHz speech signal');
  }
});

test('fractional-rate resampling remains identical across different render block boundaries', async () => {
  const results = [];
  for (const blockSize of [128, 257]) {
    const f = captureHarness({ engineRate: 44100, ignoreRequestedRate: true });
    try {
      await f.capture.start(new AbortController().signal);
      f.feed(tone(44100, 2, 1307), blockSize);
      results.push(joinPCM(f.frames));
    } finally { await f.close(); }
  }
  assert.deepEqual(results[0], results[1]);
  assert.equal(results[0].length, 64000);
});

test('capture uses the device clock and keeps mono, echo cancellation, noise suppression and gain control', async () => {
  const f = captureHarness();
  try {
    await f.capture.start(new AbortController().signal);
    assert.deepEqual(f.requested, [{ latencyHint:'interactive' }]);
    assert.deepEqual(f.constraints.audio, { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true });
    assert.equal(f.nodes[0].options.channelCount, 1);
    assert.equal(f.nodes[0].options.channelCountMode, 'explicit');
  } finally { await f.close(); }
});

test('capture timestamps include the worklet engine offset when frames are delivered',async()=>{
  const deliveryAges=[];
  const f=captureHarness({engineRate:48000,startFrame:48000,onFrame:frame=>deliveryAges.push(performance.now()/1000-frame.capturedAt)});
  try {
    await f.capture.start(new AbortController().signal);
    f.feed(tone(48000,.1));
    assert.equal(f.frames.length,2);
    assert.ok(f.frames.every(frame=>Number.isFinite(frame.capturedAt)));
    assert.equal(deliveryAges.length,2);
    assert.ok(deliveryAges.every(age=>age>=0&&age<.1),'A worklet created after one second must timestamp frames near their delivery time');
  }finally{await f.close();}
});

test('a device that rejects forced rates still captures native-rate audio and uploads 16 kHz WAV', async () => {
  const f = captureHarness({ engineRate: 48000, rejectRequestedRate: true });
  try {
    await f.capture.start(new AbortController().signal);
    assert.deepEqual(f.requested, [{ latencyHint:'interactive' }]);
    f.feed(tone(48000, 0.1));
    assertWave(wavAudio({ pcm: joinPCM(f.frames), sampleRate: f.frames[0].sampleRate }), 0.1);
  } finally { await f.close(); }
});

test('a microphone that cannot attach at 16 kHz uses its native engine without reconnecting', async () => {
  const f = captureHarness({ engineRate: 44100, rejectSourceAt16k: true });
  try {
    await f.capture.start(new AbortController().signal);
    assert.deepEqual(f.requested, [{ latencyHint:'interactive' }]);
    assert.equal(f.contexts[0].closed, 0);
    assert.equal(f.track.stopped, 0, 'fallback retains the acquired microphone');
    f.feed(tone(44100, 0.1));
    assertWave(wavAudio({ pcm: joinPCM(f.frames), sampleRate: f.frames[0].sampleRate }), 0.1);
  } finally { await f.close(); }
  assert.equal(f.track.stopped, 1);
  assert.ok(f.contexts.every(context => context.closed === 1));
});

test('the existing detector still requires 180 ms of speech and 750 ms of silence', async () => {
  let starts = 0, ended;
  const activity = new VoiceActivity(() => { starts++; }, utterance => { ended = utterance; });
  const f = captureHarness({ engineRate:16000,onFrame: frame => activity.feed(frame) });
  try {
    await f.capture.start(new AbortController().signal);
    f.feed(new Float32Array(16000));
    f.feed(tone(16000, 0.15));
    assert.equal(starts, 0);
    f.feed(tone(16000, 0.05));
    assert.equal(starts, 1);
    f.feed(new Float32Array(16000 * 0.7));
    assert.equal(ended, undefined);
    f.feed(new Float32Array(16000 * 0.05));
    assert.ok(ended);
    // The 500 ms pre-roll includes the onset; the 750 ms quiet tail follows it.
    assertWave(wavAudio(ended), 1.25);
  } finally { await f.close(); }
});

test('permission denial creates no worklet and closes the requested audio context', async () => {
  const f = captureHarness({ permissionDenied: true });
  try {
    await assert.rejects(f.capture.start(new AbortController().signal), /microphone/i);
    assert.equal(f.nodes.length, 0);
    assert.equal(f.contexts[0].closed, 1);
    assert.equal(f.frames.length, 0);
  } finally { await f.close(); }
});

test('cancellation while permission is pending stops the late microphone and never creates a worklet', async () => {
  const permission = deferred();
  const f = captureHarness({ permission: permission.promise });
  try {
    const controller = new AbortController();
    const starting = f.capture.start(controller.signal);
    controller.abort();
    permission.resolve();
    await starting;
    assert.equal(f.nodes.length, 0);
    assert.equal(f.track.stopped, 1);
    assert.equal(f.contexts[0].closed, 1);
  } finally { permission.resolve(); await f.close(); }
});

test('cancellation during module loading releases the microphone and fences late setup', async () => {
  const moduleReady = deferred();
  const f = captureHarness({ moduleReady: moduleReady.promise });
  try {
    const controller = new AbortController();
    const starting = f.capture.start(controller.signal);
    await new Promise(setImmediate);
    controller.abort();
    moduleReady.resolve();
    await starting;
    assert.equal(f.nodes.length, 0);
    assert.equal(f.track.stopped, 1);
    assert.equal(f.contexts[0].closed, 1);
  } finally { moduleReady.resolve(); await f.close(); }
});

test('microphone interruption cancels capture and late PCM cannot reach the session', async () => {
  const controller = new AbortController();
  const f = captureHarness({ onInterrupted: () => controller.abort() });
  try {
    await f.capture.start(controller.signal);
    f.feed(tone(48000, 0.05));
    const late = f.nodes[0].port.onmessage;
    f.track.onended();
    late({ data: { data: new ArrayBuffer(1600), sampleRate: 16000, channels: 1 } });
    assert.equal(f.interruptions, 1);
    assert.equal(f.frames.length, 1);
    assert.equal(f.track.stopped, 1);
    assert.equal(f.nodes[0].disconnected, true);
    assert.equal(f.contexts[0].closed, 1);
  } finally { await f.close(); }
});
