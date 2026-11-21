import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { OnboardingShell } from '@/components/onboarding/onboarding-shell';
import { PadiAvatar } from '@/components/padi-avatar';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { fonts, radius, spacing, useColors, useType } from '@/constants/theme';
import { usePreferences } from '@/hooks/use-preferences';
import { useTranslation } from '@/hooks/use-translation';

/**
 * Step 4 — the details PADI uses for a respectful first greeting.
 */
export default function NameStep() {
  const router = useRouter();
  const colors = useColors();
  const type = useType();
  const { t } = useTranslation();
  const { update } = usePreferences();
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState<'female' | 'male' | 'prefer_not_to_say' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const finish = (displayName: string) => {
    const parsedAge = Number(age);
    update({
      displayName,
      age: age.trim() && Number.isInteger(parsedAge) && parsedAge >= 1 && parsedAge <= 120 ? parsedAge : null,
      gender,
      onboarded: true,
    });
    router.replace('/(tabs)/chat');
  };

  const handleContinue = () => {
    const trimmed = name.trim();
    if (trimmed.length < 1) {
      setError('Please enter a name, or tap “Skip for now”.');
      return;
    }
    if (age.trim()) {
      const parsedAge = Number(age);
      if (!Number.isInteger(parsedAge) || parsedAge < 1 || parsedAge > 120) {
        setError('Enter a valid age, or leave it blank.');
        return;
      }
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
      onBack={() => { if (router.canGoBack()) router.back(); else router.replace('/onboarding/location'); }}
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

        <TextField
          label="Age"
          placeholder="Your age (optional)"
          value={age}
          onChangeText={(value) => {
            setAge(value.replace(/[^\d]/g, '').slice(0, 3));
            if (error) setError(null);
          }}
          keyboardType="number-pad"
          maxLength={3}
          hint="PADI uses this to choose a respectful greeting."
        />

        <View style={styles.genderWrap}>
          <Text style={[styles.genderLabel, { color: colors.textSecondary, fontSize: type.bodySmall }]}>
            Gender
          </Text>
          <View style={styles.genderOptions}>
            {([
              ['male', 'Male'],
              ['female', 'Female'],
              ['prefer_not_to_say', 'Prefer not to say'],
            ] as const).map(([value, label]) => {
              const selected = gender === value;
              return (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setGender(value)}
                  style={({ pressed }) => [
                    styles.genderOption,
                    {
                      backgroundColor: selected ? colors.primarySoft : colors.card,
                      borderColor: selected ? colors.primary : colors.border,
                      opacity: pressed ? 0.75 : 1,
                    },
                  ]}>
                  <Text style={[styles.genderOptionText, { color: selected ? colors.primary : colors.text, fontSize: type.bodySmall }]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

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
  genderWrap: { gap: spacing.sm },
  genderLabel: { fontFamily: fonts.semibold },
  genderOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  genderOption: {
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  genderOptionText: { fontFamily: fonts.semibold },
  note: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  noteText: { fontFamily: fonts.regular, lineHeight: 18 },
});
