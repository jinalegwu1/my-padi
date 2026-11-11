import type { Reminder } from '@/types';

/**
 * Sample reminders. Stored on the phone only — no background notifications are
 * scheduled yet, and nothing is sent anywhere.
 */
export const SEED_REMINDERS: Reminder[] = [
  {
    id: 'r1',
    title: 'Call Mum',
    notes: 'Ask about the family meeting on Sunday.',
    date: '2026-11-11',
    time: '19:00',
    repeat: 'weekly',
    completed: false,
    conversationId: 'thread_family',
    createdAt: Date.now() - 5 * 86400000,
  },
  {
    id: 'r2',
    title: 'Maths revision with Ada',
    notes: 'Fractions and long division — 30 minutes.',
    date: '2026-11-12',
    time: '17:30',
    repeat: 'none',
    completed: false,
    conversationId: 'thread_homework',
    createdAt: Date.now() - 3 * 86400000,
  },
  {
    id: 'r3',
    title: 'Sermon outline for Sunday',
    notes: 'Three points on patience, plus one illustration.',
    date: '2026-11-14',
    time: '09:00',
    repeat: 'none',
    completed: false,
    conversationId: 'thread_sermon',
    createdAt: Date.now() - 2 * 86400000,
  },
  {
    id: 'r4',
    title: 'Pay electricity bill',
    date: '2026-11-15',
    time: '08:00',
    repeat: 'monthly',
    completed: false,
    createdAt: Date.now() - 20 * 86400000,
  },
  {
    id: 'r5',
    title: 'Football training',
    notes: 'Bring the blue boots.',
    date: '2026-11-13',
    time: '06:30',
    repeat: 'weekly',
    completed: false,
    createdAt: Date.now() - 30 * 86400000,
  },
  {
    id: 'r6',
    title: 'Send the report to Chidi',
    date: '2026-11-10',
    time: '16:00',
    repeat: 'none',
    completed: true,
    conversationId: 'thread_business',
    createdAt: Date.now() - 6 * 86400000,
  },
  {
    id: 'r7',
    title: 'Drink water',
    date: '2026-11-11',
    time: '12:00',
    repeat: 'daily',
    completed: true,
    createdAt: Date.now() - 10 * 86400000,
  },
];

export const REPEAT_LABELS: Record<Reminder['repeat'], string> = {
  none: 'One time',
  daily: 'Every day',
  weekly: 'Every week',
  monthly: 'Every month',
};
