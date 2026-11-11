import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { fonts, radius, spacing, useColors, useType } from '@/constants/theme';
import type { OrbState } from '@/components/padi-orb';

type Props = {
  state: OrbState;
  label: string;
};

/**
 * Text + icon state indicator. The voice state is never communicated by colour
 * or animation alone — this pill always spells it out.
 */
export function VoiceStatePill({ state, label }: Props) {
  const colors = useColors();
  const type = useType();

  const config: Record<OrbState, { icon: ComponentProps<typeof Ionicons>['name']; tint: string; bg: string }> = {
    idle: { icon: 'ellipse-outline', tint: colors.muted, bg: colors.cardMuted },
    listening: { icon: 'mic', tint: colors.primary, bg: colors.primarySoft },
    thinking: { icon: 'sparkles', tint: colors.accent, bg: colors.accentSoft },
    speaking: { icon: 'volume-high', tint: colors.success, bg: colors.successSoft },
  };

  const { icon, tint, bg } = config[state];

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[styles.pill, { backgroundColor: bg, borderColor: colors.border }]}>
      <Ionicons name={icon} size={14} color={tint} />
      <Text style={[styles.label, { color: tint, fontSize: type.caption }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  label: { fontFamily: fonts.semibold, letterSpacing: 0.2 },
});
