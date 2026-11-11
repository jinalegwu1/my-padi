/** Shared domain types for My PADI. Frontend-only: everything here is local state. */

export type AppearanceMode = 'system' | 'light' | 'dark';

export type VoiceGender = 'female' | 'male';

export type VoiceOption = {
  id: string;
  name: string;
  gender: VoiceGender;
  accent: string;
  description: string;
  /** Short line used by the simulated preview player. */
  sample: string;
};

export type Country = {
  code: string;
  name: string;
  flag: string;
  dialCode: string;
};

export type LanguageOption = {
  code: string;
  label: string;
  nativeLabel: string;
  /** Shown under the label in the picker. */
  note?: string;
  /** True for the three English/Pidgin variants that must stay distinct. */
  featured?: boolean;
};

export type MessageRole = 'user' | 'padi';

export type VisualBlock =
  | {
      type: 'image';
      title: string;
      caption: string;
      /** Remote illustration used as a visual explanation. */
      imageUrl: string;
      aspectRatio?: number;
    }
  | {
      type: 'steps';
      title: string;
      caption?: string;
      steps: { title: string; detail: string }[];
    }
  | {
      type: 'list';
      title: string;
      caption?: string;
      items: string[];
    }
  | {
      type: 'diagram';
      title: string;
      caption?: string;
      nodes: { label: string; hint?: string }[];
    };

export type Message = {
  id: string;
  role: MessageRole;
  text: string;
  createdAt: number;
  /** Optional rich content rendered inside the bubble. */
  visual?: VisualBlock;
  /** Marks a message that was produced by the simulated voice session. */
  viaVoice?: boolean;
  /** True while PADI's reply is still being "composed". */
  pending?: boolean;
};

export type Conversation = {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
};

export type RepeatRule = 'none' | 'daily' | 'weekly' | 'monthly';

export type Reminder = {
  id: string;
  title: string;
  notes?: string;
  /** ISO date, e.g. 2026-11-14 */
  date: string;
  /** 24h time, e.g. "18:30" */
  time: string;
  repeat: RepeatRule;
  completed: boolean;
  /** Conversation the reminder should open when tapped (future deep link). */
  conversationId?: string;
  createdAt: number;
};

export type MemoryCategory =
  | 'name'
  | 'interests'
  | 'relationships'
  | 'preferences'
  | 'plans';

export type MemoryItem = {
  id: string;
  category: MemoryCategory;
  /** Short label, e.g. "Preferred name". */
  label: string;
  /** What PADI would remember. */
  value: string;
  createdAt: number;
  /** Paused memories are kept but not used in conversation. */
  paused: boolean;
  /** Where it came from, e.g. "You told PADI in chat". */
  source: string;
};

export type Preferences = {
  onboarded: boolean;
  countryCode: string | null;
  languageCode: string;
  displayName: string;
  appearance: AppearanceMode;
  /** 0.9 – 1.35 accessibility text scale. */
  textScale: number;
  reduceMotion: boolean;
  highContrast: boolean;
  voiceId: string;
  voiceRate: number;
  memoryEnabled: boolean;
  notificationsEnabled: boolean;
  dailyCheckIn: boolean;
  checkInTime: string;
  showVoiceTranscript: boolean;
};

export type ChatSuggestion = {
  id: string;
  label: string;
  prompt: string;
  icon: string;
};
