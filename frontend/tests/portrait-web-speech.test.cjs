const test = require('node:test');
const assert = require('node:assert/strict');
const { createPhrasePlayback } = require('../public/padi-chat/phrase-playback.js');
const { b: collectSentences } = require('../public/padi-chat/modules/chunk-DOJQV6DN.js');
const { beginLiveTurn, turnTranscript } = require('../public/padi-chat/turn-transcript.js');
const { VoiceActivity } = require('../public/padi-chat/voice-activity.js');
const { loadTS } = require('./helpers/load-ts.cjs');

test('the web call applies the saved fast voice only to supported speech output', async () => {
  const config = {
    enabled: true, natural_speech: true, local_speech: true, voice_text_streaming: true,
    speech_languages: ['en-GB', 'en-NG', 'pcm-NG'], streaming_speech_languages: ['en-NG', 'pcm-NG'],
    live_recognition_languages: ['en-NG', 'en-GB', 'pcm-NG', 'fr-FR'],
  };
  let session, checks = 0;
  const { openVoice } = loadTS('public/padi-chat/voice-call.js', {
    './modules/voice-O2A7VXYY.js': {
      HandsfreeSession: class { constructor(options) { session = options; } start() {} cancel() {} },
      openLiveRecognition: (_token, language) => language,
    },
    './modules/chunk-Z7CSBWWK.js': {},
    './modules/chunk-AJUFN7HS.js': { a: (_style, rate, language, _signal, _start, _delivered, streaming) => ({rate, language, streaming}) },
    './modules/chunk-DOJQV6DN.js': {},
    './modules/chunk-4DYWZHQL.js': {},
    './modules/chunk-PRFFR5IG.js': {
      a: (settings, language) => settings.streaming_speech_languages.includes(language),
      i: async () => { checks++; return config; },
    },
  });
  function call(languageCode, fastEnglishVoice) {
    const preferences = {languageCode, fastEnglishVoice, voiceRate: 1.15, voiceId: 'ada'};
    const updates = [];
    const voice = openVoice({chat: {account: {user: {id: 'test'}}}, preferences, changed: state => updates.push(state), report() {}});
    return {voice, preferences, updates};
  }

  const {voice, preferences, updates} = call('pcm-NG', false);
  await voice.start();
  assert.equal(checks, 1);
  assert.equal(updates.some(state => state.fastEnglishAvailable), true);
  const original = session.createSpeech();
  preferences.fastEnglishVoice = true;
  assert.deepEqual(session.createSpeech(), {rate: 1.15, language: 'en-GB', streaming: false});
  assert.deepEqual(original, {rate: 1.15, language: 'pcm-NG', streaming: true});
  assert.equal(session.openRecognition(), 'pcm-NG');
  voice.close();

  for (const [language, local] of [['fr-FR', true], ['en-NG', false]]) {
    config.local_speech = local;
    const {voice, updates} = call(language, true);
    await voice.start();
    assert.equal(updates.some(state => state.fastEnglishAvailable), false);
    if (language === 'fr-FR') {
      assert.equal(updates.at(-1).offer.language, language);
      await voice.touch('captions');
      assert.equal(session.createSpeech(), null);
    } else {
      assert.equal(session.createSpeech().language, language);
    }
    voice.close();
  }
});

