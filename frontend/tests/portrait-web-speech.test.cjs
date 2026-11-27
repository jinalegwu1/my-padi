const test = require('node:test');
const assert = require('node:assert/strict');
const { createPhrasePlayback } = require('../public/padi-chat/phrase-playback.js');
const { turnTranscript } = require('../public/padi-chat/turn-transcript.js');

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

function setup() {
  const output = [], requests = [], credits = [], pending = [];
  const call = new AbortController();
  const stream = createPhrasePlayback({
    signal: call.signal, clean: text => text, onStart() {},
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
