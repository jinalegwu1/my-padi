import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { registerPushDevice as registerPushDeviceAPI, unregisterPushDevice as unregisterPushDeviceAPI } from '@/lib/api';
import {
  clearCheckInNotifications,
  isCheckInDuringQuietHours,
  requestCheckInNotificationPermission,
  syncCheckInNotifications,
} from '@/lib/check-in-notifications';
import type { CheckInPreferences } from '@/types';

const DEVICE_ID_KEY = 'padi.push.device-id.v1';

function expoProjectID(): string {
  const configured = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  if (configured?.trim()) return configured.trim();
  const extra: unknown = Constants.expoConfig?.extra;
  if (extra && typeof extra === 'object' && 'eas' in extra) {
    const eas: unknown = extra.eas;
    if (eas && typeof eas === 'object' && 'projectId' in eas &&
        typeof eas.projectId === 'string' && eas.projectId.trim()) {
      return eas.projectId.trim();
    }
  }
  throw new Error('Expo push setup is incomplete. Configure EXPO_PUBLIC_EAS_PROJECT_ID for this app build.');
}

async function installationID(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (existing) return existing;
  const generated = `padi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
  await SecureStore.setItemAsync(DEVICE_ID_KEY, generated);
  return generated;
}

function hasActiveCheckIn(preferences: CheckInPreferences): boolean {
  return preferences.morning_enabled || preferences.afternoon_enabled || preferences.evening_enabled;
}

function quietHoursSkipped(preferences: CheckInPreferences): number {
  if (!preferences.quiet_hours_enabled) return 0;
  const enabled = [
    { enabled: preferences.morning_enabled, time: preferences.morning_time },
    { enabled: preferences.afternoon_enabled, time: preferences.afternoon_time },
    { enabled: preferences.evening_enabled, time: preferences.evening_time },
  ];
  return enabled.filter(({ enabled, time }) =>
    enabled && isCheckInDuringQuietHours(time, preferences),
  ).length;
}

export async function registerCurrentPushDevice(token: string, language: string, askPermission = false): Promise<boolean> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    throw new Error('Push notifications are available in the iOS and Android apps.');
  }
  if (askPermission) {
    await requestCheckInNotificationPermission();
  } else {
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) return false;
  }
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('padi-check-ins', {
      name: 'PADI check-ins',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const projectId = expoProjectID();
  const pushToken = await Notifications.getExpoPushTokenAsync({ projectId });
  const deviceID = await installationID();
  await registerPushDeviceAPI(token, {
    device_id: deviceID,
    expo_push_token: pushToken.data,
    platform: Platform.OS,
    language,
  });
  return true;
}

export async function unregisterCurrentPushDevice(token: string): Promise<void> {
  const deviceID = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (deviceID) await unregisterPushDeviceAPI(token, deviceID);
}

export async function syncCheckInDelivery(
  token: string,
  preferences: CheckInPreferences,
  language: string,
): Promise<{ scheduled: number; quietHoursSkipped: number; pushEnabled: boolean; warning: string | null }> {
  const task = deliverySync.then(() => syncCheckInDeliveryNow(token, preferences, language));
  deliverySync = task.then(() => undefined, () => undefined);
  return task;
}

let deliverySync: Promise<void> = Promise.resolve();

async function syncCheckInDeliveryNow(
  token: string,
  preferences: CheckInPreferences,
  language: string,
): Promise<{ scheduled: number; quietHoursSkipped: number; pushEnabled: boolean; warning: string | null }> {
  if (!hasActiveCheckIn(preferences)) {
    let warning: string | null = null;
    try {
      await unregisterCurrentPushDevice(token);
    } catch {
      warning = 'PADI could not confirm removal of this device from push delivery. Check your connection and try again.';
    }
    await clearCheckInNotifications();
    return { scheduled: 0, quietHoursSkipped: 0, pushEnabled: false, warning };
  }

  let pushError: unknown;
  let unregisterWarning: string | null = null;
  try {
    const registered = await registerCurrentPushDevice(token, language);
    if (registered) {
      await clearCheckInNotifications();
      return { scheduled: 0, quietHoursSkipped: quietHoursSkipped(preferences), pushEnabled: true, warning: null };
    }
    try {
      await unregisterCurrentPushDevice(token);
    } catch {
      unregisterWarning = 'PADI could not confirm that push delivery was disabled for this device.';
    }
  } catch (error) {
    pushError = error;
  }
  const local = await syncCheckInNotifications(preferences, language);
  return {
    ...local,
    pushEnabled: false,
    warning: pushError
      ? 'Remote push setup is unavailable; this device is using local check-in notifications.'
      : unregisterWarning,
  };
}
