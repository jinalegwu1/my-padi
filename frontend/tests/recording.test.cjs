const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTS } = require('./helpers/load-ts.cjs');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('native recorder uses AAC, uploads its cached file and releases and deletes it exactly once', async () => {
  let options, released = 0, removed = 0, stops = 0;
  const { VoiceRecording } = loadTS('src/lib/recording.ts', {
    'expo-audio': {
      RecordingPresets: { HIGH_QUALITY: { extension: '.m4a', sampleRate: 44100, ios: { outputFormat: 'aac ' }, android: { outputFormat: 'mpeg4', audioEncoder: 'aac' } } },
      requestRecordingPermissionsAsync: async () => ({ granted: true }), setAudioModeAsync: async () => {},
      AudioModule: { AudioRecorder: class {
        constructor(input) { options = input; this.uri = 'file:///test-cache/recording.m4a'; }
        async prepareToRecordAsync() {} record() {} async stop() { stops++; }
        release() { released++; } getStatus() { return { isRecording: true, metering: -20 }; }
      } },
    },
    'react-native': { Platform: { OS: 'android' } },
    'expo-file-system': { File: class { exists = true; size = 1000; delete() { removed++; } } },
  });
  const oldForm = global.FormData;
  const fields = [];
  global.FormData = class { append(...args) { fields.push(args); } };
  try {
    const recording = new VoiceRecording(() => {});
    await recording.start(new AbortController().signal);
    await recording.finish();
    await recording.cancel();
    await recording.cancel();
    assert.equal(options.outputFormat, 'mpeg4');
    assert.equal(options.audioEncoder, 'aac');
    assert.equal(options.numberOfChannels, 1);
    assert.equal(fields[0][0], 'audio');
    assert.equal(fields[0][1].uri, 'file:///test-cache/recording.m4a');
    assert.equal(released, 1); assert.equal(removed, 1); assert.equal(stops, 1);
  } finally { global.FormData = oldForm; }
});

test('native permission denial never prepares or opens the microphone', async () => {
  const { VoiceRecording } = loadTS('src/lib/recording.ts', {
    'expo-audio': { requestRecordingPermissionsAsync: async () => ({ granted: false }), setAudioModeAsync: async () => {},
      RecordingPresets: {}, AudioModule: { AudioRecorder: class { constructor() { assert.fail('microphone opened'); } } } },
    'expo-file-system': {}, 'react-native': { Platform: { OS: 'ios' } },
  });
  const recording = new VoiceRecording(() => {});
  await assert.rejects(recording.start(new AbortController().signal), /Microphone permission is off/);
  await recording.cancel();
});

const { captureHarness, tone } = require('./helpers/voice-capture.cjs');

function browserRecording(options = {}) {
  const harness = captureHarness(options);
  const original = global.MediaRecorder;
  const recorders = [];
  let interrupts = 0;
  class Recorder extends EventTarget {
    static isTypeSupported(type) { return (options.formats ?? ['audio/webm;codecs=opus']).includes(type); }
    constructor(stream, settings) { super(); this.mimeType = options.returnedType ?? settings.mimeType; this.state = 'inactive'; this.settings = settings; recorders.push(this); }
    start(timeslice) { this.state = 'recording'; this.timeslice = timeslice; }
    data(blob) { const event = new Event('dataavailable'); event.data = blob; this.dispatchEvent(event); }
    stop() {
      this.state = 'inactive';
      queueMicrotask(() => {
        const header = this.mimeType.includes('mp4') ? '0000ftypM4A ' : new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]);
        this.data(new Blob([options.payload ?? header, new Uint8Array(1000)], { type: this.mimeType }));
        this.dispatchEvent(new Event('stop'));
      });
    }
  }
  global.MediaRecorder = Recorder;
  const { VoiceRecording } = loadTS('src/lib/recording.web.ts', { './voice-capture.web': { VoiceCapture: harness.VoiceCapture } });
  const controller = new AbortController();
  const recording = new VoiceRecording(() => { interrupts++; if (options.abortOnInterrupt) controller.abort(); });
  return { ...harness, recording, controller, recorders, get interruptions() { return interrupts; },
    async close() { try { await recording.cancel(); await harness.close(); } finally { global.MediaRecorder = original; } },
  };
}

test('browser compression chooses Opus at 32 kbps and measures the exact Blob and captured PCM bytes', async () => {
  const f = browserRecording();
  try {
    await f.recording.start(f.controller.signal);
    f.feed(tone(16000, 1));
    assert.equal(f.recorders[0].settings.mimeType, 'audio/webm;codecs=opus');
    assert.equal(f.recorders[0].settings.audioBitsPerSecond, 32000);
    assert.equal(f.recorders[0].timeslice, 250);
    const form = await f.recording.finish();
    const file = form.get('audio');
    assert.equal(file.name, 'recording.webm');
    assert.equal(file.type, 'audio/webm;codecs=opus');
    assert.equal(file.size, (await file.arrayBuffer()).byteLength);
    assert.equal(f.recording.metadata.audioBytes, file.size);
    assert.equal(f.recording.metadata.pcmBytes, 32000);
    assert.equal(f.track.stopped, 1);
  } finally { await f.close(); }
});

