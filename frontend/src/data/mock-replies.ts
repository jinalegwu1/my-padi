import type { Message, VisualBlock } from '@/types';

import { nextId } from './mock-conversations';

/**
 * Local, rule-based reply engine.
 *
 * This is deliberately a mock: it matches a few keywords and returns a canned
 * answer so the interface can be demonstrated. No AI service is called and no
 * message leaves the phone.
 */

type Reply = {
  text: string;
  visual?: VisualBlock;
};

type Rule = {
  id: string;
  keywords: string[];
  reply: Reply;
};

const RULES: Rule[] = [
  {
    id: 'fractions',
    keywords: ['fraction', 'maths', 'math', 'division', 'homework', 'algebra'],
    reply: {
      text: 'Let’s break it down together. A fraction is just a part of a whole — like slices of a pizza. 🍕 Tell me the exact question and I’ll walk you through it step by step.',
      visual: {
        type: 'steps',
        title: 'How we’ll work through it',
        steps: [
          { title: '1. Read it twice', detail: 'Say the question in your own words first.' },
          { title: '2. Find what you know', detail: 'Write down the numbers and what they mean.' },
          { title: '3. Solve one small step', detail: 'Then check it before moving on.' },
        ],
      },
    },
  },
  {
    id: 'water-cycle',
    keywords: ['water cycle', 'rain', 'evaporation', 'weather', 'science'],
    reply: {
      text: 'The water cycle is nature’s recycling system. Water evaporates from the sea, forms clouds, falls as rain, and flows back — over and over. 🌧️',
      visual: {
        type: 'image',
        title: 'The water cycle',
        caption: 'Evaporation → condensation → precipitation → collection.',
        imageUrl: 'waterCycle',
        aspectRatio: 1.83,
      },
    },
  },
  {
    id: 'space',
    keywords: ['space', 'planet', 'solar system', 'moon', 'star', 'astronomy'],
    reply: {
      text: 'Our solar system has eight planets orbiting the Sun. The four closest are rocky, the four furthest are giant balls of gas and ice. 🪐',
      visual: {
        type: 'image',
        title: 'The solar system',
        caption: 'Mercury to Neptune, in order from the Sun.',
        imageUrl: 'solarSystem',
        aspectRatio: 1.83,
      },
    },
  },
  {
    id: 'football',
    keywords: ['football', 'match', 'soccer', 'goal', 'league', 'sport', 'team'],
    reply: {
      text: 'Great game to talk about! ⚽ The match turned on the midfield press — one team kept winning the ball high up the pitch and the other never settled. Here’s the shape I mean:',
      visual: {
        type: 'image',
        title: 'The pressing shape',
        caption: 'Blue wins the ball high; purple is forced to play long.',
        imageUrl: 'football',
        aspectRatio: 1.83,
      },
    },
  },
  {
    id: 'sermon',
    keywords: ['sermon', 'bible', 'scripture', 'preach', 'psalm', 'faith', 'church'],
    reply: {
      text: 'I’d love to help you prepare. 🙏 Here’s a simple three-point outline you can build on — I’ve kept it short so it’s easy to remember while you’re speaking.',
      visual: {
        type: 'list',
        title: 'Outline: Patience that holds',
        caption: 'Three points, one illustration, one application.',
        items: [
          'Point 1 — Patience is strength under control, not weakness.',
          'Point 2 — Patience grows in the waiting, not in the rush.',
          'Point 3 — Patience is a gift you give the people around you.',
          'Illustration — a farmer who waits for the harvest.',
          'Application — one place this week where you will choose to wait well.',
        ],
      },
    },
  },
  {
    id: 'email',
    keywords: ['email', 'letter', 'write', 'draft', 'message', 'document', 'cv', 'resume'],
    reply: {
      text: 'Here’s a draft you can edit. I kept it warm but professional — short enough that it actually gets read. ✍️',
      visual: {
        type: 'list',
        title: 'Draft: deadline extension',
        items: [
          'Subject: Request for a short extension on [assignment]',
          'Dear [Name], I hope you are well.',
          'I am writing to ask for a short extension on [assignment], currently due [date].',
          'I have completed [progress] and need [time] more to finish it properly.',
          'Thank you for considering my request. I am happy to share my progress so far.',
          'Kind regards, [Your name]',
        ],
      },
    },
  },
  {
    id: 'joke',
    keywords: ['joke', 'funny', 'laugh', 'riddle', 'game', 'play'],
    reply: {
      text: 'Okay, here’s one: Why did the maths book look so sad? Because it had too many problems. 😄 Want another one, or shall we try a riddle?',
    },
  },
  {
    id: 'music',
    keywords: ['music', 'song', 'dance', 'dancing', 'afrobeats', 'sing', 'playlist'],
    reply: {
      text: 'Music and dancing are the best kind of homework. 🎶 Tell me the occasion and the mood you want, and I’ll suggest a short set that builds from calm to full celebration.',
      visual: {
        type: 'list',
        title: 'A set that builds',
        items: [
          'Warm-up — something slow and easy to find the rhythm.',
          'Build — mid-tempo, everyone can join in.',
          'Peak — the song everybody knows.',
          'Cool down — one gentle track to finish.',
        ],
      },
    },
  },
  {
    id: 'business',
    keywords: ['business', 'startup', 'money', 'customer', 'market', 'technology', 'tech', 'code', 'software'],
    reply: {
      text: 'Let’s think it through properly. 💡 Before spending anything, test the idea with real people — five conversations will teach you more than five weeks of planning.',
      visual: {
        type: 'steps',
        title: 'A simple way to test an idea',
        steps: [
          { title: '1. Write the promise', detail: 'One sentence: who it helps and how.' },
          { title: '2. Talk to five people', detail: 'Ask what they do today instead.' },
          { title: '3. Charge something small', detail: 'Payment is the only honest signal.' },
        ],
      },
    },
  },
  {
    id: 'reminder',
    keywords: ['remind', 'reminder', 'remember to', 'schedule', 'appointment'],
    reply: {
      text: 'I can help you keep track of that. 📅 Open the Reminders screen and add it there — you can set a one-time or repeating reminder, and edit or cancel it any time. (Reminders are stored on this phone only for now.)',
    },
  },
  {
    id: 'memory',
    keywords: ['remember me', 'my name', 'memory', 'forget', 'privacy'],
    reply: {
      text: 'You’re in control of that. 🧠 I only keep something if you say yes, and you can review, correct, pause or delete anything I remember from Settings → Memory.',
    },
  },
  {
    id: 'greeting',
    keywords: ['hello', 'hi', 'hey', 'good morning', 'good evening', 'how are you', 'how you dey'],
    reply: {
      text: 'I’m well, thank you for asking! 😊 I’m glad you’re here. What’s on your mind today — something to learn, something to write, or just a good conversation?',
    },
  },
  {
    id: 'thanks',
    keywords: ['thank', 'thanks', 'appreciate', 'well done'],
    reply: {
      text: 'Any time. 💙 I enjoy this. Come back whenever you want to talk — I’ll be here.',
    },
  },
];

