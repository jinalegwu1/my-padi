const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTS } = require('./helpers/load-ts.cjs');
const api = loadTS('src/lib/api.ts', { '@/lib/config': { API_URL: 'https://padi.test' } });
const payload = { enabled: true, revision: 2, items: [{ id: 'mem_a', category: 'name', label: 'Name', value: 'Ada',
  paused: false, source: 'Saved by you', created_at: '2026-11-18T00:00:00Z' }] };

test('account memory requests use bearer credentials and normalise server dates', async () => {
  let request;
  const oldFetch = global.fetch;
  global.fetch = async (url, options) => { request = { url, ...options }; return { ok: true, status: 200, text: async () => JSON.stringify(payload) }; };
  try {
    const result = await api.fetchMemory('test-token');
    assert.equal(request.method, 'GET');
    assert.equal(request.headers.Authorization, 'Bearer test-token');
    assert.equal(result.items[0].createdAt, Date.parse(payload.items[0].created_at));
    await api.updateMemory('test-token', 'mem/other?', { paused: true });
    assert.equal(request.url, 'https://padi.test/v1/memory/mem%2Fother%3F');
    assert.equal(request.method, 'PATCH');
    assert.deepEqual(JSON.parse(request.body), { paused: true });
  } finally { global.fetch = oldFetch; }
});

test('invalid memory responses fail instead of appearing saved or consented', async () => {
  const oldFetch = global.fetch;
  try {
    for (const invalid of [{ ...payload, enabled: 'yes' }, { ...payload, revision: -1 },
      { ...payload, items: [{ ...payload.items[0], created_at: 'invalid' }] },
      { ...payload, items: [{ ...payload.items[0], value: '' }] },
      { ...payload, items: Array.from({ length: 101 }, () => payload.items[0]) }]) {
      global.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify(invalid) });
      await assert.rejects(api.fetchMemory('test-token'), /invalid memory/);
    }
  } finally { global.fetch = oldFetch; }
});
