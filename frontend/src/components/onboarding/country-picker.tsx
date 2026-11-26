import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { fonts, radius, spacing, useColors, useType } from '@/constants/theme';
import { useTranslation } from '@/hooks/use-translation';
import { searchCountries } from '@/data/countries';
import type { Country } from '@/types';

type Props = {
  onboarding?: boolean;
  selectedCode: string | null;
  onSelect: (country: Country) => void;
  searchPlaceholder: string;
};

/** Searchable country list. Used by onboarding and by Settings. */
export function CountryPicker({ selectedCode, onSelect, searchPlaceholder, onboarding = false }: Props) {
  const theme = useColors();
  const colors = onboarding ? { ...theme, card: '#FAF8F1', text: '#19352E', border: '#D7D9CD',
    primary: '#765522', primarySoft: '#EFEDDF', muted: '#56655B' } : theme;
  const { t } = useTranslation();
  const type = useType();
  const [query, setQuery] = useState('');
  const results = useMemo(() => {
    const matches = searchCountries(query);
    return onboarding ? [...matches].sort((a, b) => a.name.localeCompare(b.name)) : matches;
  }, [query, onboarding]);

  return (
    <View style={styles.wrap}>
      <View
        style={[
          styles.search,
          { backgroundColor: onboarding ? colors.primarySoft : colors.card, borderColor: colors.border },
        ]}>
        <Ionicons name="search" size={17} color={colors.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={searchPlaceholder}
          placeholderTextColor={colors.muted}
          accessibilityLabel={searchPlaceholder}
          autoCorrect={false}
          style={[styles.searchInput, { color: colors.text, fontSize: type.body }]}
        />
        {query.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('country.clear')}
            onPress={() => setQuery('')}
            hitSlop={8}>
            <Ionicons name="close-circle" size={17} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>

      <FlatList
        data={results}
        keyExtractor={(item) => item.code}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.list, onboarding && { gap: 0 }]}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: colors.muted, fontSize: type.bodySmall }]}>
            {t('country.noMatches')}
          </Text>
        }
        renderItem={({ item }) => {
          const selected = item.code === selectedCode;
          return (
            <Pressable
              accessibilityRole={onboarding ? 'button' : 'radio'}
              accessibilityState={{ selected }}
              accessibilityLabel={onboarding ? item.name : `${item.name}, ${item.dialCode}`}
              onPress={() => onSelect(item)}
              style={({ pressed }) => [
                styles.row,
                onboarding && styles.countryRow,
                {
                  backgroundColor: selected ? colors.primarySoft : colors.card,
                  borderColor: selected ? colors.primary : colors.border,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}>
              <Text style={styles.flag}>{item.flag}</Text>
              <View style={styles.rowText}>
                <Text style={[styles.name, { color: colors.text, fontSize: type.body }]}>
                  {item.name}
                </Text>
                {!onboarding && <Text style={[styles.dial, { color: colors.muted, fontSize: type.caption }]}>
                  {item.dialCode}
                </Text>}
              </View>
              {selected ? (
                <Ionicons name="checkmark-circle" size={21} color={colors.primary} />
              ) : onboarding ? <Ionicons name="chevron-forward" size={17} color={colors.muted} /> : null}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, gap: spacing.md },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    minHeight: 48,
  },
  searchInput: { flex: 1, fontFamily: fonts.regular, paddingVertical: spacing.sm },
  list: { gap: spacing.sm, paddingBottom: spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  countryRow: { minHeight: 60, paddingHorizontal: 4, borderRadius: 0, borderWidth: 0, borderBottomWidth: StyleSheet.hairlineWidth },
  flag: { fontSize: 24 },
  rowText: { flex: 1, gap: 1 },
  name: { fontFamily: fonts.medium },
  dial: { fontFamily: fonts.regular },
  empty: { fontFamily: fonts.regular, textAlign: 'center', paddingVertical: spacing.xl },
});
