import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { CheckInPreferences } from '@/types';

const CHANNEL_ID = 'padi-check-ins';
const NOTIFICATION_KIND = 'padi_check_in';

type CheckInSlot = {
  slot: 'morning' | 'afternoon' | 'evening';
  enabled: boolean;
  time: string;
};

function slots(preferences: CheckInPreferences): CheckInSlot[] {
  return [
    { slot: 'morning', enabled: preferences.morning_enabled, time: preferences.morning_time },
    { slot: 'afternoon', enabled: preferences.afternoon_enabled, time: preferences.afternoon_time },
    { slot: 'evening', enabled: preferences.evening_enabled, time: preferences.evening_time },
  ];
}

function minutesSinceMidnight(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

export function isCheckInDuringQuietHours(time: string, preferences: CheckInPreferences): boolean {
  if (!preferences.quiet_hours_enabled) return false;
  const candidate = minutesSinceMidnight(time);
  const start = minutesSinceMidnight(preferences.quiet_hours_start);
  const end = minutesSinceMidnight(preferences.quiet_hours_end);
  if (start === end) return true;
  return start < end
    ? candidate >= start && candidate < end
    : candidate >= start || candidate < end;
}

function notificationWords(language: string): { title: string; body: string } {
  if (language.toLowerCase().startsWith('fr')) {
    return { title: 'Un moment avec PADI', body: 'Si vous souhaitez parler, PADI est là pour vous écouter.' };
  }
  if (language.toLowerCase() === 'pcm-ng') {
    return { title: 'Small time with PADI', body: 'If e go help, PADI dey here to listen. No pressure.' };
  }
  return { title: 'A moment with PADI', body: 'If it would help to talk, PADI is here to listen. No pressure.' };
}

export async function clearCheckInNotifications(): Promise<void> {
  if (Platform.OS === 'web') return;
  const existing = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(existing
    .filter((item) => item.content.data?.kind === NOTIFICATION_KIND)
    .map((item) => Notifications.cancelScheduledNotificationAsync(item.identifier)));
}

export async function requestCheckInNotificationPermission(): Promise<void> {
  if (Platform.OS === 'web') {
    throw new Error('Scheduled check-in notifications are available in the mobile app, not the web preview.');
  }
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'PADI check-ins',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const existing = await Notifications.getPermissionsAsync();
  const permission = existing.granted ? existing : await Notifications.requestPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Allow notifications in your device settings to schedule PADI check-ins.');
  }
}

export async function syncCheckInNotifications(
  preferences: CheckInPreferences,
  language: string,
): Promise<{ scheduled: number; quietHoursSkipped: number }> {
  const enabled = slots(preferences).filter((item) => item.enabled);
  if (Platform.OS === 'web' && enabled.length === 0) {
    return { scheduled: 0, quietHoursSkipped: 0 };
  }
  if (enabled.length > 0) {
    if (Platform.OS === 'web') {
      throw new Error('Scheduled check-in notifications are available in the mobile app, not the web preview.');
    }
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) {
      throw new Error('Allow notifications in your device settings to schedule PADI check-ins.');
    }
  }
  await clearCheckInNotifications();
  const words = notificationWords(language);
  const eligible = enabled.filter((item) => !isCheckInDuringQuietHours(item.time, preferences));
  const created: string[] = [];
  try {
    for (const item of eligible) {
      const [hour, minute] = item.time.split(':').map(Number);
      const identifier = await Notifications.scheduleNotificationAsync({
        content: {
          title: words.title,
          body: words.body,
          data: { kind: NOTIFICATION_KIND, slot: item.slot },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour,
          minute,
          ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
        },
      });
      created.push(identifier);
    }
  } catch (error) {
    await Promise.all(created.map((identifier) => Notifications.cancelScheduledNotificationAsync(identifier)));
    throw error;
  }
  return { scheduled: created.length, quietHoursSkipped: enabled.length - eligible.length };
}
