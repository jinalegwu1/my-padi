import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CountryPicker } from '@/components/onboarding/country-picker';
import { OnboardingShell } from '@/components/onboarding/onboarding-shell';
import { Button } from '@/components/ui/button';
import { fonts, radius, spacing, useColors, useType } from '@/constants/theme';
import { COUNTRIES, findCountry } from '@/data/countries';
import { usePreferences } from '@/hooks/use-preferences';
import { useTranslation } from '@/hooks/use-translation';
import type { Country } from '@/types';

/**
 * Step 1 — country.
 * A country is suggested from the device locale; the user confirms it or picks
 * another one from the searchable list.
 */
export default function CountryStep() {
  const router = useRouter();
  const colors = useColors();
  const type = useType();
  const { t } = useTranslation();
  const { preferences, update } = usePreferences();

  // Suggest a country from the device locale; fall back to the first entry when
  // the platform does not expose one.
  const suggested = useMemo<Country>(() => {
    try {
      const locale = Intl.DateTimeFormat().resolvedOptions().locale ?? '';
      const region = locale.split('-')[1]?.toUpperCase();
      return findCountry(region ?? '') ?? COUNTRIES[0];
    } catch {
      return COUNTRIES[0];
    }
  }, []);

  const [selected, setSelected] = useState<Country>(
    findCountry(preferences.countryCode) ?? suggested,
  );
  const [showList, setShowList] = useState(false);

  const confirm = () => {
    update({ countryCode: selected.code });
    router.push('/onboarding/language');
  };

  return (
    <OnboardingShell
      step={1}
      totalSteps={4}
      stepLabel={t('onboarding.step', { current: 1, total: 4 })}
      title={t('onboarding.country.title')}
      subtitle={t('onboarding.country.subtitle')}
      footer={
        <>
          <Button title={t('onboarding.country.confirm')} onPress={confirm} icon="checkmark" />
          <Button
            title={t('onboarding.country.change')}
            variant="ghost"
            onPress={() => setShowList((prev) => !prev)}
            icon={showList ? 'chevron-up' : 'search'}
          />
        </>
      }>
      {showList ? (
        <CountryPicker
          selectedCode={selected.code}
          onSelect={(country) => {
            setSelected(country);
            setShowList(false);
          }}
          searchPlaceholder={t('onboarding.country.search')}
        />
      ) : (
        <View style={styles.suggestionWrap}>
          <Text style={[styles.label, { color: colors.muted, fontSize: type.micro }]}>
            {t('onboarding.country.suggested').toUpperCase()}
          </Text>
          <View
            style={[
              styles.suggestion,
              { backgroundColor: colors.card, borderColor: colors.primary },
            ]}>
            <Text style={styles.flag}>{selected.flag}</Text>
            <View style={styles.suggestionText}>
              <Text style={[styles.name, { color: colors.text, fontSize: type.heading }]}>
                {selected.name}
              </Text>
              <Text style={[styles.dial, { color: colors.muted, fontSize: type.caption }]}>
                {selected.dialCode}
              </Text>
            </View>
          </View>
          <Text
            style={[
              styles.hint,
              { color: colors.muted, fontSize: type.caption, lineHeight: type.lineHeight(type.caption) },
            ]}>
            {t('onboarding.country.selected')}: {selected.name}
          </Text>
        </View>
      )}
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  suggestionWrap: { gap: spacing.sm },
  label: { fontFamily: fonts.semibold, letterSpacing: 0.7 },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.base,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    padding: spacing.lg,
  },
  flag: { fontSize: 40 },
  suggestionText: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.bold },
  dial: { fontFamily: fonts.medium },
  hint: { fontFamily: fonts.regular, marginTop: spacing.xs },
});
