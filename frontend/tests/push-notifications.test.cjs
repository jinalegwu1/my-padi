const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTS } = require('./helpers/load-ts.cjs');

const activePreferences = {
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

function fixture(overrides = {}) {
  const state = {
    permission: { granted: true },
    expoToken: 'ExpoPushToken[push_test_123]',
    secure: new Map(),
    registrations: [],
    unregistrations: [],
    clearCalls: 0,
    localCalls: 0,
    requestPermissionCalls: 0,
    expoTokenCalls: [],
    channelCalls: 0,
    ...overrides,
  };
  const notifications = {
    AndroidImportance: { DEFAULT: 3 },
    getPermissionsAsync: async () => state.permission,
    getExpoPushTokenAsync: async options => {
      state.expoTokenCalls.push(options);
      return { data: state.expoToken };
    },
    setNotificationChannelAsync: async () => { state.channelCalls++; },
  };
  const exported = loadTS('src/lib/push-notifications.ts', {
    'expo-constants': {
      __esModule: true,
      default: { expoConfig: { extra: { eas: { projectId: 'eas-project-test' } } } },
    },
    'expo-notifications': notifications,
    'expo-secure-store': {
      getItemAsync: async key => state.secure.get(key) ?? null,
      setItemAsync: async (key, value) => state.secure.set(key, value),
    },
    'react-native': { Platform: { OS: 'ios' } },
    '@/lib/api': {
      registerPushDevice: async (token, registration) => {
        state.registrations.push({ token, registration });
      },
      unregisterPushDevice: async (token, deviceID) => {
        state.unregistrations.push({ token, deviceID });
      },
    },
    '@/lib/check-in-notifications': {
      clearCheckInNotifications: async () => { state.clearCalls++; },
      isCheckInDuringQuietHours: () => false,
      requestCheckInNotificationPermission: async () => {
        state.requestPermissionCalls++;
        state.permission = { granted: true };
      },
      syncCheckInNotifications: async () => {
        state.localCalls++;
        return { scheduled: 1, quietHoursSkipped: 0 };
      },
    },
    '@/types': {},
  });
  return { state, ...exported };
}

test('push registration obtains a project-scoped token and persists an installation ID', async () => {
  const f = fixture();
  const registered = await f.registerCurrentPushDevice('session-token', 'pcm-NG', true);
  assert.equal(registered, true);
  assert.equal(f.state.requestPermissionCalls, 1);
  assert.deepEqual(f.state.expoTokenCalls, [{ projectId: 'eas-project-test' }]);
  assert.equal(f.state.registrations.length, 1);
  assert.equal(f.state.registrations[0].token, 'session-token');
  assert.equal(f.state.registrations[0].registration.expo_push_token, f.state.expoToken);
  assert.equal(f.state.registrations[0].registration.platform, 'ios');
  assert.equal(f.state.registrations[0].registration.language, 'pcm-NG');
  assert.match(f.state.registrations[0].registration.device_id, /^padi_/);
  assert.equal(f.state.secure.size, 1);
});

test('successful remote setup clears local schedules instead of duplicating check-ins', async () => {
  const f = fixture();
  const result = await f.syncCheckInDelivery('session-token', activePreferences, 'en-NG');
  assert.equal(result.pushEnabled, true);
  assert.equal(result.scheduled, 0);
  assert.equal(f.state.clearCalls, 1);
  assert.equal(f.state.localCalls, 0);
});

test('failed remote registration retains local notification fallback and reports it', async () => {
  const f = fixture();
  const api = loadTS('src/lib/push-notifications.ts', {
    'expo-constants': {
      __esModule: true,
      default: { expoConfig: { extra: { eas: { projectId: 'eas-project-test' } } } },
    },
    'expo-notifications': {
      AndroidImportance: { DEFAULT: 3 },
      getPermissionsAsync: async () => ({ granted: true }),
      getExpoPushTokenAsync: async () => ({ data: f.state.expoToken }),
    },
    'expo-secure-store': {
      getItemAsync: async key => f.state.secure.get(key) ?? null,
      setItemAsync: async (key, value) => f.state.secure.set(key, value),
    },
    'react-native': { Platform: { OS: 'ios' } },
    '@/lib/api': {
      registerPushDevice: async () => { throw new Error('backend unavailable'); },
      unregisterPushDevice: async () => undefined,
    },
    '@/lib/check-in-notifications': {
      clearCheckInNotifications: async () => { f.state.clearCalls++; },
      isCheckInDuringQuietHours: () => false,
      requestCheckInNotificationPermission: async () => undefined,
      syncCheckInNotifications: async () => {
        f.state.localCalls++;
        return { scheduled: 1, quietHoursSkipped: 0 };
      },
    },
    '@/types': {},
  });
  const result = await api.syncCheckInDelivery('session-token', activePreferences, 'en-NG');
  assert.equal(result.pushEnabled, false);
  assert.equal(result.scheduled, 1);
  assert.match(result.warning, /using local check-in notifications/);
  assert.equal(f.state.localCalls, 1);
});

test('turning every check-in off unregisters the device and clears local schedules', async () => {
  const f = fixture();
  f.state.secure.set('padi.push.device-id.v1', 'padi_device_install_123');
  const result = await f.syncCheckInDelivery('session-token', { ...activePreferences, morning_enabled: false }, 'en-NG');
  assert.equal(result.pushEnabled, false);
  assert.deepEqual(f.state.unregistrations, [{
    token: 'session-token',
    deviceID: 'padi_device_install_123',
  }]);
  assert.equal(f.state.clearCalls, 1);
});
