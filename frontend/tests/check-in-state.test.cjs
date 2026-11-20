const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { create, act } = require('react-test-renderer');
const { loadTS } = require('./helpers/load-ts.cjs');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const defaults = (overrides = {}) => ({
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
  ...overrides,
});
const copy = value => JSON.parse(JSON.stringify(value));

function fixture(initialPreferences = defaults()) {
  const originalDateTimeFormat = Intl.DateTimeFormat;
  let deviceTimezone = 'Europe/London';
  Intl.DateTimeFormat = function DateTimeFormat() {
    return { resolvedOptions: () => ({ timeZone: deviceTimezone }) };
  };

  let session = { token: 'token-a', user: { id: 'a' } };
  const listeners = new Set();
  const preferencesByToken = { 'token-a': copy(initialPreferences) };
  const fetches = [];
  const updates = [];
  const syncs = [];
  let permissionGranted = true;
  let permissionRequests = 0;
  const api = {
    fetchCheckInPreferences: async token => {
      fetches.push(token);
      return copy(preferencesByToken[token]);
    },
    updateCheckInPreferences: async (token, patch) => {
      updates.push({ token, patch: copy(patch) });
      preferencesByToken[token] = { ...preferencesByToken[token], ...patch };
      return copy(preferencesByToken[token]);
    },
  };
  const notificationAPI = {
    clearCheckInNotifications: async () => undefined,
    syncCheckInNotifications: async preferences => {
      syncs.push(copy(preferences));
      return {
        scheduled: Number(preferences.morning_enabled) +
          Number(preferences.afternoon_enabled) + Number(preferences.evening_enabled),
        quietHoursSkipped: 0,
      };
    },
    requestCheckInNotificationPermission: async () => {
      permissionRequests++;
      if (!permissionGranted) throw new Error('Allow notifications in your device settings to schedule PADI check-ins.');
    },
  };
  const exported = loadTS('src/hooks/use-check-in-preferences.ts', {
    '@/lib/api': api,
    '@/lib/check-in-notifications': notificationAPI,
    '@/lib/session': {
      readSession: async () => session,
      subscribeSession: listener => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  });

  return {
    fetches,
    updates,
    syncs,
    preferencesByToken,
    get permissionRequests() { return permissionRequests; },
    setPermissionGranted(value) { permissionGranted = value; },
    setDeviceTimezone(value) { deviceTimezone = value; },
    async mount() {
      let state;
      function Probe() {
        state = exported.useCheckInPreferences('en-NG');
        return null;
      }
      let root;
      await act(async () => {
        root = create(React.createElement(Probe));
        await new Promise(resolve => setImmediate(resolve));
      });
      return {
        get state() { return state; },
        close: async () => act(async () => root.unmount()),
      };
    },
    restore() { Intl.DateTimeFormat = originalDateTimeFormat; },
  };
}

test('a fresh app session reloads persisted settings and resynchronizes for timezone changes', async () => {
  const f = fixture();
  try {
    const firstLaunch = await f.mount();
    assert.equal(firstLaunch.state.status, 'ready');
    assert.equal(firstLaunch.state.preferences.timezone, 'Europe/London');
    assert.equal(f.preferencesByToken['token-a'].morning_enabled, true);
    assert.equal(f.syncs.length, 1);
    assert.equal(f.syncs[0].morning_enabled, true);
    await firstLaunch.close();

    f.setDeviceTimezone('America/Toronto');
    const restarted = await f.mount();
    assert.equal(restarted.state.status, 'ready');
    assert.equal(restarted.state.preferences.timezone, 'America/Toronto');
    assert.equal(restarted.state.preferences.morning_enabled, true);
    assert.deepEqual(f.fetches, ['token-a', 'token-a']);
    assert.deepEqual(f.updates.map(item => item.patch.timezone), ['Europe/London', 'America/Toronto']);
    assert.equal(f.syncs.length, 2);
    assert.equal(f.syncs[1].timezone, 'America/Toronto');
    await restarted.close();
  } finally {
    f.restore();
  }
});

test('notification permission denial does not save an enabled check-in schedule', async () => {
  const f = fixture(defaults({ morning_enabled: false }));
  try {
    const mounted = await f.mount();
    const updatesBeforePermissionDenial = f.updates.length;
    f.setPermissionGranted(false);
    let saved;
    await act(async () => { saved = await mounted.state.update({ morning_enabled: true }); });
    assert.equal(saved, false);
    assert.equal(f.permissionRequests, 1);
    assert.equal(f.updates.length, updatesBeforePermissionDenial);
    assert.equal(f.syncs.length, 1);
    assert.equal(mounted.state.preferences.morning_enabled, false);
    assert.match(mounted.state.error, /Allow notifications/);
    await mounted.close();
  } finally {
    f.restore();
  }
});
