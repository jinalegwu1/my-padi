const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTS } = require('./helpers/load-ts.cjs');
const { TranscriptionSession } = loadTS('src/lib/transcription-session.ts');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const account = { token: 'account-token', user: { id: 'account-a' } };
const result = { text: 'How you dey?', user_id: 'account-a', request_id: 'a'.repeat(32) };

function fixture(overrides = {}) {
  const phases = [], calls = [];
  let snapshot, interrupted;
  const deps = {
    readSession: async () => account,
    recording: callback => { interrupted = callback; return {
      metadata: { mime: 'audio/webm;codecs=opus', audioBytes: 2000, pcmBytes: 32000, durationMs: 1000, compressionMs: 1 },
      start: async () => { calls.push('microphone'); }, finish: async () => { calls.push('finish'); return new FormData(); }, cancel: async () => { calls.push('cleanup'); },
    }; },
    transcribe: async (token, form, language, signal, progress) => {
      assert.equal(token, account.token); assert.equal(form instanceof FormData, true); assert.equal(signal.aborted, false);
      calls.push('transcribe:' + language); progress(50, false); progress(100, true); return result;
    },
    changed: value => { snapshot = value; phases.push(value.phase); }, ...overrides,
  };
  const session = new TranscriptionSession(deps);
  return { session, calls, phases, get snapshot() { return snapshot; }, interrupt: () => interrupted() };
}

test('incoming-only session records, finalises compression, uploads and displays the actual transcript', async () => {
  const f = fixture(); await f.session.start('pcm-NG');
  assert.equal(f.snapshot.phase, 'recording'); assert.equal(f.calls.includes('transcribe:pcm-NG'), false);
  await f.session.finish();
  assert.equal(f.snapshot.phase, 'idle'); assert.equal(f.snapshot.transcript.text, 'How you dey?');
  assert.equal(f.snapshot.recording.audioBytes, 2000);
  for (const phase of ['preparing', 'recording', 'compressing', 'uploading', 'processing']) assert.ok(f.phases.includes(phase));
  assert.deepEqual(f.calls, ['microphone', 'finish', 'transcribe:pcm-NG', 'cleanup']);
  await f.session.start(); assert.equal(f.snapshot.transcript, null); await f.session.cancel();
});

test('permission denial and failed compression produce clear errors without uploading', async () => {
  for (const stage of ['start', 'finish']) {
    const f = fixture({ recording: () => ({ start: async () => { if (stage === 'start') throw new Error('Microphone permission denied'); }, finish: async () => { throw new Error('Compression failed'); }, cancel: async () => {} }) });
    await f.session.start(); if (stage === 'finish') await f.session.finish();
    assert.equal(f.snapshot.phase, 'idle'); assert.match(f.snapshot.error, /denied|Compression failed/); assert.equal(f.calls.some(call => call.startsWith('transcribe')), false);
  }
});

test('unauthenticated sessions never open a microphone', async () => {
  const f = fixture({ readSession: async () => null }); await f.session.start();
  assert.match(f.snapshot.error, /Sign in/); assert.equal(f.calls.includes('microphone'), false);
});

test('cancellation while permission is pending fences the late result', async () => {
  const pending = deferred();
  const f = fixture({ readSession: () => pending.promise });
  const starting = f.session.start(); await f.session.cancel(); pending.resolve(account); await starting;
  assert.equal(f.snapshot.phase, 'idle'); assert.equal(f.calls.includes('microphone'), false);
});

test('microphone interruption cancels the segment without uploading', async () => {
  const f = fixture(); await f.session.start(); f.interrupt(); await f.session.cancel();
  assert.equal(f.snapshot.phase, 'idle'); assert.equal(f.calls.some(call => call.startsWith('transcribe')), false);
});

test('cancellation aborts the active upload and never displays a stale transcript', async () => {
  const pending = deferred(); let signal;
  const f = fixture({ transcribe: (...args) => { signal = args[3]; return pending.promise; } });
  await f.session.start(); const finishing = f.session.finish(); await new Promise(setImmediate);
  await f.session.cancel(null, true); assert.equal(signal.aborted, true); pending.resolve(result); await finishing;
  assert.equal(f.snapshot.transcript, null); assert.equal(f.snapshot.phase, 'idle');
});

test('account changes discard earlier private results and permit a fresh turn', async () => {
  const pending = deferred(); let selected = account;
  const f = fixture({ readSession: async () => selected, transcribe: () => pending.promise });
  await f.session.start(); const finishing = f.session.finish(); await new Promise(setImmediate);
  selected = { token: 'other-token', user: { id: 'account-b' } }; pending.resolve(result); await finishing;
  assert.equal(f.snapshot.transcript, null); assert.match(f.snapshot.error, /account changed/);
  await f.session.start(); assert.equal(f.snapshot.phase, 'recording'); await f.session.cancel();
});

