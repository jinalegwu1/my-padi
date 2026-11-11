import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { fonts, radius, spacing, useColors, useType } from '@/constants/theme';
import type { ChatSuggestion } from '@/types';

type Props = {
  suggestions: ChatSuggestion[];
  onPick: (prompt: string) => void;
  title: string;
};

/**
 * Quick-start chips above the composer. They are conversation starters, not
 * navigation — every one of them simply sends a message.
 */
export function SuggestionChips({ suggestions, onPick, title }: Props) {
  const colors = useColors();
  const type = useType();

  return (
    <View style={styles.wrap}>
      <Text style={[styles.title, { color: colors.muted, fontSize: type.micro }]}>{title}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        keyboardShouldPersistTaps="handled">
        {suggestions.map((suggestion) => (
          <Pressable
            key={suggestion.id}
            accessibilityRole="button"
            accessibilityLabel={suggestion.label}
            accessibilityHint={suggestion.prompt}
            onPress={() => onPick(suggestion.prompt)}
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                opacity: pressed ? 0.75 : 1,
              },
            ]}>
            <Ionicons
              name={suggestion.icon as ComponentProps<typeof Ionicons>['name']}
              size={15}
              color={colors.primary}
            />
            <Text style={[styles.chipText, { color: colors.text, fontSize: type.caption }]}>
              {suggestion.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs, paddingTop: spacing.sm },
  title: {
    fontFamily: fonts.semibold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    paddingHorizontal: spacing.base,
  },
  row: { gap: spacing.sm, paddingHorizontal: spacing.base, paddingVertical: spacing.xs },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chipText: { fontFamily: fonts.medium },
});
