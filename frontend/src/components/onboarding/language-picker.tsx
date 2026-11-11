import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { fonts, radius, spacing, useColors, useType } from '@/constants/theme';
import { LANGUAGES } from '@/data/languages';
import type { LanguageOption } from '@/types';

type Props = {
  selectedCode: string;
  onSelect: (language: LanguageOption) => void;
  featuredLabel: string;
  othersLabel: string;
};

/** Single-choice language list. Pidgin, Nigerian English and English stay distinct. */
export function LanguagePicker({ selectedCode, onSelect, featuredLabel, othersLabel }: Props) {
  const colors = useColors();
  const type = useType();

  const featured = LANGUAGES.filter((l) => l.featured);
  const others = LANGUAGES.filter((l) => !l.featured);

  const renderOption = (language: LanguageOption) => {
    const selected = language.code === selectedCode;
    return (
      <Pressable
        key={language.code}
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        accessibilityLabel={`${language.label}${language.note ? `. ${language.note}` : ''}`}
        onPress={() => onSelect(language)}
        style={({ pressed }) => [
          styles.option,
          {
            backgroundColor: selected ? colors.primarySoft : colors.card,
            borderColor: selected ? colors.primary : colors.border,
            opacity: pressed ? 0.8 : 1,
          },
        ]}>
        <View style={styles.optionText}>
          <Text style={[styles.label, { color: colors.text, fontSize: type.body }]}>
            {language.label}
          </Text>
          {language.note ? (
            <Text style={[styles.note, { color: colors.muted, fontSize: type.caption }]}>
              {language.note}
            </Text>
          ) : null}
        </View>
        <View
          style={[
            styles.radio,
            {
              borderColor: selected ? colors.primary : colors.borderStrong,
              backgroundColor: selected ? colors.primary : 'transparent',
            },
          ]}>
          {selected ? <Ionicons name="checkmark" size={13} color={colors.onPrimary} /> : null}
        </View>
      </Pressable>
    );
  };

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
      <Text style={[styles.groupLabel, { color: colors.muted, fontSize: type.micro }]}>
        {featuredLabel}
      </Text>
      {featured.map(renderOption)}

      <Text
        style={[
          styles.groupLabel,
          styles.groupLabelSpaced,
          { color: colors.muted, fontSize: type.micro },
        ]}>
        {othersLabel}
      </Text>
      {others.map(renderOption)}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm, paddingBottom: spacing.lg },
  groupLabel: {
    fontFamily: fonts.semibold,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    marginBottom: spacing.xxs,
  },
  groupLabelSpaced: { marginTop: spacing.md },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    minHeight: 58,
  },
  optionText: { flex: 1, gap: 2 },
  label: { fontFamily: fonts.semibold },
  note: { fontFamily: fonts.regular },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
