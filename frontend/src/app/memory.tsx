import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Sheet } from '@/components/ui/sheet';
import { TextField } from '@/components/ui/text-field';
import { fonts, radius, spacing, useColors, useType } from '@/constants/theme';
import { MEMORY_CATEGORY_META } from '@/data/mock-memory';
import { useMemory } from '@/hooks/use-memory';
import { usePreferences } from '@/hooks/use-preferences';
import { useTranslation } from '@/hooks/use-translation';
import { formatRelative } from '@/lib/date';
import type { MemoryItem } from '@/types';

/**
 * Memory management: review, correct, pause and delete what PADI remembers.
 * Nothing is collected automatically — every entry came from the user.
 */
export default function MemoryScreen() {
  const router = useRouter();
  const colors = useColors();
  const type = useType();
  const { t } = useTranslation();
  const { preferences, update } = usePreferences();
  const { grouped, counts, status, correct, togglePaused, remove } = useMemory();

  const [editing, setEditing] = useState<MemoryItem | undefined>(undefined);
  const [draft, setDraft] = useState('');
  const [pendingDelete, setPendingDelete] = useState<MemoryItem | undefined>(undefined);

  if (status === 'loading') {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[styles.root, { backgroundColor: colors.background }]}
      edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('onboarding.back')}
          onPress={() => router.back()}
          hitSlop={10}
          style={({ pressed }) => [
            styles.back,
            { backgroundColor: colors.cardMuted },
            pressed && { opacity: 0.7 },
          ]}>
          <Ionicons name="arrow-back" size={19} color={colors.textSecondary} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: colors.text, fontSize: type.title }]}>
            {t('memory.title')}
          </Text>
          <Text style={[styles.subtitle, { color: colors.muted, fontSize: type.caption }]}>
            {t('memory.subtitle')}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
        {/* Consent banner */}
        <View
          style={[
            styles.consent,
            {
              backgroundColor: preferences.memoryEnabled ? colors.successSoft : colors.warningSoft,
              borderColor: colors.border,
            },
          ]}>
          <Ionicons
            name={preferences.memoryEnabled ? 'shield-checkmark-outline' : 'pause-circle-outline'}
            size={18}
            color={preferences.memoryEnabled ? colors.success : colors.warning}
          />
          <View style={styles.consentText}>
            <Text
              style={[
                styles.consentTitle,
                {
                  color: preferences.memoryEnabled ? colors.success : colors.warning,
                  fontSize: type.bodySmall,
                },
              ]}>
              {preferences.memoryEnabled ? t('memory.consent') : t('memory.consentOff')}
            </Text>
            <Text style={[styles.consentBody, { color: colors.textSecondary, fontSize: type.micro }]}>
              {counts.active} in use · {counts.paused} paused · {counts.total} total
            </Text>
          </View>
        </View>

        <View
          style={[
            styles.masterRow,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}>
          <Text style={[styles.masterLabel, { color: colors.text, fontSize: type.body }]}>
            Allow PADI to remember
          </Text>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: preferences.memoryEnabled }}
            accessibilityLabel="Allow PADI to remember"
            onPress={() => update({ memoryEnabled: !preferences.memoryEnabled })}
            style={({ pressed }) => [
              styles.masterButton,
              {
                backgroundColor: preferences.memoryEnabled ? colors.primary : colors.cardMuted,
                borderColor: preferences.memoryEnabled ? colors.primary : colors.border,
                opacity: pressed ? 0.8 : 1,
              },
            ]}>
            <Text
              style={[
                styles.masterButtonText,
                {
                  color: preferences.memoryEnabled ? colors.onPrimary : colors.textSecondary,
                  fontSize: type.caption,
                },
              ]}>
              {preferences.memoryEnabled ? 'On' : 'Off'}
            </Text>
          </Pressable>
        </View>

        {grouped.length === 0 ? (
          <EmptyState
            icon="sparkles-outline"
            title={t('memory.empty')}
            message="When you tell PADI something worth keeping, it will appear here for you to review."
          />
        ) : (
          grouped.map((group) => {
            const meta = MEMORY_CATEGORY_META[group.category];
            return (
              <View key={group.category} style={styles.group}>
                <View style={styles.groupHeader}>
                  <View style={[styles.groupIcon, { backgroundColor: colors.accentSoft }]}>
                    <Ionicons name={meta.icon} size={16} color={colors.accent} />
                  </View>
                  <View style={styles.groupText}>
                    <Text style={[styles.groupTitle, { color: colors.text, fontSize: type.subheading }]}>
                      {meta.label}
                    </Text>
                    <Text style={[styles.groupDesc, { color: colors.muted, fontSize: type.micro }]}>
                      {meta.description}
                    </Text>
                  </View>
                </View>

                {group.items.map((item) => (
                  <View
                    key={item.id}
                    style={[
                      styles.item,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                        opacity: item.paused ? 0.7 : 1,
                      },
                    ]}>
                    <View style={styles.itemTop}>
                      <Text style={[styles.itemLabel, { color: colors.muted, fontSize: type.micro }]}>
                        {item.label.toUpperCase()}
                      </Text>
                      <View
                        style={[
                          styles.statusPill,
                          {
                            backgroundColor: item.paused ? colors.cardMuted : colors.successSoft,
                          },
                        ]}>
                        <Text
                          style={[
                            styles.statusText,
                            {
                              color: item.paused ? colors.muted : colors.success,
                              fontSize: type.micro,
                            },
                          ]}>
                          {item.paused ? t('memory.paused') : t('memory.active')}
                        </Text>
                      </View>
                    </View>

                    <Text
                      style={[
                        styles.itemValue,
                        {
                          color: colors.text,
                          fontSize: type.body,
                          lineHeight: type.lineHeight(type.body),
                        },
                      ]}>
                      {item.value}
                    </Text>

                    <Text style={[styles.itemSource, { color: colors.muted, fontSize: type.micro }]}>
                      {t('memory.source')}: {item.source} · {formatRelative(item.createdAt)}
                    </Text>

                    <View style={styles.itemActions}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${t('memory.correct')}: ${item.label}`}
                        onPress={() => {
                          setEditing(item);
                          setDraft(item.value);
                        }}
                        style={({ pressed }) => [
                          styles.action,
                          { backgroundColor: colors.cardMuted, opacity: pressed ? 0.7 : 1 },
                        ]}>
                        <Ionicons name="create-outline" size={14} color={colors.textSecondary} />
                        <Text
                          style={[styles.actionText, { color: colors.textSecondary, fontSize: type.micro }]}>
                          {t('memory.correct')}
                        </Text>
                      </Pressable>

                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${item.paused ? t('memory.resume') : t('memory.pause')}: ${item.label}`}
                        onPress={() => togglePaused(item.id)}
                        style={({ pressed }) => [
                          styles.action,
                          { backgroundColor: colors.cardMuted, opacity: pressed ? 0.7 : 1 },
                        ]}>
                        <Ionicons
                          name={item.paused ? 'play-outline' : 'pause-outline'}
                          size={14}
                          color={colors.textSecondary}
                        />
                        <Text
                          style={[styles.actionText, { color: colors.textSecondary, fontSize: type.micro }]}>
                          {item.paused ? t('memory.resume') : t('memory.pause')}
                        </Text>
                      </Pressable>

                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${t('memory.delete')}: ${item.label}`}
                        onPress={() => setPendingDelete(item)}
                        style={({ pressed }) => [
                          styles.action,
                          { backgroundColor: colors.dangerSoft, opacity: pressed ? 0.7 : 1 },
                        ]}>
                        <Ionicons name="trash-outline" size={14} color={colors.danger} />
                        <Text style={[styles.actionText, { color: colors.danger, fontSize: type.micro }]}>
                          {t('memory.delete')}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            );
          })
        )}
      </ScrollView>

      <Sheet
        visible={!!editing}
        title={t('memory.editTitle')}
        subtitle={editing?.label}
        onClose={() => setEditing(undefined)}
        footer={
          <Button
            title={t('memory.save')}
            icon="checkmark"
            onPress={() => {
              if (editing && draft.trim()) correct(editing.id, draft.trim());
              setEditing(undefined);
            }}
          />
        }>
        <TextField
          label={t('memory.correct')}
          value={draft}
          onChangeText={setDraft}
          multiline
          numberOfLines={3}
          maxLength={240}
          style={styles.editInput}
        />
      </Sheet>

      <ConfirmDialog
        visible={!!pendingDelete}
        title={t('memory.deleteTitle')}
        message={t('memory.deleteBody')}
        confirmTitle={t('common.delete')}
        cancelTitle={t('common.cancel')}
        destructive
        onCancel={() => setPendingDelete(undefined)}
        onConfirm={() => {
          if (pendingDelete) remove(pendingDelete.id);
          setPendingDelete(undefined);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.base,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  back: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.extrabold, letterSpacing: -0.4 },
  subtitle: { fontFamily: fonts.regular },
  content: { paddingHorizontal: spacing.base, paddingBottom: spacing.xxxl, gap: spacing.base },
  consent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.base,
  },
  consentText: { flex: 1, gap: 2 },
  consentTitle: { fontFamily: fonts.semibold, lineHeight: 19 },
  consentBody: { fontFamily: fonts.regular },
  masterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
  },
  masterLabel: { flex: 1, fontFamily: fonts.medium },
  masterButton: {
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  masterButtonText: { fontFamily: fonts.semibold },
  group: { gap: spacing.sm },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm },
  groupIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupText: { flex: 1, gap: 1 },
  groupTitle: { fontFamily: fonts.semibold },
  groupDesc: { fontFamily: fonts.regular },
  item: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.base,
    gap: spacing.sm,
  },
  itemTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  itemLabel: { fontFamily: fonts.bold, letterSpacing: 0.7 },
  statusPill: { borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  statusText: { fontFamily: fonts.semibold },
  itemValue: { fontFamily: fonts.regular },
  itemSource: { fontFamily: fonts.regular },
  itemActions: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  actionText: { fontFamily: fonts.semibold },
  editInput: { minHeight: 84, textAlignVertical: 'top' },
});
