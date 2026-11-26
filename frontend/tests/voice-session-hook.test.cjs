const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { create, act } = require('react-test-renderer');
const { loadTS } = require('./helpers/load-ts.cjs');
const voiceAudio = loadTS('src/lib/voice-audio.ts', { 'react-native': { Platform: { OS: 'web' } }, 'expo-file-system': {} });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function fixture(config = {}, settings = {}, failure) {
  const calls = [];
  const preferences = { voiceId: 'ada', voiceRate: 1, languageCode: 'en-NG', ...settings };
  let deps, voice, root;
  const { useVoiceSession } = loadTS('src/hooks/use-voice-session.ts', {
    'react-native': { Platform: { OS: 'ios' }, AppState: { addEventListener: () => ({ remove() {} }) } },
    '@/hooks/use-chat': { useChat: () => ({ status: 'ready', isThinking: false,
      greet: async (accountID, language, signal, onDelta) => {
        calls.push(['greeting', accountID, language, signal]);
        onDelta('Hey! '); onDelta('What has your day been up to?');
        return { status: 'sent', reply: 'Hey! What has your day been up to?' };
      } }) },
    '@/hooks/use-preferences': { usePreferences: () => ({ preferences }) },
    '@/lib/api': { getVoiceConfiguration: async () => ({ enabled: true, groq_conversation: true,
      local_transcription: true, transcription_ready: true, natural_speech: true, groq_live_speech: true, ...config }) },
    '@/lib/session': { readSession: async () => ({ token: 'token', user: { id: 'a' } }), subscribeSession: () => () => {} },
    '@/lib/voice-capture': { VoiceCapture: class {} }, '@/lib/voice-audio': voiceAudio,
    '@/lib/streaming-speech': { createGroqSpeechStream: (...args) => {
      calls.push(['groq', ...args]);
      return { enqueue: text => calls.push(['text', text]), finish: async () => { if (failure) throw failure; } };
    } },
    '@/lib/handsfree-session': { HandsfreeSession: class {
      constructor(value) { deps = value; }
      async start(options) { calls.push(['start', options]); }
      async cancel() {}
    } },
    '@/lib/voice-playback': { unlockVoicePlayback: async () => {} },
    '@/lib/voice-echo': { suppressPlaybackEcho:frame=>frame },
  });
  function Probe() { voice = useVoiceSession(); return null; }
  await act(async () => { root = create(React.createElement(Probe)); });
  return { calls, deps, get voice() { return voice; }, close: async () => act(async () => root.unmount()) };
}

test('portrait calls and replies use the Groq stream with the selected voice', async () => {
  const f = await fixture();
  try {
    assert.equal(f.voice.ready, true); f.voice.connect();
    assert.deepEqual(f.calls[0], ['start', { greet: true, wake: false, greetBeforeCapture: false }]);
    await f.deps.greet(new AbortController().signal, () => {}, () => {});
    assert.deepEqual(f.calls[1].slice(0, 4), ['groq', 'ada', 1, 'en-NG']);
    assert.deepEqual(f.calls[2].slice(0, 3), ['greeting', 'a', 'en-NG']);
    assert.deepEqual(f.calls.filter(call => call[0] === 'text').map(call => call[1]), ['Hey!', 'What has your day been up to?']);
    const speech = f.deps.createSpeech(new AbortController().signal, () => {}, () => {});
    speech.enqueue('The actual response.'); await speech.finish();
    assert.deepEqual(f.calls.at(-1), ['text', 'The actual response.']);
  } finally { await f.close(); }
});

test('unsupported Groq settings report an error and never select Gemini', async () => {
  for (const [config, settings] of [[{ groq_live_speech: false }, {}], [{}, { languageCode: 'fr-FR' }], [{}, { voiceRate: 0.85 }]]) {
    const f = await fixture(config, settings);
    try { assert.equal(f.voice.ready, false); assert.match(f.voice.configurationError, /spoken replies|voice/i); assert.equal(f.calls.length, 0); }
    finally { await f.close(); }
  }
});

test('Groq speech failure propagates without another provider request', async () => {
  const f = await fixture({}, {}, new Error('Groq unavailable'));
  try {
    const speech = f.deps.createSpeech(new AbortController().signal, () => {}, () => {});
    speech.enqueue('Preserve the response.');
    await assert.rejects(speech.finish(), /Groq unavailable/);
    assert.deepEqual(f.calls.map(call => call[0]), ['groq', 'text']);
  } finally { await f.close(); }
});


test('Agnes text streaming and local Python speech work without Groq speech capability', async () => {
  const f = await fixture({ groq_conversation: false, voice_text_streaming: true, groq_live_speech: false,
    local_speech: true, speech_languages: ['en-NG','fr-FR'] }, {languageCode:'fr-FR',voiceRate:0.85});
  try {
    assert.equal(f.voice.ready,true);
    const speech=f.deps.createSpeech(new AbortController().signal,()=>{},()=>{});
    speech.enqueue('The generated reply.'); await speech.finish();
    assert.deepEqual(f.calls.at(-1),['text','The generated reply.']);
  } finally { await f.close(); }
});
