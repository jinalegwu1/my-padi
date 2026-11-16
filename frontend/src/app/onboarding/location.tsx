import Ionicons from '@expo/vector-icons/Ionicons';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { OnboardingShell } from '@/components/onboarding/onboarding-shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { fonts, spacing, useColors, useType } from '@/constants/theme';
import { usePreferences } from '@/hooks/use-preferences';
import { useChat } from '@/hooks/use-chat';
import { useTranslation } from '@/hooks/use-translation';
import { padiSpeechLanguage, padiVoiceOptions, stopPadiSpeech } from '@/lib/speech';
import {
  buildSpokenGreeting,
  fetchWeatherForCoordinates,
  reverseGeocodeCoordinates,
  roundCoordinate,
  type WeatherReport,
} from '@/lib/weather';

export default function LocationStep() {
  const router = useRouter();
  const colors = useColors();
  const type = useType();
  const { preferences, update } = usePreferences();
  const { addGreeting } = useChat();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(preferences.onboarded);
  const [permissionBlocked, setPermissionBlocked] = useState(false);
  const [settingsRequired, setSettingsRequired] = useState(false);
  const [error, setError] = useState('');
  const [weatherUnavailable, setWeatherUnavailable] = useState('');
  const [fallbackLocation, setFallbackLocation] = useState('');
  const [countryCode, setCountryCode] = useState<string | null>(null);
  const [greeting, setGreeting] = useState('');
  const [awaitingPlayback, setAwaitingPlayback] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [speechError, setSpeechError] = useState('');
  const processing = useRef(false);
  const autoAttempted = useRef(false);

  const speakGreeting = useCallback(
    (text: string) => {
      setAwaitingPlayback(false);
      setSpeaking(true);
      Speech.speak(text, {
        language: padiSpeechLanguage(preferences.languageCode),
        ...padiVoiceOptions(preferences.voiceId, preferences.voiceRate),
        onDone: () => {
          setSpeaking(false);
          router.replace('/(tabs)/chat');
        },
        onError: (speechFailure) => {
          setSpeaking(false);
          setSpeechError(
            speechFailure instanceof Error
              ? speechFailure.message
              : 'PADI could not play the spoken greeting on this device.',
          );
        },
      });
    },
    [preferences.languageCode, preferences.voiceId, preferences.voiceRate, router],
  );

  const enterPadi = useCallback(
    (text: string, detectedCountryCode: string | null) => {
      update({
        countryCode: detectedCountryCode ?? preferences.countryCode,
        onboarded: true,
      });
      addGreeting(buildChatWelcome(preferences.displayName, preferences.languageCode));
      setGreeting(text);
      setSpeechError('');
      setError('');
      setWeatherUnavailable('');
      if (Platform.OS === 'web') {
        setAwaitingPlayback(true);
        return;
      }
      speakGreeting(text);
    },
    [addGreeting, preferences.countryCode, speakGreeting, update],
  );

  const loadLocalGreeting = useCallback(
    async (requestPermission: boolean) => {
      if (processing.current) return;
      processing.current = true;
      setLoading(true);
      setError('');
      setWeatherUnavailable('');
      setSpeechError('');
      setPermissionBlocked(false);
      setSettingsRequired(false);

      try {
        const permission = requestPermission
          ? await Location.requestForegroundPermissionsAsync()
          : await Location.getForegroundPermissionsAsync();
        if (!permission.granted) {
          setPermissionBlocked(true);
          setSettingsRequired(!permission.canAskAgain);
          setError(
            permission.canAskAgain
              ? t('onboarding.location.permission.required')
              : t('onboarding.location.permission.settings'),
          );
          return;
        }

        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Low,
        });
        const address = await reverseGeocodeCoordinates({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });

        const localArea = address.district ?? address.subregion ?? address.city ?? address.name;
        const locationLabel = [localArea, address.region, address.country]
          .filter((part, index, parts) => Boolean(part) && parts.indexOf(part) === index)
          .join(', ');
        if (!locationLabel) {
          throw new Error('PADI could not identify your country and local area. Please try again.');
        }
        const detectedCountryCode = address.isoCountryCode?.toUpperCase() ?? null;
        setCountryCode(detectedCountryCode);
        setFallbackLocation(locationLabel);

        let report: WeatherReport;
        try {
          report = await fetchWeatherForCoordinates(
            {
              latitude: roundCoordinate(position.coords.latitude),
              longitude: roundCoordinate(position.coords.longitude),
            },
            locationLabel,
          );
        } catch (weatherFailure) {
          setWeatherUnavailable(
            weatherFailure instanceof Error
              ? weatherFailure.message
              : 'Current weather could not be loaded.',
          );
          return;
        }

        enterPadi(
          buildSpokenGreeting(report, preferences.displayName, preferences.languageCode),
          detectedCountryCode,
        );
      } catch (locationFailure) {
        setError(
          locationFailure instanceof Error
            ? locationFailure.message
            : 'PADI could not read your location. Please try again.',
        );
      } finally {
        processing.current = false;
        setLoading(false);
      }
    },
    [enterPadi, preferences.displayName, preferences.languageCode, t],
  );

  useEffect(() => {
    if (!preferences.onboarded || autoAttempted.current) return;
    autoAttempted.current = true;
    void loadLocalGreeting(false);
  }, [loadLocalGreeting, preferences.onboarded]);

  useEffect(
    () => () => {
      void stopPadiSpeech();
    },
    [],
  );

  const requestLocation = () => {
    autoAttempted.current = true;
    void loadLocalGreeting(true);
  };

  const continueWithoutWeather = () => {
    const text = buildWeatherUnavailableGreeting(
      fallbackLocation,
      preferences.displayName,
      preferences.languageCode,
    );
    enterPadi(text, countryCode);
  };

  const playGreeting = () => {
    setSpeechError('');
    speakGreeting(greeting);
  };

  const continueWithoutVoice = () => {
    void stopPadiSpeech();
    router.replace('/(tabs)/chat');
  };

  const openLocationSettings = async () => {
    try {
      await Linking.openSettings();
    } catch (settingsError) {
      setError(
        settingsError instanceof Error
          ? settingsError.message
          : 'Could not open location settings. Please open them from your device settings.',
      );
    }
  };

  return (
    <OnboardingShell
      step={3}
      totalSteps={3}
      stepLabel={t('onboarding.step', { current: 3, total: 3 })}
      title={t('onboarding.location.title')}
      subtitle={t('onboarding.location.subtitle')}
      onBack={preferences.onboarded ? undefined : () => router.back()}
      backLabel="Back"
      footer={
        <>
          {loading ? (
            <Text style={[styles.status, { color: colors.muted, fontSize: type.caption }]}>
              {t('onboarding.location.loading')}
            </Text>
          ) : null}
          {!loading && weatherUnavailable ? (
            <>
              <Button
                title={t('onboarding.location.weather.continue')}
                onPress={continueWithoutWeather}
                icon="chatbubbles"
              />
              <Button
                title={t('onboarding.location.weather.retry')}
                variant="ghost"
                onPress={() => void loadLocalGreeting(false)}
                icon="refresh"
              />
            </>
          ) : null}
          {!loading && !weatherUnavailable && (error || !greeting) ? (
            <>
              <Button
                title={
                  error
                    ? permissionBlocked
                      ? t('onboarding.location.allowRetry')
                      : t('onboarding.location.retry')
                    : t('onboarding.location.start')
                }
                onPress={requestLocation}
                icon="location"
              />
              {settingsRequired && Platform.OS !== 'web' ? (
                <Button
                  title={t('onboarding.location.openSettings')}
                  variant="ghost"
                  onPress={() => void openLocationSettings()}
                  icon="settings-outline"
                />
              ) : null}
            </>
          ) : null}
          {!loading && greeting && speechError ? (
            <>
              <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger }]}>
                {speechError}
              </Text>
              <Button title={t('onboarding.location.voice.continue')} onPress={continueWithoutVoice} />
            </>
          ) : null}
          {!loading && greeting && awaitingPlayback ? (
            <Button
              title={t('onboarding.location.voice.play')}
              onPress={playGreeting}
              icon="volume-high"
            />
          ) : null}
          {!loading && greeting && !speechError && speaking ? (
            <Button
              title={t('onboarding.location.continue')}
              variant="ghost"
              onPress={continueWithoutVoice}
              icon="arrow-forward"
              iconPosition="end"
            />
          ) : null}
        </>
      }>
      <Card>
        <View style={styles.heading}>
          <Ionicons name="location-outline" size={20} color={colors.primary} />
          <Text style={[styles.cardTitle, { color: colors.text, fontSize: type.body }]}>
            Foreground location only
          </Text>
        </View>
        <Text style={[styles.copy, { color: colors.textSecondary, fontSize: type.bodySmall }]}>
          {t('onboarding.location.privacy')}
        </Text>
        <Text style={[styles.attribution, { color: colors.muted, fontSize: type.micro }]}>
          Weather by Open-Meteo · Browser area lookup by OpenStreetMap contributors.
        </Text>
      </Card>
      {error ? (
        <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger }]}>
          {error}
        </Text>
      ) : null}
      {weatherUnavailable ? (
        <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger }]}>
          {weatherUnavailable}
        </Text>
      ) : null}
      {fallbackLocation ? (
        <Text style={[styles.status, { color: colors.muted, fontSize: type.caption }]}>
          Local area: {fallbackLocation}
        </Text>
      ) : null}
      {greeting ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.greeting, { color: colors.text, fontSize: type.body }]}>
          {greeting}
        </Text>
      ) : null}
    </OnboardingShell>
  );
}

