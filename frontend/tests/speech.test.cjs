const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTS } = require('./helpers/load-ts.cjs');
const { spokenText } = loadTS('src/lib/spoken-text.ts');

test('natural speech segments preserve decimals, list numbers and every spoken word',()=>{
  const {speechSegments}=loadTS('src/lib/voice-audio.ts',{'react-native':{Platform:{OS:'web'}},'expo-file-system':{}});
  const text='1. Get 2.5 litres. Ask Dr. Ada for help! Keep every word.';
  assert.equal(speechSegments(text).join(' '),text);
  assert.deepEqual(speechSegments(''),[]);
});

test('spoken text preserves words, numbers and maths while removing decorative Markdown and emojis', () => {
  const text = '# **Get eggs** 😊\n- Take *two* eggs.\n1. **Get bread** 🍞\nRead [the guide](https://padi.test). 2 * 3 = 6.\n```js\nconsole.log(1)\n```';
  const spoken = spokenText(text);
  assert.ok(spoken.includes('Get eggs'));
  assert.ok(spoken.includes('Take two eggs.'));
  assert.ok(spoken.includes('1. Get bread'));
  assert.ok(spoken.includes('the guide'));
  assert.ok(spoken.includes('2 * 3 = 6'));
  assert.ok(!spoken.includes('😊') && !spoken.includes('**') && !spoken.includes('https://') && !spoken.includes('console.log'));
});

test('speech resolves from callbacks and abort stops playback without waiting for completion', async () => {
  const calls = [];
  let stopped = 0, started = 0;
  const speech = loadTS('src/lib/speech.ts', {
    'expo-speech': { maxSpeechInputLength: 4000, getAvailableVoicesAsync: async () => [{ language: 'en-US', identifier: 'device-en' }],
      speak: (text, options) => calls.push({ text, options }), stop: async () => { stopped++; } },
    '@/data/languages': { findVoice: () => ({ id: 'ada', gender: 'female' }) },
    '@/lib/spoken-text': { spokenText },
  });
  const controller = new AbortController();
  const playing = speech.speakPadiReply('**Hi** 😊', 'ada', 1, 'en-NG', controller.signal, () => { started++; });
  await Promise.resolve();
  assert.equal(calls[0].text, 'Hi');
  assert.equal(calls[0].options.voice, 'device-en');
  assert.equal(started, 0);
  calls[0].options.onStart();
  assert.equal(started, 1);
  controller.abort();
  await playing;
  assert.equal(stopped, 1);
});

test('missing installed voice reports failure instead of pretending to speak', async () => {
  const speech = loadTS('src/lib/speech.ts', {
    'expo-speech': { getAvailableVoicesAsync: async () => [], stop: async () => {}, speak: () => assert.fail('unsupported voice should not play') },
    '@/data/languages': { findVoice: () => ({ id: 'ada', gender: 'female' }) }, '@/lib/spoken-text': { spokenText },
  });
  await assert.rejects(speech.speakPadiReply('Hello', 'ada', 1, 'yo-NG', new AbortController().signal, () => {}), /No device speech voice/);
});
