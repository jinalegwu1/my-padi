import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { radius, shadow, spacing, useColors } from '@/constants/theme';
import { useFocusRing } from '@/hooks/use-focus-ring';

type Props = {
  children: ReactNode;
  /** Makes the whole card tappable (e.g. open the item's detail screen). */
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  padded?: boolean;
};

export function Card({
  children,
  onPress,
  style,
  accessibilityLabel,
  accessibilityHint,
  padded = true,
}: Props) {
  const colors = useColors();
  const { focused, onFocus, onBlur } = useFocusRing();
  const base = [
    styles.card,
    {
      backgroundColor: colors.card,
      borderColor: colors.border,
      padding: padded ? spacing.base : 0,
    },
    style,
  ];

  if (!onPress) {
    return <View style={base}>{children}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      onFocus={onFocus}
      onBlur={onBlur}
      style={({ pressed }) => [
        ...base,
        pressed && { opacity: 0.85 },
        focused && { borderColor: colors.focus, borderWidth: 2 },
      ]}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    ...shadow.card,
  },
});