function buildWeatherUnavailableGreeting(
  location: string,
  displayName: string,
  languageCode: string,
): string {
  const name = displayName.trim();
  if (languageCode === 'pcm-NG') {
    return `Hello${name ? `, ${name}` : ''}! Na me be PADI. I no fit check current weather for ${location} now, but I dey here. Wetin you wan gist about?`;
  }
  if (languageCode === 'fr-FR') {
    return `Bonjour${name ? `, ${name}` : ''} ! Je suis PADI. Je ne peux pas consulter la météo actuelle à ${location} pour le moment, mais je suis là. De quoi aimeriez-vous parler ?`;
  }
  return `Hello${name ? `, ${name}` : ''}! I’m PADI. I could not get the current weather for ${location}, but I’m here and ready to talk.`;
}

function buildChatWelcome(displayName: string, languageCode: string): string {
  const name = displayName.trim();
  if (languageCode === 'pcm-NG') {
    return `Hello${name ? `, ${name}` : ''}! Na me be PADI. Wetin you wan gist about today?`;
  }
  if (languageCode === 'fr-FR') {
    return `Bonjour${name ? `, ${name}` : ''} ! Je suis PADI. De quoi aimeriez-vous parler aujourd’hui ?`;
  }
  return `Hello${name ? `, ${name}` : ''}! I’m PADI. What would you like to talk about today?`;
}

const styles = StyleSheet.create({
  heading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardTitle: { fontFamily: fonts.semibold },
  copy: { fontFamily: fonts.regular, lineHeight: 21, marginTop: spacing.sm },
  error: { fontFamily: fonts.medium, lineHeight: 20 },
  status: { fontFamily: fonts.medium, textAlign: 'center' },
  attribution: { fontFamily: fonts.regular, marginTop: spacing.sm },
  greeting: { fontFamily: fonts.medium, lineHeight: 24, textAlign: 'center', marginTop: spacing.md },
});
