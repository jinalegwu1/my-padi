import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import * as Notifications from 'expo-notifications';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, useColorScheme, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { palette } from '@/constants/theme';
import { usePreferences } from '@/hooks/use-preferences';
import { usePushDeviceLifecycle } from '@/hooks/use-push-device-lifecycle';
import { PreferencesProvider } from '@/hooks/use-preferences';
import { ChatProvider } from '@/state/chat-context';
import { MemoryProvider } from '@/state/memory-context';
import { WakeManager } from '@/components/wake-manager';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** Applies the user's appearance choice to the navigation theme. */
function ThemedStack() {
  const router = useRouter();
  const system = useColorScheme();
  const { preferences, status } = usePreferences();
  usePushDeviceLifecycle(preferences.languageCode);
  const mode = preferences.appearance;
  const scheme = mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode;
  const colors = palette[scheme];
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;

  const navTheme = {
    ...base,
    colors: {
      ...base.colors,
      background: colors.background,
      card: colors.card,
      text: colors.text,
      border: colors.border,
      primary: colors.primary,
    },
  };

  useEffect(() => {
    let lastResponseID: string | null = null;
    const openNotification = (response: Notifications.NotificationResponse) => {
      const request = response.notification.request;
      if (request.identifier === lastResponseID) return;
      lastResponseID = request.identifier;
      const data = request.content.data;
      if (data?.kind === 'padi_check_in') router.push('/(tabs)/chat');
    };
    const subscription = Notifications.addNotificationResponseReceivedListener(openNotification);
    void Notifications.getLastNotificationResponseAsync()
      .then((response) => { if (response) openNotification(response); })
      .catch(() => console.warn('PADI could not process the last notification response.'));
    return () => subscription.remove();
  }, [router]);

  if (status === 'loading') {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.background,
        }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ThemeProvider value={navTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="voice"
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen name="memory" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="device-actions" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="weather" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="auth" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="+not-found" options={{ headerShown: true, title: 'Not found' }} />
      </Stack>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  if (!fontsLoaded) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#101828',
        }}>
        <ActivityIndicator color="#536DFE" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <PreferencesProvider>
        <MemoryProvider>
          <ChatProvider>
            <ThemedStack />
            <WakeManager />
          </ChatProvider>
        </MemoryProvider>
      </PreferencesProvider>
    </SafeAreaProvider>
  );
}
