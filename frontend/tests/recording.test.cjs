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

test('browser permission granted after cancellation releases the stream without recording', async () => {
  const pending = deferred();
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalRecorder = global.MediaRecorder;
  let stopped = 0;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: () => pending.promise } } });
  global.MediaRecorder = class { constructor() { assert.fail('cancelled session started recording'); } };
  try {
    const { VoiceRecording } = loadTS('src/lib/recording.web.ts');
    const recording = new VoiceRecording(() => {});
    const controller = new AbortController();
    const start = recording.start(controller.signal);
    controller.abort();
    const cleanup = recording.cancel();
    pending.resolve({ getTracks: () => [{ stop: () => { stopped++; } }] });
    await assert.rejects(start, { name: 'AbortError' });
    await cleanup;
    assert.equal(stopped, 1);
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator); else delete globalThis.navigator;
    global.MediaRecorder = originalRecorder;
  }
});

test('browser recording chooses supported format, sends an audio blob and stops all tracks', async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalRecorder = global.MediaRecorder;
  const originalContext = global.AudioContext;
  let amplitude = 0.01;
  let stopped = 0;
  const track = { stop: () => { stopped++; }, onended: null };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track] }) } } });
  global.MediaRecorder = class extends EventTarget {
    static isTypeSupported(type) { return type === 'audio/mp4'; }
    constructor(_stream, options) { super(); this.mimeType = options.mimeType; this.state = 'inactive'; }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      const event = new Event('dataavailable'); event.data = new Blob(['0000ftypM4A audio'], { type: this.mimeType }); this.dispatchEvent(event);
      this.dispatchEvent(new Event('stop'));
    }
  };
  global.AudioContext = class {
    async resume() {} async close() {}
    createMediaStreamSource() { return { connect() {} }; }
    createAnalyser() { return { fftSize: 2048, getFloatTimeDomainData(samples) { samples.fill(amplitude); } }; }
  };
  try {
    const { VoiceRecording } = loadTS('src/lib/recording.web.ts');
    const recording = new VoiceRecording(() => {});
    await recording.start(new AbortController().signal);
    await new Promise(resolve => setTimeout(resolve, 120));
    const form = await recording.finish();
    assert.equal(form.get('audio').name, 'recording.m4a');
    assert.equal(form.get('audio').type, 'audio/mp4');
    await recording.cancel(); await recording.cancel();
    assert.equal(stopped, 1);
    assert.equal(track.onended, null);
    amplitude = 0;
    const silent = new VoiceRecording(() => {});
    await silent.start(new AbortController().signal);
    await new Promise(resolve => setTimeout(resolve, 120));
    await assert.rejects(silent.finish(), /could not hear speech/);
    await silent.cancel();
    assert.equal(stopped, 2);
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator); else delete globalThis.navigator;
    global.MediaRecorder = originalRecorder;
    global.AudioContext = originalContext;
  }
});