const FALLBACKS: Reply[] = [
  {
    text: 'I hear you. Tell me a little more and I’ll help you think it through — I can explain, write, plan or just listen. 💙',
  },
  {
    text: 'That’s interesting. Let’s take it one step at a time. What would be most useful first: an explanation, a plan, or a draft you can edit?',
  },
  {
    text: 'Got it. I can go deeper on that, or we can keep it light. Which would you prefer?',
  },
];

let fallbackIndex = 0;

/** Picks a canned reply for the user's text. Deterministic and offline. */
export function buildReply(userText: string): Reply {
  const text = userText.toLowerCase();
  const match = RULES.find((rule) => rule.keywords.some((k) => text.includes(k)));
  if (match) return match.reply;
  const reply = FALLBACKS[fallbackIndex % FALLBACKS.length];
  fallbackIndex += 1;
  return reply;
}

/** Builds the pending PADI message that is shown while the reply is "composed". */
export function buildPendingMessage(): Message {
  return {
    id: nextId('pending'),
    role: 'padi',
    text: '',
    createdAt: Date.now(),
    pending: true,
  };
}

/** Turns a reply into a finished message. */
export function buildReplyMessage(reply: Reply): Message {
  return {
    id: nextId('padi'),
    role: 'padi',
    text: reply.text,
    createdAt: Date.now(),
    visual: reply.visual,
  };
}

/** Lines PADI "speaks" in the simulated voice session. */
export const VOICE_SCRIPT: { user: string; padi: string }[] = [
  {
    user: 'Hey PADI, can you help me understand something?',
    padi: 'Of course. I’m listening — take your time and tell me what you’re working on.',
  },
  {
    user: 'I want to explain photosynthesis to my little cousin.',
    padi: 'Nice one. Plants are like tiny kitchens: they take in sunlight, water and air, and cook their own food. The green colour, chlorophyll, is the chef.',
  },
  {
    user: 'That’s a good way to put it.',
    padi: 'I’m glad it helps. Want me to turn that into three simple sentences you can say out loud?',
  },
];
