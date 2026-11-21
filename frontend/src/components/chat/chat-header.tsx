import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PadiAvatar } from '@/components/padi-avatar';
import { fonts, spacing, useColors, useType } from '@/constants/theme';

type Props = {
  name: string;
  status: string;
  onOpenMenu: () => void;
  menuLabel: string;
  onSwitchToVoice: () => void;
  voiceLabel: string;
};

/**
 * Conversation header: PADI's identity, a quiet status line and the two
 * controls the user needs — a fresh conversation and settings.
 */
export function ChatHeader({
  name,
  status,
  onOpenMenu,
  menuLabel,
  onSwitchToVoice,
  voiceLabel,
}: Props) {
  const colors = useColors();
  const type = useType();

  return (
    <View
      style={[
        styles.wrap,
        { backgroundColor: colors.background, borderBottomColor: colors.border },
      ]}>
      <View style={styles.identity}>
        <PadiAvatar size={42} online />
        <View style={styles.identityText}>
          <Text style={[styles.name, { color: colors.text, fontSize: type.subheading }]}>
            {name}
          </Text>
          <Text style={[styles.status, { color: colors.muted, fontSize: type.caption }]}>
            {status}
          </Text>
        </View>
      </View>

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={voiceLabel}
          onPress={onSwitchToVoice}
          hitSlop={8}
          style={({ pressed }) => [
            styles.voiceButton,
            { backgroundColor: colors.primarySoft, borderColor: colors.primary },
            pressed && { opacity: 0.7 },
          ]}>
          <Ionicons name="mic-outline" size={17} color={colors.primary} />
          <Text style={[styles.voiceText, { color: colors.primary, fontSize: type.bodySmall }]}>
            Switch to voice
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={menuLabel}
          onPress={onOpenMenu}
          hitSlop={8}
          style={({ pressed }) => [
            styles.iconButton,
            { backgroundColor: colors.cardMuted },
            pressed && { opacity: 0.7 },
          ]}>
          <Ionicons name="settings-outline" size={19} color={colors.textSecondary} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexShrink: 1 },
  identityText: { gap: 1, flexShrink: 1 },
  name: { fontFamily: fonts.bold, letterSpacing: -0.2 },
  status: { fontFamily: fonts.regular },
  actions: { flexDirection: 'row', gap: spacing.sm },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceButton: {
    minHeight: 38,
    borderRadius: 19,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
  },
  voiceText: { fontFamily: fonts.semibold },
});