test('an AAC fallback is accurately labelled and is never reported as Opus or WAV', async () => {
  const f = browserRecording({ formats: ['audio/mp4'] });
  try {
    await f.recording.start(f.controller.signal); f.feed(tone(16000, .2));
    const form = await f.recording.finish();
    assert.equal(form.get('audio').type, 'audio/mp4');
    assert.equal(form.get('audio').name, 'recording.m4a');
    assert.equal(f.recording.metadata.audioBytes, form.get('audio').size);
  } finally { await f.close(); }
});

test('unsupported compression is detected before asking for a microphone', async () => {
  const f = browserRecording({ formats: [] });
  try {
    await assert.rejects(f.recording.start(f.controller.signal), /cannot record supported compressed audio/);
    assert.equal(f.contexts.length, 0); assert.equal(f.recorders.length, 0);
  } finally { await f.close(); }
});

test('a browser returning uncompressed WAV is rejected instead of silently claiming compression', async () => {
  const f = browserRecording({ returnedType: 'audio/wav' });
  try { await assert.rejects(f.recording.start(f.controller.signal), /unsupported recording format/); }
  finally { await f.close(); }
  assert.equal(f.track.stopped, 1);
});

test('microphone permission denial and unavailable devices produce useful errors and release the engine', async () => {
  for (const name of ['NotAllowedError', 'NotFoundError', 'NotReadableError']) {
    const f = browserRecording({ microphoneError: name });
    try {
      await assert.rejects(f.recording.start(f.controller.signal), /denied|No microphone|unavailable/);
      assert.equal(f.recorders.length, 0); assert.equal(f.contexts[0].closed, 1);
    } finally { await f.close(); }
  }
});

test('browser permission granted after cancellation releases the late stream without recording', async () => {
  const pending = deferred();
  const f = browserRecording({ permission: pending.promise });
  try {
    const starting = f.recording.start(f.controller.signal);
    f.controller.abort(); const cleanup = f.recording.cancel(); pending.resolve();
    await starting; await cleanup;
    assert.equal(f.recorders.length, 0); assert.equal(f.track.stopped, 1); assert.equal(f.contexts[0].closed, 1);
  } finally { pending.resolve(); await f.close(); }
});

test('microphone interruption cancels recording and discards late encoder chunks', async () => {
  const f = browserRecording({ abortOnInterrupt: true });
  try {
    await f.recording.start(f.controller.signal); f.feed(tone(16000, .1));
    const recorder = f.recorders[0]; f.track.onended(); await f.recording.cancel();
    recorder.data(new Blob([new Uint8Array(5000)]));
    assert.equal(f.interruptions, 1); assert.equal(f.recording.metadata.audioBytes, 0); assert.equal(f.track.stopped, 1);
  } finally { await f.close(); }
});

test('silent or malformed recordings are rejected before upload', async () => {
  const silent = browserRecording();
  try { await silent.recording.start(silent.controller.signal); silent.feed(new Float32Array(16000)); await assert.rejects(silent.recording.finish(), /No clear speech/); }
  finally { await silent.close(); }
  const bad = browserRecording({ payload: 'uncompressed or corrupted' });
  try { await bad.recording.start(bad.controller.signal); bad.feed(tone(16000, .2)); await assert.rejects(bad.recording.finish(), /malformed/); }
  finally { await bad.close(); }
});

test('encoder errors and oversized chunks remain bounded and trigger interruption', async () => {
  for (const mode of ['error', 'oversize']) {
    const f = browserRecording();
    try {
      await f.recording.start(f.controller.signal); f.feed(tone(16000, .1));
      if (mode === 'error') f.recorders[0].dispatchEvent(new Event('error'));
      else f.recorders[0].data(new Blob([new Uint8Array(8 * 1024 * 1024 + 1)]));
      assert.equal(f.interruptions, 1);
      await assert.rejects(f.recording.finish(), /failed|size limit|Cancelled/);
    } finally { await f.close(); }
  }
});

test('an unsolicited encoder stop cancels and releases the microphone', async () => {
  const f = browserRecording();
  try {
    await f.recording.start(f.controller.signal); f.feed(tone(16000, .1));
    f.recorders[0].state = 'inactive'; f.recorders[0].dispatchEvent(new Event('stop'));
    await f.recording.cancel(); assert.equal(f.interruptions, 1); assert.equal(f.track.stopped, 1);
    await assert.rejects(f.recording.finish(), { name: 'AbortError' });
  } finally { await f.close(); }
});

test('cancellation during encoder finalisation cannot resurrect a private upload Blob', async () => {
  const f = browserRecording();
  try {
    await f.recording.start(f.controller.signal); f.feed(tone(16000, .1));
    const finishing = f.recording.finish(); const cleanup = f.recording.cancel();
    await assert.rejects(finishing, { name: 'AbortError' }); await cleanup;
    assert.equal(f.recording.metadata.audioBytes, 0); assert.equal(f.track.stopped, 1);
  } finally { await f.close(); }
});
