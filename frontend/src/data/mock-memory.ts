import type Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';

import type { MemoryCategory, MemoryItem } from '@/types';

/**
 * Examples of what PADI may remember — only ever with the user's permission.
 * Nothing here is collected automatically; these are sample entries the user
 * can review, correct, pause or delete.
 */
export const SEED_MEMORIES: MemoryItem[] = [
  {
    id: 'mem1',
    category: 'name',
    label: 'Preferred name',
    value: 'You asked me to call you “Ada”.',
    createdAt: Date.now() - 12 * 86400000,
    paused: false,
    source: 'You told PADI during setup',
  },
  {
    id: 'mem2',
    category: 'interests',
    label: 'Interests and hobbies',
    value: 'You enjoy football, Afrobeats and dancing on weekends.',
    createdAt: Date.now() - 9 * 86400000,
    paused: false,
    source: 'You told PADI in chat',
  },
  {
    id: 'mem3',
    category: 'relationships',
    label: 'Important relationships',
    value: 'Chidi is your younger brother; you help him with homework.',
    createdAt: Date.now() - 7 * 86400000,
    paused: false,
    source: 'You told PADI in chat',
  },
  {
    id: 'mem4',
    category: 'preferences',
    label: 'Personal preferences',
    value: 'You prefer short answers first, then more detail if you ask.',
    createdAt: Date.now() - 5 * 86400000,
    paused: false,
    source: 'You told PADI in chat',
  },
  {
    id: 'mem5',
    category: 'plans',
    label: 'Important plans and events',
    value: 'You are preparing a sermon on patience for Sunday.',
    createdAt: Date.now() - 2 * 86400000,
    paused: false,
    source: 'You told PADI in chat',
  },
  {
    id: 'mem6',
    category: 'preferences',
    label: 'Personal preferences',
    value: 'You do not like being reminded about work after 8pm.',
    createdAt: Date.now() - 1 * 86400000,
    paused: true,
    source: 'You told PADI in chat',
  },
];

export const MEMORY_CATEGORY_META: Record<
  MemoryCategory,
  { label: string; description: string; icon: ComponentProps<typeof Ionicons>['name'] }
> = {
  name: {
    label: 'Preferred name',
    description: 'What you would like PADI to call you.',
    icon: 'person-outline',
  },
  interests: {
    label: 'Interests and hobbies',
    description: 'Things you enjoy talking about.',
    icon: 'heart-outline',
  },
  relationships: {
    label: 'Important relationships',
    description: 'People who matter to you.',
    icon: 'people-outline',
  },
  preferences: {
    label: 'Personal preferences',
    description: 'How you like PADI to talk and help.',
    icon: 'options-outline',
  },
  plans: {
    label: 'Important plans and events',
    description: 'Things coming up that you care about.',
    icon: 'calendar-outline',
  },
};

export const MEMORY_CATEGORY_ORDER: MemoryCategory[] = [
  'name',
  'interests',
  'relationships',
  'preferences',
  'plans',
];
