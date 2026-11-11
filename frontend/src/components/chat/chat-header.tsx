import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PadiAvatar } from '@/components/padi-avatar';
import { fonts, spacing, useColors, useType } from '@/constants/theme';

type Props = {
  name: string;
  status: string;
  onOpenSettings: () => void;
  settingsLabel: string;
  onNewChat: () => void;
  newChatLabel: string;
};

/**
 * Conversation header: PADI's identity, a quiet status line and the two
 * controls the user needs — a fresh conversation and settings.
 */
export function ChatHeader({
  name,
  status,
  onOpenSettings,
  settingsLabel,
  onNewChat,
  newChatLabel,
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
          accessibilityLabel={newChatLabel}
          onPress={onNewChat}
          hitSlop={8}
          style={({ pressed }) => [
            styles.iconButton,
            { backgroundColor: colors.cardMuted },
            pressed && { opacity: 0.7 },
          ]}>
          <Ionicons name="create-outline" size={19} color={colors.textSecondary} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={settingsLabel}
          onPress={onOpenSettings}
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
});
