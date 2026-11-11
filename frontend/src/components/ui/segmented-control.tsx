import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fonts, radius, spacing, useColors, useType } from '@/constants/theme';
import { useFocusRing } from '@/hooks/use-focus-ring';

export type SegmentOption<T extends string> = {
  value: T;
  label: string;
  icon?: string;
};

type Props<T extends string> = {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel: string;
};

/** Rounded segmented control used for appearance, filters and repeat rules. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: Props<T>) {
  const colors = useColors();
  const type = useType();
  const { focused, onFocus, onBlur } = useFocusRing();

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      style={[styles.wrap, { backgroundColor: colors.cardMuted, borderColor: colors.border }]}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            onPress={() => onChange(option.value)}
            onFocus={onFocus}
            onBlur={onBlur}
            style={({ pressed }) => [
              styles.segment,
              selected && { backgroundColor: colors.card, borderColor: colors.border },
              pressed && !selected && { opacity: 0.7 },
              focused && { borderColor: colors.focus, borderWidth: 2 },
            ]}>
            <Text
              numberOfLines={1}
              style={[
                styles.label,
                {
                  color: selected ? colors.text : colors.muted,
                  fontSize: type.caption,
                  fontFamily: selected ? fonts.semibold : fonts.medium,
                },
              ]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    minHeight: 38,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  label: { letterSpacing: 0.1 },
});
