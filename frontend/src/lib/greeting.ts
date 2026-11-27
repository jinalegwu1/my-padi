import type { CheckInCue, Message } from '@/types';

// Only public, impersonal words can travel between conversations. Never copy a
// user's messages, names or snippets of a previous reply into a new check-in.
const topics = [
  'plantain', 'rain', 'headphones', 'football', 'slippers', 'alarm', 'biscuits',
  'bus', 'charger', 'kettle', 'playlist', 'remote', 'pockets', 'umbrella',
  'jollof', 'socks', 'keys', 'mug', 'toast', 'queue', 'popcorn', 'pen',
];
const welcomes = ['my padi', 'how body', 'how far', 'welcome back', 'good to see you', 'how are you', 'how dey go'];

export function nextCheckIn(messages: Message[], userID: string): CheckInCue {
  const recent = messages.filter(m => m.backendUserID === userID && m.backendChat && m.role === 'padi' && !m.pending);
  const used = new Set<string>();
  const openingPhrases = new Set<string>();
  for (const message of recent.slice(-60)) {
    const words = message.text.toLowerCase();
    if (message.checkIn && topics.includes(message.checkIn.gist_seed)) {
      used.delete(message.checkIn.gist_seed);
      used.add(message.checkIn.gist_seed);
      for (const phrase of welcomes) {
        if (words.includes(phrase)) {
          openingPhrases.delete(phrase);
          openingPhrases.add(phrase);
        }
      }
    }
    for (const topic of topics) {
      if (new RegExp(`\\b${topic}s?\\b`).test(words)) {
        used.delete(topic);
        used.add(topic);
      }
    }
  }
  const fresh = topics.filter(topic => !used.has(topic));
  const seed = fresh.length ? fresh[Math.floor(Math.random() * fresh.length)] : [...used][0];
  return {
    gist_seed: seed,
    recent_topics: [...used].filter(topic => topic !== seed).slice(-8),
    recent_welcomes: [...openingPhrases].slice(-4),
  };
}

export function greetingRequest(cue?: CheckInCue): string {
  return cue ? 'Hi\n' + JSON.stringify({ ...cue, source: 'app_generated_conversation_starter' }) : 'Hi';
}
