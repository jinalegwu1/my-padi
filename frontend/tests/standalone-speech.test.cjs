const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTS } = require('./helpers/load-ts.cjs');

test('generated native speech opens no microphone and cleans temporary audio after cancellation', async () => {
  let removed = 0, released = 0, started = 0, callback;
  const player = { addListener: (_name, fn) => { callback = fn; return { remove() {} }; }, play() { callback({ playing: true }); }, pause() {}, release() { released++; } };
  const speech = loadTS('src/lib/standalone-speech.ts', {
    'expo-audio': { createAudioPlayer: () => player },
    'expo-file-system': { Paths: { cache: 'cache' }, File: class { exists = true; uri = 'file://generated.wav'; create() {} write(value, options) { assert.equal(value, 'generated-audio'); assert.equal(options.encoding, 'base64'); } delete() { removed++; } } },
    'react-native': { Platform: { OS: 'android' } },
    '@/lib/voice-playback': { playVoice() { assert.fail('standalone speech must not use microphone-dependent playback'); } },
    '@/lib/portrait-speech': loadTS('src/lib/portrait-speech.ts'),
  });
  const controller = new AbortController();
  const playing = speech.playStandaloneSpeech('generated-audio', controller.signal, () => { started++; });
  assert.equal(started, 1);
  controller.abort(); await playing;
  assert.equal(removed, 1); assert.equal(released, 1);
});
