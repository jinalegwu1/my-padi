const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTS } = require('./helpers/load-ts.cjs');
const api = loadTS('src/lib/api.ts', { '@/lib/config': { API_URL: 'https://padi.test' } });

test('voice upload sends authenticated multipart without overriding the boundary', async () => {
  const previous = global.fetch;
  const form = new FormData();
  form.append('audio', new Blob(['RIFF0000WAVEdata']), 'recording.wav');
  global.fetch = async (url, request) => {
    assert.equal(url, 'https://padi.test/v1/voice/transcribe');
    assert.equal(request.body, form);
    assert.equal(request.headers.Authorization, 'Bearer test-token');
    assert.equal(request.headers['Content-Type'], undefined);
    return { ok: true, status: 200, text: async () => JSON.stringify({ text: ' Hello PADI ' }) };
  };
  try { assert.equal(await api.transcribeAudio('test-token', form, new AbortController().signal), 'Hello PADI'); }
  finally { global.fetch = previous; }
});

test('external cancellation aborts both transcription and chat requests', async () => {
  const previous = global.fetch;
  global.fetch = async (_url, request) => new Promise((_resolve, reject) => {
    const aborted = () => reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' }));
    request.signal.addEventListener('abort', aborted, { once: true });
    if (request.signal.aborted) aborted();
  });
  try {
    for (const send of [signal => api.transcribeAudio('token', new FormData(), signal),
      signal => api.sendChat('token', [{ role: 'user', content: 'Hello' }], 0, signal)]) {
      const controller = new AbortController();
      const request = send(controller.signal);
      controller.abort();
      await assert.rejects(request, { name: 'AbortError', message: 'Cancelled' });
    }
  } finally { global.fetch = previous; }
});
