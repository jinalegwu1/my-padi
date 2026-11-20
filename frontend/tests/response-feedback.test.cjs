const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTS } = require('./helpers/load-ts.cjs');
const api = loadTS('src/lib/api.ts', { '@/lib/config': { API_URL: 'https://padi.test' } });

test('response feedback sends only the authenticated message id and rating', async () => {
  let request;
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    request = { url, ...options };
    return { ok: true, status: 204, text: async () => '' };
  };
  try {
    await api.submitResponseFeedback('account-token', 'padi_ab12_2', 'unwanted_humour');
    assert.equal(request.url, 'https://padi.test/v1/personality/feedback');
    assert.equal(request.headers.Authorization, 'Bearer account-token');
    assert.deepEqual(JSON.parse(request.body), { message_id: 'padi_ab12_2', rating: 'unwanted_humour' });
  } finally {
    global.fetch = originalFetch;
  }
});
