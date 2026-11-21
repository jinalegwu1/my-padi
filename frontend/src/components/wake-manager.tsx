import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { usePathname } from 'expo-router';

import { usePreferences } from '@/hooks/use-preferences';
import { useVoiceSession } from '@/hooks/use-voice-session';
import { requestRecordingPermissionsAsync } from 'expo-audio';

export function WakeManager() {
  const { preferences } = usePreferences();
  const voice = useVoiceSession();
  const enabledRef = useRef(false);
  const pathname = usePathname();

  useEffect(() => {
    if (pathname === '/voice') {
      enabledRef.current = false;
      if (voice.connected) void voice.session.cancel();
      return;
    }
    if (!preferences.wakeWordEnabled) {
      enabledRef.current = false;
      if (voice.connected) void voice.session.cancel();
      return;
    }
    if (enabledRef.current || !voice.ready || voice.chatBusy) return;
    enabledRef.current = true;
    void (async () => {
      if (Platform.OS !== 'web') {
        const permission = await requestRecordingPermissionsAsync();
        if (!permission.granted) {
          enabledRef.current = false;
          return;
        }
      }
      voice.connect(false, true);
    })();
  }, [pathname, preferences.wakeWordEnabled, voice.ready, voice.chatBusy, voice.connected, voice.connect, voice.session]);

  useEffect(() => {
    if (!preferences.wakeWordEnabled) enabledRef.current = false;
  }, [preferences.wakeWordEnabled]);

  return null;
}
