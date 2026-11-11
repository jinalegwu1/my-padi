import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ReminderCard } from '@/components/reminders/reminder-card';
import { ReminderEditor } from '@/components/reminders/reminder-editor';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { fonts, radius, spacing, useColors, useType } from '@/constants/theme';
import { useReminders } from '@/hooks/use-reminders';
import { useTranslation } from '@/hooks/use-translation';
import type { Reminder } from '@/types';

/**
 * Reminders screen: upcoming, repeating and completed.
 * Reminders live on this phone only — no background notification is scheduled.
 */
export default function RemindersScreen() {
  const router = useRouter();
  const colors = useColors();
  const type = useType();
  const { t } = useTranslation();
  const { groups, status, save, toggleCompleted, remove } = useReminders();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Reminder | undefined>(undefined);
  const [pendingDelete, setPendingDelete] = useState<Reminder | undefined>(undefined);

  const sections = useMemo(
    () =>
      [
        { title: t('reminders.upcoming'), data: groups.upcoming },
        { title: t('reminders.repeating'), data: groups.repeating },
        { title: t('reminders.completed'), data: groups.completed },
      ].filter((section) => section.data.length > 0),
    [groups, t],
  );

  const openNew = () => {
    setEditing(undefined);
    setEditorOpen(true);
  };

  const openEdit = (reminder: Reminder) => {
    setEditing(reminder);
    setEditorOpen(true);
  };

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
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: colors.text, fontSize: type.title }]}>
            {t('reminders.title')}
          </Text>
          <Text style={[styles.subtitle, { color: colors.muted, fontSize: type.caption }]}>
            {t('reminders.subtitle')}
          </Text>
        </View>
        <Button
          title={t('reminders.add')}
          size="sm"
          icon="add"
          fullWidth={false}
          onPress={openNew}
        />
      </View>

      <View
        style={[
          styles.notice,
          { backgroundColor: colors.warningSoft, borderColor: colors.border },
        ]}>
        <Ionicons name="information-circle-outline" size={15} color={colors.warning} />
        <Text style={[styles.noticeText, { color: colors.warning, fontSize: type.micro }]}>
          {t('reminders.notice')}
        </Text>
      </View>

      {sections.length === 0 ? (
        <EmptyState
          icon="alarm-outline"
          title={t('reminders.empty')}
          message="Add your first reminder and PADI will keep it here for you."
          actionTitle={t('reminders.add')}
          onAction={openNew}
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            <Text
              style={[
                styles.sectionTitle,
                { color: colors.muted, fontSize: type.micro, backgroundColor: colors.background },
              ]}>
              {section.title.toUpperCase()} · {section.data.length}
            </Text>
          )}
          renderItem={({ item }) => (
            <ReminderCard
              reminder={item}
              onPress={() => openEdit(item)}
              onToggleDone={() => toggleCompleted(item.id)}
              doneLabel={t('reminders.markDone')}
              undoneLabel={t('reminders.markUndone')}
            />
          )}
        />
      )}

      <ReminderEditor
        visible={editorOpen}
        reminder={editing}
        onClose={() => setEditorOpen(false)}
        onSave={save}
        onDelete={(id) => {
          const found = groups.upcoming
            .concat(groups.repeating, groups.completed)
            .find((r) => r.id === id);
          if (found) setPendingDelete(found);
        }}
        labels={{
          title: t('reminders.add'),
          editTitle: t('reminders.edit'),
          titleField: t('reminders.form.title'),
          titlePlaceholder: 'e.g. Call Mum',
          date: t('reminders.form.date'),
          time: t('reminders.form.time'),
          repeat: t('reminders.form.repeat'),
          notes: t('reminders.form.notes'),
          notesPlaceholder: 'Anything you want to remember about this.',
          save: t('reminders.form.save'),
          delete: t('reminders.form.delete'),
          cancel: t('common.cancel'),
          required: 'Please give the reminder a title.',
          openConversation: t('reminders.openChat'),
        }}
        onOpenConversation={() => router.push('/(tabs)/chat')}
      />

      <ConfirmDialog
        visible={!!pendingDelete}
        title={t('reminders.cancel')}
        message={pendingDelete ? `“${pendingDelete.title}” will be removed from this phone.` : ''}
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
  headerText: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.extrabold, letterSpacing: -0.4 },
  subtitle: { fontFamily: fonts.regular },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginHorizontal: spacing.base,
    marginBottom: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  noticeText: { flex: 1, fontFamily: fonts.medium, lineHeight: 16 },
  list: { paddingHorizontal: spacing.base, paddingBottom: spacing.xxl, gap: spacing.sm },
  sectionTitle: {
    fontFamily: fonts.bold,
    letterSpacing: 0.8,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
});
