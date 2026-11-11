/** Small date helpers. All local — no date library needed. */

const DAY_MS = 86400000;

export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function fromISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function daysFromToday(iso: string): number {
  const target = fromISODate(iso).getTime();
  const today = startOfToday().getTime();
  return Math.round((target - today) / DAY_MS);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** "Today", "Tomorrow", "Yesterday", "Fri 14 Nov". */
export function formatDateLabel(iso: string): string {
  const diff = daysFromToday(iso);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  const date = fromISODate(iso);
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/** "Fri 14 Nov" — always the explicit date. */
export function formatFullDate(iso: string): string {
  const date = fromISODate(iso);
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** "18:30" → "6:30 PM". */
export function formatTimeLabel(time: string): string {
  const [hRaw, mRaw] = time.split(':');
  const hours = Number(hRaw);
  const minutes = mRaw ?? '00';
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const display = hours % 12 === 0 ? 12 : hours % 12;
  return `${display}:${minutes} ${suffix}`;
}

/** Short weekday + day number, for the date chips. */
export function formatChipDate(iso: string): { weekday: string; day: string } {
  const date = fromISODate(iso);
  return { weekday: WEEKDAYS[date.getDay()], day: `${date.getDate()}` };
}

/** "just now", "12 min ago", "3 h ago", "2 d ago". */
export function formatRelative(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} d ago`;
}

/** Clock time for a chat message, e.g. "6:30 PM". */
export function formatClock(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = date.getHours();
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const display = hours % 12 === 0 ? 12 : hours % 12;
  return `${display}:${minutes} ${suffix}`;
}

/** The next `count` days starting today, as ISO strings. */
export function upcomingDates(count: number): string[] {
  const today = startOfToday();
  return Array.from({ length: count }, (_, i) => toISODate(addDays(today, i)));
}

/** Half-hour time slots from 05:00 to 23:30. */
export function timeSlots(): string[] {
  const slots: string[] = [];
  for (let h = 5; h <= 23; h += 1) {
    slots.push(`${`${h}`.padStart(2, '0')}:00`);
    slots.push(`${`${h}`.padStart(2, '0')}:30`);
  }
  return slots;
}
