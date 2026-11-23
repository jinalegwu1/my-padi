const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { create, act } = require('react-test-renderer');
const { loadTS } = require('./helpers/load-ts.cjs');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

test('push lifecycle registers active account schedules and unregisters on sign-out', async () => {
  const originalDateTimeFormat = Intl.DateTimeFormat;
  Intl.DateTimeFormat = function DateTimeFormat() {
    return { resolvedOptions: () => ({ timeZone: 'Pacific/Auckland' }) };
  };
  let session = { token: 'token-a', user: { id: 'a', full_name: 'Ada' } };
  const sessionListeners = new Set();
  const registrations = [];
  const removals = [];
  const updates = [];
  const appListeners = new Set();
  let tokenListener;
  const notifications = {
    addPushTokenListener: listener => {
      tokenListener = listener;
      return { remove: () => { tokenListener = null; } };
    },
  };
  const exported = loadTS('src/hooks/use-push-device-lifecycle.ts', {
    'expo-notifications': notifications,
    'react-native': {
      Platform: { OS: 'ios' },
      AppState: {
        addEventListener: (_event, listener) => {
          appListeners.add(listener);
          return { remove: () => appListeners.delete(listener) };
        },
      },
    },
    '@/lib/api': {
      fetchCheckInPreferences: async () => preferences,
      updateCheckInPreferences: async (_token, patch) => {
        updates.push(patch);
        return { ...preferences, ...patch };
      },
    },
    '@/lib/check-in-notifications': {
      clearCheckInNotifications: async () => undefined,
    },
    '@/lib/push-notifications': {
      syncCheckInDelivery: async (token, currentPreferences, language) => {
        registrations.push({ token, currentPreferences, language });
        return { scheduled: 0, quietHoursSkipped: 0, pushEnabled: true, warning: null };
      },
      unregisterCurrentPushDevice: async token => { removals.push(token); },
    },
    '@/lib/session': {
      readSession: async () => session,
      subscribeSession: listener => {
        sessionListeners.add(listener);
        return () => sessionListeners.delete(listener);
      },
    },
  });
  let root;
  function Probe() {
    exported.usePushDeviceLifecycle('en-NG');
    return null;
  }
  try {
    await act(async () => {
      root = create(React.createElement(Probe));
      await new Promise(resolve => setImmediate(resolve));
    });
    // This effect queues an async operation without a React state update.
    // Flush that queue after the initial effect has actually mounted.
    await act(async () => { await new Promise(resolve => setImmediate(resolve)); });
    assert.equal(registrations.length, 1);
    assert.equal(registrations[0].token, 'token-a');
    assert.equal(registrations[0].language, 'en-NG');
    assert.equal(registrations[0].currentPreferences.morning_enabled, true);
    assert.equal(updates.length, 1);
    assert.ok(tokenListener);
    assert.equal(appListeners.size, 1);

    await act(async () => {
      session = null;
      sessionListeners.forEach(listener => listener());
      await new Promise(resolve => setImmediate(resolve));
    });
    assert.deepEqual(removals, ['token-a']);
    assert.equal(registrations.length, 1);
  } finally {
    if (root) await act(async () => root.unmount());
    Intl.DateTimeFormat = originalDateTimeFormat;
  }
});
