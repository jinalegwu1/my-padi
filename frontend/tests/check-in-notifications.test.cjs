const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTS } = require('./helpers/load-ts.cjs');

const state = {
  platform: 'ios',
  scheduled: [],
  cancelled: [],
  requests: [],
  permission: { granted: true },
};

const notifications = {
  SchedulableTriggerInputTypes: { DAILY: 'daily' },
  AndroidImportance: { DEFAULT: 3 },
  getAllScheduledNotificationsAsync: async () => state.scheduled,
  cancelScheduledNotificationAsync: async (id) => {
    state.cancelled.push(id);
    state.scheduled = state.scheduled.filter(item => item.identifier !== id);
  },
  scheduleNotificationAsync: async (request) => {
    state.requests.push(request);
    const identifier = `created-${state.requests.length}`;
    state.scheduled.push({
      identifier,
      content: request.content,
      trigger: request.trigger,
    });
    return identifier;
  },
  setNotificationChannelAsync: async () => undefined,
  getPermissionsAsync: async () => state.permission,
  requestPermissionsAsync: async () => state.permission,
};

const api = loadTS('src/lib/check-in-notifications.ts', {
  'expo-notifications': notifications,
  'react-native': { Platform: { get OS() { return state.platform; } } },
});

function defaults(overrides = {}) {
  return {
    morning_enabled: false,
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
  };
}

test('quiet hours handle overnight ranges and exclude their end boundary', () => {
  const preferences = defaults();
  assert.equal(api.isCheckInDuringQuietHours('22:00', preferences), true);
  assert.equal(api.isCheckInDuringQuietHours('07:59', preferences), true);
  assert.equal(api.isCheckInDuringQuietHours('08:00', preferences), false);
  assert.equal(api.isCheckInDuringQuietHours('13:00', preferences), false);
  const daytimeQuietHours = defaults({
    quiet_hours_start: '12:00',
    quiet_hours_end: '14:00',
  });
  assert.equal(api.isCheckInDuringQuietHours('11:59', daytimeQuietHours), false);
  assert.equal(api.isCheckInDuringQuietHours('12:00', daytimeQuietHours), true);
  assert.equal(api.isCheckInDuringQuietHours('13:00', daytimeQuietHours), true);
  assert.equal(api.isCheckInDuringQuietHours('14:00', daytimeQuietHours), false);
  assert.equal(api.isCheckInDuringQuietHours('23:00', daytimeQuietHours), false);
});

test('daily notifications replace only PADI check-ins and skip quiet-hour slots', async () => {
  state.platform = 'ios';
  state.requests = [];
  state.cancelled = [];
  state.scheduled = [
    { identifier: 'old-check-in', content: { data: { kind: 'padi_check_in' } } },
    { identifier: 'other-reminder', content: { data: { kind: 'reminder' } } },
  ];
  state.permission = { granted: true };
  const result = await api.syncCheckInNotifications(defaults({
    morning_enabled: true,
    morning_time: '07:30',
    afternoon_enabled: true,
    evening_enabled: true,
    evening_time: '22:00',
  }), 'en-NG');
  assert.deepEqual(state.cancelled, ['old-check-in']);
  assert.equal(state.requests.length, 1);
  assert.equal(state.requests[0].trigger.type, 'daily');
  assert.equal(state.requests[0].trigger.hour, 13);
  assert.equal(state.requests[0].content.data.slot, 'afternoon');
  assert.equal(result.scheduled, 1);
  assert.equal(result.quietHoursSkipped, 2);
});

test('repeated sync replaces PADI schedules without duplicating them or touching reminders', async () => {
  state.platform = 'ios';
  state.requests = [];
  state.cancelled = [];
  state.scheduled = [
    { identifier: 'old-check-in', content: { data: { kind: 'padi_check_in' } } },
    { identifier: 'other-reminder', content: { data: { kind: 'reminder' } } },
  ];
  state.permission = { granted: true };
  const preferences = defaults({ morning_enabled: true, morning_time: '09:00' });

  await api.syncCheckInNotifications(preferences, 'en-NG');
  await api.syncCheckInNotifications(preferences, 'en-NG');

  const checkIns = state.scheduled.filter(item => item.content.data.kind === 'padi_check_in');
  assert.equal(state.requests.length, 2);
  assert.equal(checkIns.length, 1);
  assert.equal(checkIns[0].identifier, 'created-2');
  assert.deepEqual(state.cancelled, ['old-check-in', 'created-1']);
  assert.deepEqual(state.scheduled.filter(item => item.identifier === 'other-reminder').map(item => item.identifier), ['other-reminder']);
});

test('notification permission denial is surfaced before check-ins are enabled', async () => {
  state.platform = 'ios';
  state.requests = [];
  state.cancelled = [];
  state.scheduled = [
    { identifier: 'existing-check-in', content: { data: { kind: 'padi_check_in' } } },
  ];
  state.permission = { granted: false };
  await assert.rejects(
    api.requestCheckInNotificationPermission(),
    /Allow notifications in your device settings/,
  );
  await assert.rejects(
    api.syncCheckInNotifications(defaults({ morning_enabled: true }), 'en-NG'),
    /Allow notifications in your device settings/,
  );
  assert.deepEqual(state.cancelled, []);
  assert.equal(state.requests.length, 0);
  assert.equal(state.scheduled.length, 1);
  state.permission = { granted: true };
});

test('web preview does not report local notifications as available', async () => {
  state.platform = 'web';
  await assert.rejects(
    api.requestCheckInNotificationPermission(),
    /available in the mobile app/,
  );
  state.platform = 'ios';
});