function wave(size, sample) {
  const bytes = Buffer.alloc(44 + size * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(24000, 24); bytes.writeUInt32LE(48000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(size * 2, 40);
  for (let at = 44; at < bytes.length; at += 2) bytes.writeInt16LE(sample, at);
  return bytes.toString('base64');
}

function setup(live = false) {
  const output = [], requests = [], credits = [], pending = [];
  const call = new AbortController();
  const stream = createPhrasePlayback({
    signal: call.signal, live, clean: text => text, onStart() {},
    delivered: text => credits.push(text),
    prepare: (words, signal, packet) => new Promise((end, fail) => {
      requests.push({ words, packet, end, fail });
      signal.addEventListener('abort', end, { once: true });
    }),
    makePlayer: () => ({
      enqueue(audio) {
        output.push(Buffer.from(audio, 'base64'));
        let finish;
        const promise = new Promise(resolve => { finish = resolve; });
        pending.push({ promise, resolve: finish });
        return promise;
      },
      finish() { return Promise.all(pending.map(part => part.promise)); },
    }),
  });
  return { stream, call, output, requests, credits, pending };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('live replies can speak the opening before the rest of the sentence arrives', () => {
  for (const opening of ['Yes!', 'Of course,', 'We can go over the']) {
    const spoken = [];
    const stream = collectSentences(words => spoken.push(words), { live: true });
    const next = opening.endsWith('the') ? ' details' : '';
    stream.append(opening + next + ' ');
    assert.deepEqual(spoken, [opening]);
    stream.append('together.');
    stream.finish(opening + next + ' together.');
    assert.equal(spoken.join(' '), opening + next + ' together.');
  }
});

test('early recognition survives a resumed sentence and submits once after a full second', async () => {
  const passes = [], captions = [], submitted = [];
  const recognition = { begin(rate, partial) {
    const pass = { audio: [], partial, finishes: 0 };
    passes.push(pass);
    return { write: pcm => pass.audio.push(Buffer.from(pcm)), finish() {
      pass.finishes++;
      return Promise.resolve(passes.length === 1 ? 'please' : 'please continue');
    } };
  } };
  let input;
  const detector = new VoiceActivity(rate => {
    input = beginLiveTurn(recognition, rate, word => captions.push(word));
  }, () => submitted.push(input.finish()), {
    onsetMs: 120, audio: pcm => input.write(pcm), quiet: ms => input.quiet(ms),
  });
  function feed(sample, count) {
    const data = new Int16Array(800).fill(sample).buffer;
    for (let i = 0; i < count; i++) detector.feed({ data, channels: 1, sampleRate: 16000 });
  }
  feed(1500, 8);
  feed(0, 19);
  assert.equal(passes[0].finishes, 1);
  assert.equal(submitted.length, 0);
  feed(1800, 8);
  passes[0].partial('stale');
  passes[1].partial('please continue');
  assert.deepEqual(captions, ['please continue']);
  feed(0, 19);
  assert.equal(submitted.length, 0);
  feed(0, 1);
  assert.deepEqual(await Promise.all(submitted), ['please continue']);
  assert.equal(passes[1].audio.length, 8 + 19 + 8 + 6);
  assert.deepEqual(passes.map(pass => pass.finishes), [1, 1]);
});

test('a slow first phrase plays while the second is still being synthesized', async () => {
  const { stream, output, requests, credits, pending } = setup();
  stream.enqueue('Hi there.'); stream.enqueue('I hear you.');
  const done = stream.finish();
  assert.equal(stream.finish(), done);
  await tick();
  requests[0].packet(wave(2400, 1)); requests[0].packet(wave(2400, 2));
  assert.equal(output.length, 0);
  requests[0].end(); await tick();
  assert.deepEqual(requests.map(r => r.words), ['Hi there.', 'I hear you.']);
  assert.equal(output.length, 1);
  assert.equal(output[0].readUInt32LE(40), 9600);
  assert.equal(output[0].readInt16LE(44), 1);
  assert.equal(output[0].readInt16LE(4844), 2);
  assert.deepEqual(credits, []);
  pending[0].resolve(); await tick();
  assert.deepEqual(credits, ['Hi there.']);
  requests[1].packet(wave(1200, 3)); requests[1].end(); await tick();
  pending[1].resolve(); await done;
  assert.equal(output.length, 2);
  assert.deepEqual(credits, ['Hi there.', 'I hear you.']);
});

test('live calls schedule even a short first packet on arrival and credit only the complete phrase', async () => {
  const { stream, requests, output, pending, credits } = setup(true);
  stream.enqueue('Hello there.');
  const done = stream.finish();
  await tick();
  requests[0].packet(wave(480, 1));
  assert.equal(output.length, 1);
  pending[0].resolve(true);
  await tick();
  assert.deepEqual(credits, []);
  requests[0].packet(wave(480, 2));
  assert.equal(output.length, 2);
  requests[0].end();
  pending[1].resolve(true);
  await done;
  assert.deepEqual(credits, ['Hello there.']);
});

test('a fast packet plays before completion and cancellation drops later audio', async () => {
  const { stream, call, output, requests, pending, credits } = setup();
  stream.enqueue('Hello.'); stream.enqueue('Again.');
  await tick();
  requests[0].packet(wave(24000, 4));
  assert.equal(output.length, 1);
  call.abort();
  requests[0].packet(wave(2400, 5));
  pending[0].resolve(); await stream.finish();
  assert.equal(requests.length, 1);
  assert.equal(output.length, 1);
  assert.deepEqual(credits, []);
});

test('an incomplete or invalid phrase never plays as a completed reply', async () => {
  const { stream, requests, output, credits } = setup();
  stream.enqueue('Hello.');
  const done = stream.finish(); await tick();
  requests[0].packet(wave(1000, 6));
  requests[0].fail(new Error('Speech ended early.'));
  await assert.rejects(done, /ended early/);
  assert.equal(output.length, 0);
  assert.deepEqual(credits, []);
});

test('a live result sends once and only ambiguous short I is checked against the recording', async () => {
  const signal = new AbortController().signal;
  const short = { pcm: new Uint8Array(32000), sampleRate: 16000 };
  const unused = () => assert.fail('unexpected second transcription');
  assert.equal(await turnTranscript(Promise.resolve('good morning'), short, true, unused, signal), 'good morning');
  assert.equal(await turnTranscript(Promise.resolve('hi'), short, true, unused, signal), 'hi');
  assert.equal(await turnTranscript(Promise.resolve(''), short, true, unused, signal), '');
  for (const checked of ['Hi.', 'I.']) {
    let checks = 0;
    assert.equal(await turnTranscript(Promise.resolve('i'), short, true, () => { checks++; return checked; }, signal), checked);
    assert.equal(checks, 1);
  }
  await assert.rejects(turnTranscript(Promise.resolve('i'), short, true, async () => 'unclear', signal), /say that again/);
});

test('a dropped caption connection uses the retained microphone turn once, until cancelled', async () => {
  const call = new AbortController();
  const audio = { pcm: new Uint8Array(32000), sampleRate: 16000 };
  const closed = () => Promise.reject(new Error('Live captions disconnected.'));
  let uploads = 0;
  const upload = async () => { uploads++; return 'hello'; };
  assert.equal(await turnTranscript(closed(), audio, true, upload, call.signal), 'hello');
  await assert.rejects(turnTranscript(closed(), audio, false, upload, call.signal), /disconnected/);
  call.abort();
  assert.equal(await turnTranscript(closed(), audio, true, upload, call.signal), '');
  assert.equal(uploads, 1);
});

test('a one-word interruption is checked against its audio without remapping an ordinary word', async () => {
  const clip = {pcm:new Uint8Array(32000), sampleRate:16000};
  const signal = new AbortController().signal;
  for (const verified of ['Hi.', 'Guy.', 'Bye.']) {
    assert.equal(await turnTranscript(Promise.resolve('guy'), clip, true, async()=>verified, signal, true), verified);
  }
  assert.equal(await turnTranscript(Promise.resolve('guy'), clip, true, ()=>assert.fail('unexpected upload'), signal), 'guy');
});
