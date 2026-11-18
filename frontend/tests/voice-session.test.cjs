const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTS } = require('./helpers/load-ts.cjs');
const { VoiceSession } = loadTS('src/lib/voice-session.ts');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function fixture(overrides = {}) {
  const calls = [];
  let snapshot;
  let interrupted;
  const deps = {
    readSession: async () => ({ token: 'test-token', user: { id: 'a' } }),
    recording: callback => { interrupted = callback; return {
      start: async () => { calls.push('microphone'); },
      finish: async () => { calls.push('finish'); return new FormData(); },
      cancel: async () => { calls.push('cleanup'); },
    }; },
    transcribe: async (token) => { assert.equal(token, 'test-token'); calls.push('transcribe'); return 'What about our project?'; },
    send: async (text, owner) => { assert.equal(owner, 'a'); calls.push('chat'); return { status: 'sent', reply: '**Our plan** 😊' }; },
    speak: async (text, signal, onStart) => { assert.equal(text, '**Our plan** 😊'); calls.push('speech'); onStart(); },
    stopSpeech: async () => { calls.push('stop speech'); },
    changed: next => { snapshot = next; },
    ...overrides,
  };
  return { session: new VoiceSession(deps), calls, get snapshot() { return snapshot; }, interrupt: () => interrupted() };
}

test('voice uploads only after Stop and send and retains real transcript and reply', async () => {
  const f = fixture();
  await f.session.start();
  assert.equal(f.snapshot.phase, 'listening');
  assert.deepEqual(f.calls, ['stop speech', 'microphone']);
  await f.session.stopAndSend();
  assert.equal(f.snapshot.phase, 'idle');
  assert.equal(f.snapshot.userText, 'What about our project?');
  assert.equal(f.snapshot.padiText, '**Our plan** 😊');
  assert.ok(f.calls.indexOf('transcribe') < f.calls.indexOf('chat'));
  assert.ok(f.calls.indexOf('chat') < f.calls.indexOf('speech'));
});

test('cancelled listening never uploads and allows a new turn after cleanup', async () => {
  const f = fixture();
  await f.session.start();
  await f.session.cancel();
  assert.equal(f.calls.includes('transcribe'), false);
  await f.session.start();
  assert.equal(f.snapshot.phase, 'listening');
  await f.session.cancel();
});

test('late permission result after cancellation cannot start a turn', async () => {
  const pending = deferred();
  const f = fixture({ readSession: () => pending.promise });
  const start = f.session.start();
  await f.session.cancel();
  pending.resolve({ token: 'test-token', user: { id: 'a' } });
  await start;
  assert.equal(f.snapshot.phase, 'idle');
  assert.equal(f.calls.includes('microphone'), false);
});

test('late transcription after account change never reaches chat or speech', async () => {
  const pending = deferred();
  const f = fixture({ transcribe: () => pending.promise });
  await f.session.start();
  const send = f.session.stopAndSend();
  await Promise.resolve();
  await f.session.cancel('Account changed', true);
  pending.resolve('Old private words');
  await send;
  assert.equal(f.calls.includes('chat'), false);
  assert.equal(f.calls.includes('speech'), false);
  assert.equal(f.snapshot.userText, undefined);
  assert.equal(f.snapshot.padiText, '');
});

test('late AI response after cancellation is never spoken', async () => {
  const pending = deferred();
  const f = fixture({ send: () => pending.promise });
  await f.session.start();
  const send = f.session.stopAndSend();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await f.session.cancel();
  pending.resolve({ status: 'sent', reply: 'Late reply' });
  await send;
  assert.equal(f.calls.includes('speech'), false);
});

test('transcription failure never invents a chat turn', async () => {
  const f = fixture({ transcribe: async () => { throw new Error('No clear speech'); } });
  await f.session.start();
  await f.session.stopAndSend();
  assert.equal(f.snapshot.error, 'No clear speech');
  assert.equal(f.snapshot.userText, undefined);
  assert.equal(f.calls.includes('chat'), false);
});

test('playback failure preserves the reply and replay does not call AI again', async () => {
  let plays = 0;
  const f = fixture({ speak: async (_text, _signal, onStart) => { if (++plays === 1) throw new Error('Autoplay blocked'); onStart(); } });
  await f.session.start();
  await f.session.stopAndSend();
  assert.equal(f.snapshot.error, 'Autoplay blocked');
  assert.equal(f.snapshot.padiText, '**Our plan** 😊');
  await f.session.replay();
  assert.equal(plays, 2);
  assert.equal(f.calls.filter(call => call === 'chat').length, 1);
  assert.equal(f.snapshot.phase, 'idle');
});

test('microphone interruption cancels without uploading', async () => {
  const f = fixture();
  await f.session.start();
  f.interrupt();
  await f.session.cancel();
  assert.equal(f.calls.includes('transcribe'), false);
});
