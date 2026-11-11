import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { SegmentedControl } from '@/components/ui/segmented-control';
import { Sheet } from '@/components/ui/sheet';
import { TextField } from '@/components/ui/text-field';
import { Button } from '@/components/ui/button';
import { fonts, radius, spacing, useColors, useType } from '@/constants/theme';
import { REPEAT_LABELS } from '@/data/mock-reminders';
import type { ReminderDraft } from '@/hooks/use-reminders';
import { formatChipDate, formatTimeLabel, timeSlots, upcomingDates } from '@/lib/date';
import type { Reminder, RepeatRule } from '@/types';

type Props = {
  visible: boolean;
  /** Existing reminder when editing, undefined when creating. */
  reminder?: Reminder;
  onClose: () => void;
  onSave: (draft: ReminderDraft) => void;
  onDelete?: (id: string) => void;
  /** Opens the conversation this reminder belongs to. */
  onOpenConversation?: () => void;
  labels: {
    title: string;
    editTitle: string;
    titleField: string;
    titlePlaceholder: string;
    date: string;
    time: string;
    repeat: string;
    notes: string;
    notesPlaceholder: string;
    save: string;
    delete: string;
    cancel: string;
    required: string;
    openConversation: string;
  };
};

const REPEAT_OPTIONS: { value: RepeatRule; label: string }[] = [
  { value: 'none', label: REPEAT_LABELS.none },
  { value: 'daily', label: REPEAT_LABELS.daily },
  { value: 'weekly', label: REPEAT_LABELS.weekly },
  { value: 'monthly', label: REPEAT_LABELS.monthly },
];

/** Create / edit sheet for a reminder. */
export function ReminderEditor({
  visible,
  reminder,
  onClose,
  onSave,
  onDelete,
  onOpenConversation,
  labels,
}: Props) {
  const colors = useColors();
  const type = useType();

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState(upcomingDates(1)[0]);
  const [time, setTime] = useState('18:00');
  const [repeat, setRepeat] = useState<RepeatRule>('none');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setTitle(reminder?.title ?? '');
    setNotes(reminder?.notes ?? '');
    setDate(reminder?.date ?? upcomingDates(1)[0]);
    setTime(reminder?.time ?? '18:00');
    setRepeat(reminder?.repeat ?? 'none');
    setError(null);
  }, [visible, reminder]);

  const dates = upcomingDates(14);
  const slots = timeSlots();

  const handleSave = () => {
    if (!title.trim()) {
      setError(labels.required);
      return;
    }
    onSave({
      id: reminder?.id,
      title: title.trim(),
      notes: notes.trim() || undefined,
      date,
      time,
      repeat,
      conversationId: reminder?.conversationId,
    });
    onClose();
  };

  return (
    <Sheet
      visible={visible}
      title={reminder ? labels.editTitle : labels.title}
      onClose={onClose}
      footer={
        <>
          <Button title={labels.save} onPress={handleSave} icon="checkmark" />
          {reminder?.conversationId && onOpenConversation ? (
            <Button
              title={labels.openConversation}
              variant="soft"
              icon="chatbubble-outline"
              onPress={() => {
                onClose();
                onOpenConversation();
              }}
            />
          ) : null}
          {reminder && onDelete ? (
            <Button
              title={labels.delete}
              variant="ghost"
              icon="trash-outline"
              onPress={() => {
                onDelete(reminder.id);
                onClose();
              }}
            />
          ) : null}
        </>
      }>
      <TextField
        label={labels.titleField}
        placeholder={labels.titlePlaceholder}
        value={title}
        onChangeText={(value) => {
          setTitle(value);
          if (error) setError(null);
        }}
        error={error}
        maxLength={80}
        returnKeyType="done"
      />

      <View style={styles.block}>
        <Text style={[styles.blockLabel, { color: colors.textSecondary, fontSize: type.bodySmall }]}>
          {labels.date}
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {dates.map((iso) => {
            const selected = iso === date;
            const chip = formatChipDate(iso);
            return (
              <Pressable
                key={iso}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={iso}
                onPress={() => setDate(iso)}
                style={({ pressed }) => [
                  styles.dateChip,
                  {
                    backgroundColor: selected ? colors.primary : colors.card,
                    borderColor: selected ? colors.primary : colors.border,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}>
                <Text
                  style={[
                    styles.chipWeekday,
                    { color: selected ? colors.onPrimary : colors.muted, fontSize: type.micro },
                  ]}>
                  {chip.weekday}
                </Text>
                <Text
                  style={[
                    styles.chipDay,
                    { color: selected ? colors.onPrimary : colors.text, fontSize: type.subheading },
                  ]}>
                  {chip.day}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.block}>
        <Text style={[styles.blockLabel, { color: colors.textSecondary, fontSize: type.bodySmall }]}>
          {labels.time}
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {slots.map((slot) => {
            const selected = slot === time;
            return (
              <Pressable
                key={slot}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={formatTimeLabel(slot)}
                onPress={() => setTime(slot)}
                style={({ pressed }) => [
                  styles.timeChip,
                  {
                    backgroundColor: selected ? colors.primary : colors.card,
                    borderColor: selected ? colors.primary : colors.border,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}>
                <Text
                  style={[
                    styles.timeChipText,
                    {
                      color: selected ? colors.onPrimary : colors.textSecondary,
                      fontSize: type.caption,
                    },
                  ]}>
                  {formatTimeLabel(slot)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.block}>
        <Text style={[styles.blockLabel, { color: colors.textSecondary, fontSize: type.bodySmall }]}>
          {labels.repeat}
        </Text>
        <SegmentedControl
          options={REPEAT_OPTIONS}
          value={repeat}
          onChange={setRepeat}
          accessibilityLabel={labels.repeat}
        />
      </View>

      <TextField
        label={labels.notes}
        placeholder={labels.notesPlaceholder}
        value={notes}
        onChangeText={setNotes}
        multiline
        numberOfLines={3}
        maxLength={240}
        style={styles.notesInput}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.sm },
  blockLabel: { fontFamily: fonts.semibold, letterSpacing: 0.2 },
  chipRow: { gap: spacing.sm, paddingVertical: 2 },
  dateChip: {
    width: 52,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    gap: 1,
  },
  chipWeekday: { fontFamily: fonts.medium },
  chipDay: { fontFamily: fonts.bold },
  timeChip: {
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  timeChipText: { fontFamily: fonts.medium },
  notesInput: { minHeight: 84, textAlignVertical: 'top' },
});