test('a result belonging to another account cannot be displayed', async () => {
  const f = fixture({ transcribe: async () => ({ ...result, user_id: 'account-b' }) });
  await f.session.start(); await f.session.finish(); assert.equal(f.snapshot.transcript, null); assert.match(f.snapshot.error, /discarded/);
});

test('an old completion cannot overwrite a newer recording', async () => {
  const pending = deferred();
  const f = fixture({ transcribe: () => pending.promise });
  await f.session.start(); const old = f.session.finish(); await new Promise(setImmediate);
  await f.session.cancel(null, true); await f.session.start(); pending.resolve(result); await old;
  assert.equal(f.snapshot.phase, 'recording'); assert.equal(f.snapshot.transcript, null); await f.session.cancel();
});

test('server errors are shown and capture is cleaned up', async () => {
  const f = fixture({ transcribe: async () => { throw new Error('The recording is damaged. Please record again.'); } });
  await f.session.start(); await f.session.finish(); assert.match(f.snapshot.error, /damaged/); assert.equal(f.snapshot.transcript, null); assert.ok(f.calls.includes('cleanup'));
});

const api = loadTS('src/lib/api.ts', { '@/lib/config': { API_URL: 'https://padi.test' } });
const valid = { ...result, language: 'en', language_probability: .9, language_detected: true, model: 'base', duration_seconds: 1, audio_bytes: 2000, decoded_pcm_bytes: 32000, codec: 'opus', container: 'webm', sample_rate: 16000, channels: 1, decode_ms: 2, prepare_ms: 3, transcription_ms: 10, processing_ms: 15, service_ms: 20 };
function xhrFixture() {
  const old = global.XMLHttpRequest, requests = [];
  global.XMLHttpRequest = class {
    constructor() { this.upload = {}; this.headers = {}; requests.push(this); }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(key, value) { this.headers[key] = value; }
    send(body) { this.body = body; }
    abort() { this.aborted = true; this.onabort?.(); }
    respond(value, status = 200) { this.status = status; this.responseText = typeof value === 'string' ? value : JSON.stringify(value); this.onload?.(); }
  };
  return { requests, close: () => { global.XMLHttpRequest = old; } };
}

test('XHR uploads the compressed FormData with authentication and measures real progress', async () => {
  const f = xhrFixture();
  try {
    const form = new FormData(); form.append('audio', new Blob([new Uint8Array(2000)], { type: 'audio/webm;codecs=opus' }), 'recording.webm');
    const progress = []; const promise = api.transcribeRecording('token', form, 'auto', new AbortController().signal, (...args) => progress.push(args));
    const xhr = f.requests[0]; assert.equal(xhr.method, 'POST'); assert.equal(xhr.body, form); assert.equal(xhr.headers.Authorization, 'Bearer token'); assert.equal(xhr.headers['Content-Type'], undefined);
    xhr.upload.onprogress({ lengthComputable: true, loaded: 1024, total: 2048 }); xhr.upload.onload(); xhr.respond(valid);
    assert.equal((await promise).text, result.text); assert.deepEqual(progress, [[50, false], [100, true]]);
    assert.equal(xhr.onload, null); assert.equal(xhr.upload.onprogress, null);
  } finally { f.close(); }
});

test('XHR cancellation aborts transport and ignores late progress and responses', async () => {
  const f = xhrFixture();
  try {
    const controller = new AbortController(); const progress = [];
    const pending = api.transcribeRecording('token', new FormData(), 'en', controller.signal, (...args) => progress.push(args));
    const xhr = f.requests[0], late = xhr.upload.onprogress;
    controller.abort(); await assert.rejects(pending, { name: 'AbortError' }); late({ lengthComputable: true, loaded: 1, total: 1 }); xhr.respond(valid);
    assert.equal(xhr.aborted, true); assert.deepEqual(progress, []);
  } finally { f.close(); }
});

test('XHR rejects malformed speech metadata, account responses and unsafe service messages', async () => {
  for (const body of [{ ...valid, audio_bytes: -1 }, { ...valid, duration_seconds: 70 }, { ...valid, decoded_pcm_bytes: 32001 }, { ...valid, sample_rate: 48000 }, { ...valid, text: '' }, 'private secret provider response']) {
    const f = xhrFixture();
    try {
      const pending = api.transcribeRecording('token', new FormData(), 'auto', new AbortController().signal, () => {}); f.requests[0].respond(body);
      await assert.rejects(pending, error => !error.message.includes('private secret'));
    } finally { f.close(); }
  }
});

test('XHR reports authenticated server failures, network errors and timeouts', async () => {
  for (const kind of ['auth', 'network', 'timeout']) {
    const f = xhrFixture();
    try {
      const pending = api.transcribeRecording('token', new FormData(), 'auto', new AbortController().signal, () => {}); const xhr = f.requests[0];
      if (kind === 'auth') xhr.respond({ error: 'unauthenticated', message: 'Sign in to use voice.' }, 401);
      else if (kind === 'network') xhr.onerror(); else xhr.ontimeout();
      await assert.rejects(pending, /Sign in|could not upload|timed out/);
    } finally { f.close(); }
  }
});
