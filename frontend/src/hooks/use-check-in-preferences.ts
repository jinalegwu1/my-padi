import { useCallback, useEffect, useState } from 'react';

import { fetchCheckInPreferences, updateCheckInPreferences } from '@/lib/api';
import { clearCheckInNotifications, requestCheckInNotificationPermission } from '@/lib/check-in-notifications';
import { syncCheckInDelivery } from '@/lib/push-notifications';
import { readSession, subscribeSession } from '@/lib/session';
import type { CheckInPreferences, CheckInPreferencesPatch } from '@/types';

type Status = 'loading' | 'ready' | 'signed_out' | 'error';

function deviceTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function hasActiveSchedule(preferences: CheckInPreferences): boolean {
  return preferences.morning_enabled || preferences.afternoon_enabled || preferences.evening_enabled;
}

/** Keeps account settings and this device's check-in delivery in sync. */
export function useCheckInPreferences(language: string) {
  const [preferences, setPreferences] = useState<CheckInPreferences | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quietHoursWarning, setQuietHoursWarning] = useState<string | null>(null);
  const [deliveryWarning, setDeliveryWarning] = useState<string | null>(null);

  const load = useCallback(async (active: () => boolean) => {
    setStatus('loading');
    setPreferences(null);
    setError(null);
    setQuietHoursWarning(null);
    setDeliveryWarning(null);
    try {
      const session = await readSession();
      if (!active()) return;
      if (!session) {
        await clearCheckInNotifications();
        setStatus('signed_out');
        return;
      }
      let result = await fetchCheckInPreferences(session.token);
      const timezone = deviceTimezone();
      if (result.timezone !== timezone) {
        result = await updateCheckInPreferences(session.token, { timezone });
      }
      const current = await readSession();
      if (!active() || current?.token !== session.token) return;
      setPreferences(result);
      setStatus('ready');
      try {
        const summary = await syncCheckInDelivery(session.token, result, language);
        if (summary.quietHoursSkipped > 0) {
          setQuietHoursWarning('Your enabled check-in time falls within quiet hours, so no notification is scheduled for it.');
        }
        setDeliveryWarning(summary.warning);
      } catch (reason) {
        if (active()) setError(reason instanceof Error ? reason.message : 'Check-in notifications could not be scheduled.');
      }
    } catch (reason) {
      if (!active()) return;
      setError(reason instanceof Error ? reason.message : 'Check-in preferences could not load.');
      setStatus('error');
    }
  }, [language]);

  useEffect(() => {
    let active = true;
    const refresh = () => { void load(() => active); };
    refresh();
    const unsubscribe = subscribeSession(refresh);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [load]);

  const update = useCallback(async (patch: CheckInPreferencesPatch): Promise<boolean> => {
    setSaving(true);
    setError(null);
    setQuietHoursWarning(null);
    setDeliveryWarning(null);
    try {
      const session = await readSession();
      if (!session || status !== 'ready' || !preferences) {
        throw new Error('Sign in to manage PADI check-ins.');
      }
      const next = { ...preferences, ...patch };
      next.timezone = deviceTimezone();
      if (hasActiveSchedule(next) && !hasActiveSchedule(preferences)) {
        await requestCheckInNotificationPermission();
      } else if (hasActiveSchedule(next) && Object.values(patch).some((value) => value === true)) {
        await requestCheckInNotificationPermission();
      }
      const result = await updateCheckInPreferences(session.token, { ...patch, timezone: next.timezone });
      const current = await readSession();
      if (current?.token !== session.token) return false;
      setPreferences(result);
      const summary = await syncCheckInDelivery(session.token, result, language);
      if (summary.quietHoursSkipped > 0) {
        setQuietHoursWarning('Your enabled check-in time falls within quiet hours, so no notification is scheduled for it.');
      }
      setDeliveryWarning(summary.warning);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Check-in preferences could not be saved.');
      return false;
    } finally {
      setSaving(false);
    }
  }, [language, preferences, status]);

  return { preferences, status, saving, error, quietHoursWarning, deliveryWarning, update };
}
