import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';

import { fetchCheckInPreferences, updateCheckInPreferences } from '@/lib/api';
import { clearCheckInNotifications } from '@/lib/check-in-notifications';
import { syncCheckInDelivery, unregisterCurrentPushDevice } from '@/lib/push-notifications';
import { readSession, subscribeSession, type AppSession } from '@/lib/session';

/** Keeps the Expo device registration aligned with the signed-in account. */
export function usePushDeviceLifecycle(language: string): void {
  const previousSession = useRef<AppSession | null>(null);

  useEffect(() => {
    let active = true;
    let queued = Promise.resolve();
    const synchronize = async () => {
      const current = await readSession();
      const previous = previousSession.current;
      if (previous && previous.token !== current?.token) {
        await unregisterCurrentPushDevice(previous.token);
        await clearCheckInNotifications();
      }
      previousSession.current = current;
      if (!current) {
        await clearCheckInNotifications();
        return;
      }
      let preferences = await fetchCheckInPreferences(current.token);
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      if (preferences.timezone !== timezone) {
        preferences = await updateCheckInPreferences(current.token, { timezone });
      }
      const latest = await readSession();
      if (!active || latest?.token !== current.token) return;
      const result = await syncCheckInDelivery(current.token, preferences, language);
      if (result.warning) console.warn('PADI push registration needs attention.');
    };
    const refresh = () => {
      queued = queued.then(synchronize).catch(() => {
        if (active) console.warn('PADI push registration could not be synchronized.');
      });
    };
    const unsubscribe = subscribeSession(refresh);
    const appStateListener = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    const tokenListener = Platform.OS === 'web'
      ? null
      : Notifications.addPushTokenListener(refresh);
    refresh();
    return () => {
      active = false;
      unsubscribe();
      appStateListener.remove();
      tokenListener?.remove();
    };
  }, [language]);
}
