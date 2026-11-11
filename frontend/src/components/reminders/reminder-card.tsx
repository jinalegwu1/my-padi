import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fonts, radius, spacing, useColors, useType } from '@/constants/theme';
import { REPEAT_LABELS } from '@/data/mock-reminders';
import { formatDateLabel, formatTimeLabel } from '@/lib/date';
import type { Reminder } from '@/types';

type Props = {
  reminder: Reminder;
  onPress: () => void;
  onToggleDone: () => void;
  doneLabel: string;
  undoneLabel: string;
};

/** One reminder row: time, title, repeat rule and a done toggle. */
export function ReminderCard({ reminder, onPress, onToggleDone, doneLabel, undoneLabel }: Props) {
  const colors = useColors();
  const type = useType();
  const done = reminder.completed;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          opacity: done ? 0.72 : 1,
        },
      ]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${reminder.title}. ${formatDateLabel(reminder.date)} at ${formatTimeLabel(reminder.time)}. ${REPEAT_LABELS[reminder.repeat]}`}
        accessibilityHint="Opens the reminder to edit or cancel it"
        onPress={onPress}
        style={({ pressed }) => [styles.main, pressed && { opacity: 0.7 }]}>
        <View
          style={[
            styles.timeChip,
            { backgroundColor: done ? colors.cardMuted : colors.primarySoft },
          ]}>
          <Text
            style={[
              styles.timeText,
              { color: done ? colors.muted : colors.primary, fontSize: type.caption },
            ]}>
            {formatTimeLabel(reminder.time)}
          </Text>
          <Text style={[styles.dateText, { color: colors.muted, fontSize: type.micro }]}>
            {formatDateLabel(reminder.date)}
          </Text>
        </View>

        <View style={styles.body}>
          <Text
            numberOfLines={2}
            style={[
              styles.title,
              {
                color: done ? colors.muted : colors.text,
                fontSize: type.body,
                textDecorationLine: done ? 'line-through' : 'none',
              },
            ]}>
            {reminder.title}
          </Text>
          <View style={styles.metaRow}>
            <Ionicons
              name={reminder.repeat === 'none' ? 'time-outline' : 'repeat'}
              size={12}
              color={colors.muted}
            />
            <Text style={[styles.meta, { color: colors.muted, fontSize: type.micro }]}>
              {REPEAT_LABELS[reminder.repeat]}
            </Text>
            {reminder.conversationId ? (
              <>
                <View style={[styles.dot, { backgroundColor: colors.borderStrong }]} />
                <Ionicons name="chatbubble-outline" size={11} color={colors.muted} />
                <Text style={[styles.meta, { color: colors.muted, fontSize: type.micro }]}>
                  Conversation
                </Text>
              </>
            ) : null}
          </View>
        </View>
      </Pressable>

      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={done ? undoneLabel : doneLabel}
        onPress={onToggleDone}
        hitSlop={8}
        style={({ pressed }) => [
          styles.check,
          {
            borderColor: done ? colors.success : colors.borderStrong,
            backgroundColor: done ? colors.success : 'transparent',
            opacity: pressed ? 0.7 : 1,
          },
        ]}>
        {done ? <Ionicons name="checkmark" size={15} color="#FFFFFF" /> : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  timeChip: {
    width: 74,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    gap: 1,
  },
  timeText: { fontFamily: fonts.bold },
  dateText: { fontFamily: fonts.medium },
  body: { flex: 1, gap: 3 },
  title: { fontFamily: fonts.semibold },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  meta: { fontFamily: fonts.medium },
  dot: { width: 3, height: 3, borderRadius: 2, marginHorizontal: 2 },
  check: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
