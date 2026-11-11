import { useCallback, useMemo } from 'react';

import { SEED_REMINDERS } from '@/data/mock-reminders';
import { usePersistentState } from '@/hooks/use-persistent-state';
import { daysFromToday } from '@/lib/date';
import type { Reminder } from '@/types';

export type ReminderDraft = Omit<Reminder, 'id' | 'createdAt' | 'completed'> & {
  id?: string;
};

/**
 * Reminder state, stored on the phone only.
 * No background notification is scheduled — the UI is honest about that.
 */
export function useReminders() {
  const [reminders, setReminders, status] = usePersistentState<Reminder[]>(
    'reminders',
    SEED_REMINDERS,
  );

  const save = useCallback(
    (draft: ReminderDraft) => {
      setReminders((prev) => {
        if (draft.id) {
          return prev.map((r) => (r.id === draft.id ? { ...r, ...draft, id: r.id } : r));
        }
        const created: Reminder = {
          ...draft,
          id: `r_${Date.now().toString(36)}`,
          completed: false,
          createdAt: Date.now(),
        };
        return [created, ...prev];
      });
    },
    [setReminders],
  );

  const toggleCompleted = useCallback(
    (id: string) => {
      setReminders((prev) => prev.map((r) => (r.id === id ? { ...r, completed: !r.completed } : r)));
    },
    [setReminders],
  );

  const remove = useCallback(
    (id: string) => {
      setReminders((prev) => prev.filter((r) => r.id !== id));
    },
    [setReminders],
  );

  const groups = useMemo(() => {
    const active = reminders.filter((r) => !r.completed);
    const byTime = (a: Reminder, b: Reminder) =>
      `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`);

    return {
      upcoming: active
        .filter((r) => r.repeat === 'none' && daysFromToday(r.date) >= 0)
        .sort(byTime),
      repeating: active.filter((r) => r.repeat !== 'none').sort(byTime),
      completed: reminders.filter((r) => r.completed).sort(byTime),
    };
  }, [reminders]);

  return { reminders, groups, status, save, toggleCompleted, remove };
}
