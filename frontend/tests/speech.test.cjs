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

test('streamed speech releases complete sentences and buffers an unfinished sentence',()=>{
  const {takeCompletedSentences}=loadTS('src/lib/voice-audio.ts',{'react-native':{Platform:{OS:'web'}},'expo-file-system':{}});
  assert.deepEqual(takeCompletedSentences('Hello there. How are').sentences,['Hello there.']);
  assert.equal(takeCompletedSentences('Hello there. How are').remainder,'How are');
  assert.deepEqual(takeCompletedSentences('Dr. Ada is here!').sentences,['Dr. Ada is here!']);
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


function expressive(overrides = {}) {
  return loadTS('src/lib/speech.ts', {
    '@/lib/api': { synthesiseSpeech: async () => ({ audio_base64: 'real-audio' }), fetchVoiceSample: async () => ({ audio_base64: 'sample-audio' }), ...overrides.api },
    '@/lib/session': { readSession: async () => ({ token: 'account-token' }), subscribeSession: () => () => {}, ...overrides.session },
    '@/lib/voice-audio': { speechSegments: text => [text] },
    '@/lib/spoken-text': { spokenText },
    '@/lib/standalone-speech': { playStandaloneSpeech: async () => {}, ...overrides.playback },
    '@/lib/voice-playback': { unlockVoicePlayback: async () => {} },
    'expo-speech': { speak: () => assert.fail('PADI must not use device speech') },
  });
}

test('personal greetings use the expressive service and wait for actual playback', async () => {
  let request, playback, started = 0;
  const speech = expressive({
    api: { synthesiseSpeech: async (...args) => { request = args; return { audio_base64: 'generated' }; } },
    playback: { playStandaloneSpeech: (audio, signal, onStart) => new Promise(resolve => { playback = { audio, signal, onStart, resolve }; }) },
  });
  const result = speech.speakPadiReply('**Hi** 😊', 'ada', 1, 'pcm-NG', new AbortController().signal, () => { started++; });
  await new Promise(setImmediate);
  assert.equal(request[0], 'account-token'); assert.equal(request[1], 'Hi'); assert.equal(request[2], 'ada');
  assert.equal(request[5], 'pcm-NG');
  assert.equal(playback.audio, 'generated'); assert.equal(started, 0);
  playback.onStart(); playback.resolve();
  assert.equal(await result, 'played'); assert.equal(started, 1);
  assert.equal(speech.padiVoiceOptions('baby', 1).pitch, 1);
});

test('account changes discard pending speech and cannot report it played', async () => {
  let change, finish, closed = 0;
  const speech = expressive({
    api: { synthesiseSpeech: () => new Promise(resolve => { finish = resolve; }) },
    session: { subscribeSession: callback => { change = callback; return () => { closed++; }; } },
    playback: { playStandaloneSpeech: () => assert.fail('old account speech must not play') },
  });
  const result = speech.speakPadiReply('Private greeting', 'chidi', 1, 'en-NG', new AbortController().signal, () => assert.fail('stale speech must not start'));
  await new Promise(setImmediate);
  change(); finish({ audio_base64: 'late-audio' });
  assert.equal(await result, 'cancelled'); assert.equal(closed, 1);
});

test('unavailable natural speech reports failure without a robotic fallback', async () => {
  const speech = expressive({
    api: { synthesiseSpeech: async () => { throw new Error('Natural voice unavailable'); } },
    playback: { playStandaloneSpeech: () => assert.fail('failed audio must not play') },
  });
  await assert.rejects(speech.speakPadiReply('Hello', 'ada', 1, 'en-NG', new AbortController().signal, () => {}), /Natural voice unavailable/);
});

test('unsigned personal text stays private while fixed introductions and previews are available', async () => {
  const requests = [];
  const speech = expressive({
    api: { synthesiseSpeech: () => assert.fail('unsigned personal text must not reach speech'), fetchVoiceSample: async (...args) => { requests.push(args); return { audio_base64: 'fixed-public-sample' }; } },
    session: { readSession: async () => null },
  });
  await assert.rejects(speech.speakPadiReply('Private weather greeting', 'ada', 1, 'en-NG', new AbortController().signal, () => {}), /Sign in/);
  assert.equal(await speech.speakPadiWelcome('ada', 'fr-FR', new AbortController().signal, () => {}), 'played');
  assert.equal(await speech.speakVoicePreview('tunde', 1.15, new AbortController().signal, () => {}), 'played');
  assert.deepEqual(requests.map(args => [args[0], args[1]]), [['welcome', 'ada'], ['preview', 'tunde']]);
});

test('long voice replies play their first sentence before the rest without losing words',()=>{
  const {speechSegments}=loadTS('src/lib/voice-audio.ts',{'react-native':{Platform:{OS:'web'}},'expo-file-system':{}});
  const first='Here is the answer.';
  const text=first+' '+Array(12).fill('This is a further explanation.').join(' ');
  const segments=speechSegments(text);
  assert.equal(segments[0],first);assert.equal(segments.join(' '),text);
  assert.equal(speechSegments('I’m doing well. How about you?').length,1);
});

test('touch greetings speak the actual cached words in the selected language and drive the chosen face',async()=>{
  let fetched,spoken,displayed;
  const speech=expressive({api:{fetchVoiceSample:async(...args)=>{fetched=args;return {audio_base64:'greeting',text:'Bonjour ! Bienvenue.',mime_type:'audio/wav'};}},
    playback:{playStandaloneSpeech:async(...args)=>{spoken=args;args[2]();}}});
  let started=false;
  await speech.speakPortraitGreeting('ada','fr-FR',1,new AbortController().signal,()=>{started=true;},text=>{displayed=text;});
  assert.deepEqual(fetched.slice(0,4),['call','ada','fr-FR',1]);
  assert.equal(displayed,'Bonjour ! Bienvenue.');assert.equal(spoken[3],'ada');assert.equal(started,true);
});
