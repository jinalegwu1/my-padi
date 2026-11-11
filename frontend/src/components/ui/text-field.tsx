import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { fonts, radius, spacing, useColors, useType } from '@/constants/theme';

type Props = TextInputProps & {
  label: string;
  /** Shown under the field in the danger color; also marks the field invalid. */
  error?: string | null;
  hint?: string;
  /** Hides the visible label but keeps it for screen readers. */
  hideLabel?: boolean;
};

export function TextField({ label, error, hint, hideLabel, style, ...input }: Props) {
  const colors = useColors();
  const type = useType();
  return (
    <View style={styles.wrap}>
      {hideLabel ? null : (
        <Text style={[styles.label, { color: colors.textSecondary, fontSize: type.bodySmall }]}>
          {label}
        </Text>
      )}
      <TextInput
        placeholderTextColor={colors.muted}
        accessibilityLabel={label}
        {...input}
        style={[
          styles.input,
          {
            color: colors.text,
            backgroundColor: colors.card,
            borderColor: error ? colors.danger : colors.border,
            fontSize: type.subheading,
            fontFamily: fonts.regular,
          },
          style,
        ]}
      />
      {error ? (
        <Text style={[styles.note, { color: colors.danger, fontSize: type.caption }]}>{error}</Text>
      ) : hint ? (
        <Text style={[styles.note, { color: colors.muted, fontSize: type.caption }]}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs + 2 },
  label: { fontFamily: fonts.semibold, letterSpacing: 0.2 },
  input: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
  },
  note: { fontFamily: fonts.regular },
});
