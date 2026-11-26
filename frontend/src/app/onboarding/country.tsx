import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useRef } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CountryPicker } from '@/components/onboarding/country-picker';
import { identity } from '@/components/onboarding/padi-wordmark';
import { useType } from '@/constants/theme';
import { usePreferences } from '@/hooks/use-preferences';
import { useTranslation } from '@/hooks/use-translation';
import { unlockVoicePlayback } from '@/lib/voice-playback';
import type { Country } from '@/types';

export default function CountryStep() {
  const router = useRouter();
  const { preferences, update } = usePreferences();
  const { t } = useTranslation();
  const type = useType();
  const wide = useWindowDimensions().width >= 820;
  const continuing = useRef(false);

  function select(country: Country) {
    if (continuing.current) return;
    continuing.current = true;
    // The user's final tap unlocks browser playback. Chat owns all sound and capture.
    void unlockVoicePlayback().catch(() => undefined);
    update({ countryCode: country.code, onboarded: true });
    router.replace('/(tabs)/chat');
  }

  return <SafeAreaView style={styles.page}>
    <View style={[styles.sheet, wide && styles.spread]}>
      <View style={[styles.heading, wide && styles.headingWide]}>
        <View style={styles.top}>
          <Text style={styles.mark}>PADI</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t('onboarding.back')}
            onPress={() => router.canGoBack() ? router.back() : router.replace('/onboarding/welcome')}
            style={({pressed}) => [styles.back, pressed && { opacity: 0.6 }]}>
            <Ionicons name="arrow-back" size={19} color={identity.charcoal} />
          </Pressable>
        </View>
        <Text accessibilityRole="header" style={[styles.title, { fontSize: type.title * (wide ? 2.55 : 1.95) }]}>{t('country.choose')}</Text>
      </View>
      <View style={styles.list}>
        <CountryPicker onboarding selectedCode={preferences.countryCode} onSelect={select} searchPlaceholder={t('onboarding.country.search')} />
      </View>
    </View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: identity.ivory },
  sheet: { flex: 1, width: '100%', maxWidth: 520, alignSelf: 'center', paddingHorizontal: 26, paddingTop: 18 },
  spread: { maxWidth: 1080, flexDirection: 'row', columnGap: 70, paddingVertical: 56, paddingHorizontal: 36 },
  heading: { paddingBottom: 24 },
  headingWide: { width: '39%' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  mark: { fontFamily: identity.serif, fontSize: 27, color: identity.darkGold, letterSpacing: 1 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { marginTop: 20, maxWidth: 310, color: identity.charcoal, fontFamily: identity.serif },
  list: { flex: 1, minHeight: 0 },
});
