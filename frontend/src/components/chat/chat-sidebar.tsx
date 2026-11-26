import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PadiAvatar } from '@/components/padi-avatar';
import { fonts, radius, spacing, useColors, useType } from '@/constants/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

type Props = {
  visible: boolean;
  displayName: string;
  onClose: () => void;
  onNewChat: () => void;
  history: { id: string; title: string; updatedAt: number }[];
  selectedID: string;
  onOpenChat: (id: string) => void;
  onSettings: () => void;
  onMemory: () => void;
  onDeviceActions: () => void;
  onReminders: () => void;
  onWeather: () => void;
  onSignOut: () => void;
};

export function ChatSidebar({
  visible,
  displayName,
  onClose,
  onNewChat,
  history, selectedID, onOpenChat,
  onSettings,
  onMemory,
  onDeviceActions,
  onReminders,
  onWeather,
  onSignOut,
}: Props) {
  const colors = useColors();
  const type = useType();
  const items: { title: string; subtitle: string; icon: IconName; onPress: () => void }[] = [
    { title: 'New chat', subtitle: 'Start a fresh conversation', icon: 'create-outline', onPress: onNewChat },
    { title: 'Settings', subtitle: 'Language, voice and appearance', icon: 'settings-outline', onPress: onSettings },
    { title: 'Memory', subtitle: 'Review what PADI remembers', icon: 'sparkles-outline', onPress: onMemory },
    { title: 'Device actions', subtitle: 'Calls, messages, email and media', icon: 'apps-outline', onPress: onDeviceActions },
    { title: 'Reminders', subtitle: 'Personal reminders on this phone', icon: 'alarm-outline', onPress: onReminders },
    { title: 'Weather', subtitle: 'Check your local area', icon: 'partly-sunny-outline', onPress: onWeather },
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close menu" style={styles.backdrop} onPress={onClose} />
        <SafeAreaView style={[styles.drawer, { backgroundColor: colors.background, borderColor: colors.border }]} edges={['top', 'bottom']}>
          <View style={styles.profile}>
            <PadiAvatar size={44} online />
            <View style={styles.profileText}>
              <Text style={[styles.profileTitle, { color: colors.text, fontSize: type.subheading }]}>PADI</Text>
              <Text style={[styles.profileSubtitle, { color: colors.muted, fontSize: type.caption }]}>
                {displayName ? `Your companion, ${displayName}` : 'Your companion'}
              </Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close menu" onPress={onClose} hitSlop={8} style={[styles.close, { backgroundColor: colors.cardMuted }]}>
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </Pressable>
          </View>
          <ScrollView style={styles.items} keyboardShouldPersistTaps="handled">
            {items.map((item) => (
              <Pressable
                key={item.title}
                accessibilityRole="button"
                accessibilityLabel={`${item.title}. ${item.subtitle}`}
                onPress={item.onPress}
                style={({ pressed }) => [styles.item, { backgroundColor: pressed ? colors.cardMuted : 'transparent' }]}>
                <View style={[styles.iconChip, { backgroundColor: colors.primarySoft }]}>
                  <Ionicons name={item.icon} size={18} color={colors.primary} />
                </View>
                <View style={styles.itemText}>
                  <Text style={[styles.itemTitle, { color: colors.text, fontSize: type.body }]}>{item.title}</Text>
                  <Text style={[styles.itemSubtitle, { color: colors.muted, fontSize: type.caption }]}>{item.subtitle}</Text>
                </View>
                <Ionicons name="chevron-forward" size={17} color={colors.muted} />
              </Pressable>
            ))}
            {history.length > 0 && <Text accessibilityRole="header" style={[styles.historyTitle, { color: colors.muted }]}>Chat history</Text>}
            {history.map(chat => (
              <Pressable key={chat.id} accessibilityRole="button" accessibilityState={{ selected: chat.id === selectedID }}
                onPress={() => onOpenChat(chat.id)}
                style={[styles.item, { backgroundColor: chat.id === selectedID ? colors.cardMuted : 'transparent' }]}>
                <View style={styles.itemText}>
                  <Text numberOfLines={1} style={[styles.itemTitle, { color: colors.text }]}>{chat.title}</Text>
                  <Text style={[styles.itemSubtitle, { color: colors.muted }]}>{new Date(chat.updatedAt).toLocaleDateString()}</Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable accessibilityRole="button" onPress={onSignOut} style={({ pressed }) => [styles.signOut, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}>
            <Ionicons name="log-out-outline" size={18} color={colors.danger} />
            <Text style={[styles.signOutText, { color: colors.danger, fontSize: type.bodySmall }]}>Sign out</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },
  backdrop: { flex: 1, backgroundColor: 'rgba(8, 15, 30, 0.38)' },
  drawer: { width: 320, maxWidth: '88%', borderRightWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.base, paddingTop: spacing.md, paddingBottom: spacing.base },
  profile: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingBottom: spacing.md },
  profileText: { flex: 1 },
  profileTitle: { fontFamily: fonts.bold },
  profileSubtitle: { fontFamily: fonts.regular },
  close: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  items: { flex: 1 },
  historyTitle: { fontFamily: fonts.semibold, margin: spacing.sm },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm },
  iconChip: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  itemText: { flex: 1, gap: 1 },
  itemTitle: { fontFamily: fonts.semibold },
  itemSubtitle: { fontFamily: fonts.regular },
  signOut: { minHeight: 48, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  signOutText: { fontFamily: fonts.semibold },
});
