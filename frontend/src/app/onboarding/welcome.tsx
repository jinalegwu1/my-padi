import { useRouter } from 'expo-router';
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { OnboardingShell } from '@/components/onboarding/onboarding-shell';
import { PadiAvatar } from '@/components/padi-avatar';
import { Button } from '@/components/ui/button';
import { fonts, radius, spacing, useColors, useType } from '@/constants/theme';
import { usePreferences } from '@/hooks/use-preferences';
import { useTranslation } from '@/hooks/use-translation';
import { padiSpeechLanguage, padiVoiceOptions, stopPadiSpeech } from '@/lib/speech';

/**
 * Step 1 — PADI's warm introduction.
 * No questions here: just a hello and a promise of what the app is for.
 */
export default function WelcomeStep() {
  const router = useRouter();
  const colors = useColors();
  const type = useType();
  const { t } = useTranslation();
  const { preferences } = usePreferences();
  const [speechError, setSpeechError] = useState('');

  const speakIntroduction = useCallback(() => {
    setSpeechError('');
    Speech.speak(`${t('onboarding.welcome.title')} ${t('onboarding.welcome.body')}`, {
      language: padiSpeechLanguage(preferences.languageCode),
      ...padiVoiceOptions(preferences.voiceId, preferences.voiceRate),
      onError: (error) => {
        setSpeechError(
          error instanceof Error ? error.message : 'PADI could not speak on this device.',
        );
      },
    });
  }, [preferences.languageCode, preferences.voiceId, preferences.voiceRate, t]);

  useEffect(() => {
    if (Platform.OS !== 'web') speakIntroduction();
    return () => void stopPadiSpeech();
  }, [speakIntroduction]);

  return (
    <OnboardingShell
      step={1}
      totalSteps={3}
      stepLabel={t('onboarding.step', { current: 1, total: 3 })}
      title={t('onboarding.welcome.title')}
      footer={
        <>
          {Platform.OS === 'web' || speechError ? (
            <Button
              title={t('onboarding.welcome.hear')}
              variant="secondary"
              onPress={speakIntroduction}
              icon="volume-high"
            />
          ) : null}
          {speechError ? (
            <Text accessibilityRole="alert" style={[styles.speechError, { color: colors.danger }]}>
              {speechError}
            </Text>
          ) : null}
          <Button
            title={t('onboarding.welcome.cta')}
            onPress={() => router.push('/onboarding/language')}
            icon="arrow-forward"
            iconPosition="end"
          />
        </>
      }>
      <View style={styles.wrap}>
        <View style={styles.avatarWrap}>
          <PadiAvatar size={96} />
        </View>

        <View
          style={[
            styles.bubble,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}>
          <Text
            style={[
              styles.body,
              {
                color: colors.text,
                fontSize: type.body,
                lineHeight: type.lineHeight(type.body),
              },
            ]}>
            {t('onboarding.welcome.body')}
          </Text>
        </View>

        <View style={styles.promises}>
          {[
            { icon: '💬', text: 'Conversation first — chat freely, any time.' },
            { icon: '🔒', text: 'Act only with permission — you stay in control.' },
            { icon: '🌍', text: 'Speaks your language, in your own way.' },
          ].map((item) => (
            <View
              key={item.text}
              style={[
                styles.promise,
                { backgroundColor: colors.cardMuted, borderColor: colors.border },
              ]}>
              <Text style={styles.promiseIcon}>{item.icon}</Text>
              <Text
                style={[
                  styles.promiseText,
                  { color: colors.textSecondary, fontSize: type.bodySmall },
                ]}>
                {item.text}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.lg },
  avatarWrap: { alignItems: 'center', paddingVertical: spacing.md },
  bubble: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
  },
  body: { fontFamily: fonts.regular },
  promises: { gap: spacing.sm },
  promise: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  promiseIcon: { fontSize: 18 },
  promiseText: { flex: 1, fontFamily: fonts.medium, lineHeight: 20 },
  speechError: { fontFamily: fonts.medium, textAlign: 'center' },
});
