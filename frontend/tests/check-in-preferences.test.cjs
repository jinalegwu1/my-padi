const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTS } = require('./helpers/load-ts.cjs');
const api = loadTS('src/lib/api.ts', { '@/lib/config': { API_URL: 'https://padi.test' } });

const preferences = {
  morning_enabled: true,
  morning_time: '09:00',
  afternoon_enabled: false,
  afternoon_time: '13:00',
  evening_enabled: false,
  evening_time: '19:00',
  timezone: 'Africa/Lagos',
  quiet_hours_enabled: true,
  quiet_hours_start: '22:00',
  quiet_hours_end: '08:00',
};

test('check-in preferences use the authenticated server-backed settings API', async () => {
  const requests = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    requests.push({ url, ...options });
    return { ok: true, status: 200, text: async () => JSON.stringify(preferences) };
  };
  try {
    assert.deepEqual(await api.fetchCheckInPreferences('account-token'), preferences);
    assert.equal(requests[0].method, 'GET');
    assert.equal(requests[0].headers.Authorization, 'Bearer account-token');
    assert.deepEqual(await api.updateCheckInPreferences('account-token', { morning_enabled: true }), preferences);
    assert.equal(requests[1].method, 'PATCH');
    assert.deepEqual(JSON.parse(requests[1].body), { morning_enabled: true });
  } finally {
    global.fetch = originalFetch;
  }
});

test('invalid check-in times and timezone data are rejected', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ ...preferences, evening_time: '24:00' }),
  });
  try {
    await assert.rejects(api.fetchCheckInPreferences('account-token'), /invalid check-in preferences/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('push device registration and removal use the authenticated backend', async () => {
  const requests = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    requests.push({ url, ...options });
    return { ok: true, status: 204, text: async () => '' };
  };
  try {
    const registration = {
      device_id: 'padi_device_install_123',
      expo_push_token: 'ExpoPushToken[push_test_123]',
      platform: 'android',
      language: 'pcm-NG',
    };
    await api.registerPushDevice('account-token', registration);
    await api.unregisterPushDevice('account-token', registration.device_id);
    assert.equal(requests[0].url, 'https://padi.test/v1/push/devices');
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].headers.Authorization, 'Bearer account-token');
    assert.deepEqual(JSON.parse(requests[0].body), registration);
    assert.equal(requests[1].method, 'DELETE');
    assert.equal(requests[1].headers.Authorization, 'Bearer account-token');
    assert.deepEqual(JSON.parse(requests[1].body), { device_id: registration.device_id });
  } finally {
    global.fetch = originalFetch;
  }
});
