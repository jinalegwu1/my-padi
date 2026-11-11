import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { OnboardingShell } from '@/components/onboarding/onboarding-shell';
import { PadiAvatar } from '@/components/padi-avatar';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { fonts, radius, spacing, useColors, useType } from '@/constants/theme';
import { usePreferences } from '@/hooks/use-preferences';
import { useTranslation } from '@/hooks/use-translation';

/**
 * Step 4 — what PADI should call the user.
 * One field only: no long personal-information questionnaire.
 */
export default function NameStep() {
  const router = useRouter();
  const colors = useColors();
  const type = useType();
  const { t } = useTranslation();
  const { update } = usePreferences();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const finish = (displayName: string) => {
    update({ displayName, onboarded: true });
    router.replace('/(tabs)/chat');
  };

  const handleContinue = () => {
    const trimmed = name.trim();
    if (trimmed.length < 1) {
      setError('Please enter a name, or tap “Skip for now”.');
      return;
    }
    finish(trimmed);
  };

  return (
    <OnboardingShell
      step={4}
      totalSteps={4}
      stepLabel={t('onboarding.step', { current: 4, total: 4 })}
      title={t('onboarding.name.title')}
      subtitle={t('onboarding.name.subtitle')}
      onBack={() => router.back()}
      backLabel={t('onboarding.back')}
      footer={
        <>
          <Button title={t('onboarding.name.cta')} onPress={handleContinue} icon="chatbubbles" />
          <Button
            title={t('onboarding.name.skip')}
            variant="ghost"
            onPress={() => finish('')}
          />
        </>
      }>
      <View style={styles.wrap}>
        <View style={styles.avatarWrap}>
          <PadiAvatar size={72} />
        </View>

        <TextField
          label={t('onboarding.name.title')}
          placeholder={t('onboarding.name.placeholder')}
          value={name}
          onChangeText={(value) => {
            setName(value);
            if (error) setError(null);
          }}
          error={error}
          autoFocus
          autoCapitalize="words"
          autoCorrect={false}
          maxLength={40}
          returnKeyType="done"
          onSubmitEditing={handleContinue}
        />

        <View
          style={[
            styles.note,
            { backgroundColor: colors.primarySoft, borderColor: colors.border },
          ]}>
          <Text style={[styles.noteText, { color: colors.textSecondary, fontSize: type.caption }]}>
            You can change this any time in Settings → Memory.
          </Text>
        </View>
      </View>
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.lg },
  avatarWrap: { alignItems: 'center', paddingVertical: spacing.md },
  note: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  noteText: { fontFamily: fonts.regular, lineHeight: 18 },
});
