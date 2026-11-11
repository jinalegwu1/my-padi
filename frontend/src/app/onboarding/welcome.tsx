import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { OnboardingShell } from '@/components/onboarding/onboarding-shell';
import { PadiAvatar } from '@/components/padi-avatar';
import { Button } from '@/components/ui/button';
import { fonts, radius, spacing, useColors, useType } from '@/constants/theme';
import { useTranslation } from '@/hooks/use-translation';

/**
 * Step 3 — PADI's warm introduction.
 * No questions here: just a hello and a promise of what the app is for.
 */
export default function WelcomeStep() {
  const router = useRouter();
  const colors = useColors();
  const type = useType();
  const { t } = useTranslation();

  return (
    <OnboardingShell
      step={3}
      totalSteps={4}
      stepLabel={t('onboarding.step', { current: 3, total: 4 })}
      title={t('onboarding.welcome.title')}
      onBack={() => router.back()}
      backLabel={t('onboarding.back')}
      footer={
        <Button
          title={t('onboarding.welcome.cta')}
          onPress={() => router.push('/onboarding/name')}
          icon="arrow-forward"
          iconPosition="end"
        />
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
});
