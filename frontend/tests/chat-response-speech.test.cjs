const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTS, loadJS } = require('./helpers/load-ts.cjs');

function speech(overrides = {}) {
  const synthesisCalls = [];
  const playbackCalls = [];
  const api = {
    synthesiseSpeech: async (...args) => {
      synthesisCalls.push(args);
      return { audio_base64: args[1] };
    },
    ...overrides.api,
  };
  const playback = {
    pauseStandaloneSpeech: async () => {},
    resumeStandaloneSpeech: async () => {},
    playStandaloneSpeech: async (...args) => { playbackCalls.push(args); args[2](); },
    ...overrides.playback,
  };
  const voiceAudio = loadJS('src/lib/voice-audio.js', {
    'react-native': { Platform: { OS: 'web' } },
    'expo-file-system': {},
  });
  const module = loadTS('src/lib/chat-response-speech.ts', {
    '@/lib/api': api,
    '@/lib/session': { readSession: async () => ({ token: 'account-token', user: { id: 'account-id' } }), ...overrides.session },
    '@/lib/standalone-speech': playback,
    '@/lib/voice-audio': voiceAudio,
  });
  return { module, synthesisCalls, playbackCalls };
}

test('text chat synthesis uses the exact AI reply and selected voice settings', async () => {
  const { module, synthesisCalls, playbackCalls } = speech();
  const text = 'The exact answer is: 2 + 2 = 4. 😊';
  let started = 0;
  const controller = new AbortController();
  await module.createChatResponseSpeech({
    text,
    voiceId: 'amara',
    voiceRate: 0.85,
    languageCode: 'fr-FR',
    signal: controller.signal,
    onStart: () => started++,
  }).play();

  assert.equal(synthesisCalls.length, 1);
  assert.deepEqual(synthesisCalls[0].slice(0, 3), ['account-token', text, 'amara']);
  assert.equal(synthesisCalls[0][3], 0.85);
  assert.equal(synthesisCalls[0][5], 'fr-FR');
  assert.equal(playbackCalls[0][0], text);
  assert.equal(started, 1);
});

test('the original response and three replays synthesize once and replay cached audio', async t => {
  const requests = [];
  const startLatenciesMs = [];
  const { module, playbackCalls } = speech({
    api: {
      synthesiseSpeech: async (...args) => {
        requests.push(args);
        await new Promise(resolve => setTimeout(resolve, 35));
        return { audio_base64: 'generated-audio' };
      },
    },
  });
  const playOnce = async () => {
    const startedAt = performance.now();
    const task = module.createChatResponseSpeech({
      text: 'A response to replay.',
      voiceId: 'amara',
      voiceRate: 1,
      languageCode: 'en-NG',
      signal: new AbortController().signal,
      onStart: () => startLatenciesMs.push(performance.now() - startedAt),
    });
    await task.play();
  };

  await playOnce();
  await playOnce();
  await playOnce();
  await playOnce();

  assert.equal(requests.length, 1, 'Only the original playback should call the TTS API.');
  assert.equal(playbackCalls.length, 4, 'Original playback and all three replays should play audio.');
  assert.equal(startLatenciesMs.length, 4);
  assert.ok(startLatenciesMs[0] >= 30, 'The first playback includes the controlled TTS delay.');
  assert.ok(startLatenciesMs.slice(1).every(latency => latency < startLatenciesMs[0]),
    `Replays should start faster than the original: ${startLatenciesMs.map(value => value.toFixed(1)).join(', ')} ms`);
  t.diagnostic(`playback-start ms (original, replay 1-3): ${startLatenciesMs.map(value => value.toFixed(1)).join(', ')}; TTS requests: ${requests.length}`);
});

test('overlapping play calls on one response share a single playback request', async () => {
  const requests = [];
  const { module, playbackCalls } = speech({
    api: {
      synthesiseSpeech: async (...args) => {
        requests.push(args);
        return { audio_base64: 'generated-audio' };
      },
    },
    playback: {
      playStandaloneSpeech: async (...args) => {
        playbackCalls.push(args);
        args[2]();
        await new Promise(resolve => setTimeout(resolve, 15));
      },
    },
  });
  const task = module.createChatResponseSpeech({
    text: 'A response.',
    voiceId: 'amara',
    voiceRate: 1,
    languageCode: 'en-NG',
    signal: new AbortController().signal,
    onStart() {},
  });

  const first = task.play();
  const duplicate = task.play();
  assert.equal(duplicate, first);
  await Promise.all([first, duplicate]);
  assert.equal(requests.length, 1);
  assert.equal(playbackCalls.length, 1);
});

test('long single-sentence replies are sent in bounded segments without dropping words', async () => {
  const { module, synthesisCalls, playbackCalls } = speech();
  const text = Array(150).fill('PADI keeps every word in this unusually long response').join(' ');
  const controller = new AbortController();
  await module.createChatResponseSpeech({
    text,
    voiceId: 'zainab',
    voiceRate: 1.15,
    languageCode: 'en-NG',
    signal: controller.signal,
    onStart() {},
  }).play();

  const segments = synthesisCalls.map(call => call[1]);
  assert.ok(segments.length > 1);
  assert.ok(segments.every(segment => segment.length <= 650));
  assert.equal(playbackCalls.map(call => call[0]).join(' '), text);
});

test('pause during synthesis holds the next audio segment until resume', async () => {
  let resolveSynthesis;
  let playbackStarted = false;
  const { module, playbackCalls } = speech({
    api: {
      synthesiseSpeech: () => new Promise(resolve => { resolveSynthesis = resolve; }),
    },
    playback: {
      playStandaloneSpeech: async (...args) => {
        playbackStarted = true;
        playbackCalls.push(args);
      },
    },
  });
  const controller = new AbortController();
  const task = module.createChatResponseSpeech({
    text: 'A short reply.',
    voiceId: 'baby',
    voiceRate: 1,
    languageCode: 'en-NG',
    signal: controller.signal,
    onStart() {},
  });
  const playing = task.play();
  await new Promise(setImmediate);
  await task.pause();
  resolveSynthesis({ audio_base64: 'paused-audio' });
  await new Promise(setImmediate);
  assert.equal(playbackStarted, false);
  await task.resume();
  await playing;
  assert.equal(playbackStarted, true);
});

test('speech generation failures surface to the caller without requiring text changes', async () => {
  const { module } = speech({ api: { synthesiseSpeech: async () => { throw new Error('Voice unavailable'); } } });
  await assert.rejects(module.createChatResponseSpeech({
    text: 'Still visible in chat.',
    voiceId: 'custom-style',
    voiceRate: 1,
    languageCode: 'en-NG',
    signal: new AbortController().signal,
    onStart() {},
  }).play(), /Voice unavailable/);
});
