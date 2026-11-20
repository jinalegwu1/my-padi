const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTS } = require('./helpers/load-ts.cjs');
const api = loadTS('src/lib/api.ts', { '@/lib/config': { API_URL: 'https://padi.test' } });

const preferences = {
  humour: 'subtle',
  humour_explicit: true,
  tone: 'gentle',
  learn_from_feedback: false,
};

test('personality preferences load and update through the authenticated account API', async () => {
  const requests = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    requests.push({ url, ...options });
    return { ok: true, status: 200, text: async () => JSON.stringify(preferences) };
  };
  try {
    assert.deepEqual(await api.fetchPersonalityPreferences('account-token'), preferences);
    assert.equal(requests[0].method, 'GET');
    assert.equal(requests[0].headers.Authorization, 'Bearer account-token');
    assert.deepEqual(await api.updatePersonalityPreferences('account-token', { tone: 'gentle' }), preferences);
    assert.equal(requests[1].method, 'PATCH');
    assert.deepEqual(JSON.parse(requests[1].body), { tone: 'gentle' });
  } finally {
    global.fetch = originalFetch;
  }
});

test('invalid personality preferences fail instead of appearing saved', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ ...preferences, humour: 'always' }),
  });
  try {
    await assert.rejects(api.fetchPersonalityPreferences('account-token'), /invalid conversation preferences/);
  } finally {
    global.fetch = originalFetch;
  }
});
