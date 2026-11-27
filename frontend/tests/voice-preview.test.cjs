const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTS } = require('./helpers/load-ts.cjs');

test('every human voice preview delegates the selected style and pace to the expressive service', async () => {
  const calls = [];
  const preview = loadTS('src/lib/voice-preview.ts', {
    '@/lib/speech': { speakVoicePreview: async (...args) => { calls.push(args); args[3](); return 'played'; } },
  });
  const controller = new AbortController();
  for (const style of ['baby', 'ada', 'chidi', 'zainab', 'tunde', 'amara']) {
    let started = false;
    await preview.previewVoice('Public sample', style, 1.15, controller.signal, () => { started = true; });
    assert.equal(started, true); assert.equal(calls.at(-1)[0], style);
    assert.equal(calls.at(-1)[1], 1.15); assert.equal(calls.at(-1)[2], controller.signal);
  }
});

test('human voice catalog contains the six requested people and portraits', () => {
  const { VOICES } = loadTS('src/data/languages.ts');
  assert.deepEqual(VOICES.map((voice) => voice.id), ['baby', 'ada', 'chidi', 'zainab', 'tunde', 'amara']);
  assert.deepEqual(
    VOICES.map((voice) => [voice.name, voice.gender]),
    [['PADI', 'female'], ['Ada', 'female'], ['Chidi', 'female'], ['Zainab', 'female'], ['Tunde', 'male'], ['Amara', 'male']],
  );
  for (const voice of VOICES) {
    assert.ok(['images.unsplash.com', 'images.pexels.com'].includes(new URL(voice.imageUrl).hostname));
    assert.ok(voice.imageDescription.length > 0);
  }
});
