import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';

import { usePersistentState } from '@/hooks/use-persistent-state';
import type { Preferences } from '@/types';

export const DEFAULT_PREFERENCES: Preferences = {
  onboarded: false,
  countryCode: null,
  languageCode: 'en-NG',
  displayName: '',
  appearance: 'system',
  textScale: 1,
  reduceMotion: false,
  highContrast: false,
  voiceId: 'ada',
  voiceRate: 1,
  memoryEnabled: true,
  notificationsEnabled: true,
  dailyCheckIn: true,
  checkInTime: '08:00',
  showVoiceTranscript: true,
};

type PreferencesContextValue = {
  preferences: Preferences;
  status: 'loading' | 'ready' | 'error';
  update: (patch: Partial<Preferences>) => void;
  reset: () => void;
};

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

/**
 * App-wide preferences (onboarding answers, appearance, accessibility, voice).
 * Stored on the device only; no account or backend involved.
 */
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences, status] = usePersistentState<Preferences>(
    'preferences',
    DEFAULT_PREFERENCES,
  );

  const update = useCallback(
    (patch: Partial<Preferences>) => {
      setPreferences((prev) => ({ ...prev, ...patch }));
    },
    [setPreferences],
  );

  const reset = useCallback(() => {
    setPreferences(DEFAULT_PREFERENCES);
  }, [setPreferences]);

  const value = useMemo(
    () => ({ preferences, status, update, reset }),
    [preferences, status, update, reset],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) {
    throw new Error('usePreferences must be used inside <PreferencesProvider>');
  }
  return ctx;
}
