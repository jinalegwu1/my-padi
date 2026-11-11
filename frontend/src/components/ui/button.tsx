import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { fonts, radius, spacing, useColors, useType } from '@/constants/theme';
import { useFocusRing } from '@/hooks/use-focus-ring';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft';
type Size = 'sm' | 'md' | 'lg';

type Props = {
  title: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  icon?: ComponentProps<typeof Ionicons>['name'];
  iconPosition?: 'start' | 'end';
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  accessibilityHint?: string;
};

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  iconPosition = 'start',
  loading,
  disabled,
  fullWidth = true,
  accessibilityHint,
}: Props) {
  const colors = useColors();
  const type = useType();
  const { focused, onFocus, onBlur } = useFocusRing();
  const inactive = disabled || loading;

  const background = {
    primary: colors.primary,
    secondary: colors.card,
    ghost: 'transparent',
    danger: colors.danger,
    soft: colors.primarySoft,
  }[variant];

  const foreground = {
    primary: colors.onPrimary,
    secondary: colors.text,
    ghost: colors.primary,
    danger: '#FFFFFF',
    soft: colors.primary,
  }[variant];

  const border = variant === 'secondary' ? colors.border : 'transparent';
  const height = size === 'sm' ? 40 : size === 'lg' ? 56 : 50;
  const fontSize = size === 'sm' ? type.bodySmall : type.subheading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      onFocus={onFocus}
      onBlur={onBlur}
      hitSlop={4}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: background,
          borderColor: focused ? colors.focus : border,
          borderWidth: focused ? 2 : 1,
          minHeight: height,
          borderRadius: radius.md,
          opacity: inactive ? 0.45 : pressed ? 0.82 : 1,
        },
        fullWidth && styles.fullWidth,
      ]}>
      {loading ? (
        <ActivityIndicator color={foreground} />
      ) : (
        <View style={styles.row}>
          {icon && iconPosition === 'start' ? (
            <Ionicons name={icon} size={size === 'sm' ? 16 : 19} color={foreground} />
          ) : null}
          <Text
            numberOfLines={1}
            style={[styles.title, { color: foreground, fontSize, fontFamily: fonts.semibold }]}>
            {title}
          </Text>
          {icon && iconPosition === 'end' ? (
            <Ionicons name={icon} size={size === 'sm' ? 16 : 19} color={foreground} />
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: { alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { letterSpacing: 0.1 },
});
