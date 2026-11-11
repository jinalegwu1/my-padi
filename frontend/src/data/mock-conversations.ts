import type { ChatSuggestion, Message } from '@/types';

/**
 * Sample conversation used to demonstrate the interface.
 * These are mock messages — no AI service is connected.
 */

let seq = 0;
export function nextId(prefix = 'm'): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

const MINUTE = 60 * 1000;
const now = Date.now();

export const WELCOME_MESSAGE = 'Hey! 😊 Good to see you. What are we talking about today?';

export const SEED_MESSAGES: Message[] = [
  {
    id: 'seed_1',
    role: 'padi',
    text: WELCOME_MESSAGE,
    createdAt: now - 6 * MINUTE,
  },
  {
    id: 'seed_2',
    role: 'user',
    text: 'I have a maths test on Friday and I still don’t get fractions.',
    createdAt: now - 5 * MINUTE,
  },
  {
    id: 'seed_3',
    role: 'padi',
    text: 'No wahala — we’ll take it slowly. Think of a fraction as a slice of a pizza: the bottom number tells you how many slices the pizza was cut into, and the top number tells you how many you took. 🍕',
    createdAt: now - 4 * MINUTE,
    visual: {
      type: 'steps',
      title: 'Fractions in three small steps',
      caption: 'Say it out loud as you go — it sticks faster.',
      steps: [
        { title: '1. Cut the whole', detail: 'The bottom number (denominator) is how many equal pieces.' },
        { title: '2. Take your share', detail: 'The top number (numerator) is how many pieces you have.' },
        { title: '3. Compare', detail: 'Same bottom number? Then the bigger top number wins.' },
      ],
    },
  },
  {
    id: 'seed_4',
    role: 'user',
    text: 'Okay that makes sense. Can you show me a picture?',
    createdAt: now - 3 * MINUTE,
  },
  {
    id: 'seed_5',
    role: 'padi',
    text: 'Here’s a picture of the water cycle — it’s the same idea of parts making a whole. Notice how the water keeps moving in a loop. 🌧️',
    createdAt: now - 2 * MINUTE,
    visual: {
      type: 'image',
      title: 'The water cycle',
      caption: 'Evaporation → condensation → precipitation → collection.',
      imageUrl: 'waterCycle',
      aspectRatio: 1.83,
    },
  },
];

/** Quick-start chips shown above the composer. */
export const SUGGESTIONS: ChatSuggestion[] = [
  { id: 's1', label: 'Explain something', prompt: 'Explain photosynthesis like I’m 10 years old.', icon: 'bulb-outline' },
  { id: 's2', label: 'Bible study', prompt: 'Help me prepare a short sermon on patience.', icon: 'book-outline' },
  { id: 's3', label: 'Homework', prompt: 'My child needs help with long division.', icon: 'school-outline' },
  { id: 's4', label: 'Football', prompt: 'Who won the match last night and why?', icon: 'football-outline' },
  { id: 's5', label: 'Write for me', prompt: 'Draft a polite email asking for a deadline extension.', icon: 'create-outline' },
  { id: 's6', label: 'Tell me a joke', prompt: 'Tell me a clean joke I can share with my friends.', icon: 'happy-outline' },
  { id: 's7', label: 'Business idea', prompt: 'Help me think through a small business idea.', icon: 'briefcase-outline' },
  { id: 's8', label: 'Music & dancing', prompt: 'Suggest songs for a wedding dance practice.', icon: 'musical-notes-outline' },
];

/** A second, older thread so the app feels lived-in. */
export const SEED_THREADS = [
  {
    id: 'thread_sermon',
    title: 'Sermon on patience',
    preview: 'Here’s an outline with three points and a short illustration…',
    updatedAt: now - 26 * 60 * MINUTE,
  },
  {
    id: 'thread_football',
    title: 'Last night’s match',
    preview: 'The midfield press was the difference in the second half…',
    updatedAt: now - 3 * 24 * 60 * MINUTE,
  },
  {
    id: 'thread_business',
    title: 'Small business idea',
    preview: 'Let’s test the idea with five customers before you spend…',
    updatedAt: now - 6 * 24 * 60 * MINUTE,
  },
];
