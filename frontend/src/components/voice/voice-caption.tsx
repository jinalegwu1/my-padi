import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fonts, radius, spacing, useColors, useType } from '@/constants/theme';

type Props = {
  /** What PADI is saying (or last said). */
  padiText: string;
  /** What the user "said" in this turn, if any. */
  userText?: string;
  visible: boolean;
  onToggle: () => void;
  showLabel: string;
  hideLabel: string;
  youSaidLabel: string;
};

/**
 * Words spoken in the voice session, with a show/hide control.
 * The transcript is the text alternative for the voice interaction.
 */
export function VoiceCaption({
  padiText,
  userText,
  visible,
  onToggle,
  showLabel,
  hideLabel,
  youSaidLabel,
}: Props) {
  const colors = useColors();
  const type = useType();

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={visible ? hideLabel : showLabel}
        accessibilityState={{ expanded: visible }}
        onPress={onToggle}
        hitSlop={8}
        style={({ pressed }) => [
          styles.toggle,
          { backgroundColor: colors.cardMuted, borderColor: colors.border },
          pressed && { opacity: 0.7 },
        ]}>
        <Ionicons
          name={visible ? 'eye-off-outline' : 'eye-outline'}
          size={15}
          color={colors.textSecondary}
        />
        <Text style={[styles.toggleText, { color: colors.textSecondary, fontSize: type.caption }]}>
          {visible ? hideLabel : showLabel}
        </Text>
      </Pressable>

      {visible ? (
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}>
          {userText ? (
            <View style={styles.block}>
              <Text style={[styles.speaker, { color: colors.muted, fontSize: type.micro }]}>
                {youSaidLabel.toUpperCase()}
              </Text>
              <Text
                style={[
                  styles.userText,
                  { color: colors.textSecondary, fontSize: type.bodySmall },
                ]}>
                {userText}
              </Text>
            </View>
          ) : null}
          <View style={styles.block}>
            <Text style={[styles.speaker, { color: colors.primary, fontSize: type.micro }]}>
              PADI
            </Text>
            <Text
              style={[
                styles.padiText,
                {
                  color: colors.text,
                  fontSize: type.body,
                  lineHeight: type.lineHeight(type.body),
                },
              ]}>
              {padiText}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, alignItems: 'center' },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  toggleText: { fontFamily: fonts.medium },
  card: {
    alignSelf: 'stretch',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.base,
    gap: spacing.md,
  },
  block: { gap: spacing.xs },
  speaker: { fontFamily: fonts.bold, letterSpacing: 0.8 },
  userText: { fontFamily: fonts.regular, lineHeight: 20 },
  padiText: { fontFamily: fonts.regular },
});
