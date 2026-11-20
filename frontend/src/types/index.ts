/** Shared mobile domain types. Personal memory is persisted by the backend. */

export type AppearanceMode = 'system' | 'light' | 'dark';

export type VoiceGender = 'female' | 'male';

export type VoiceOption = {
  id: string;
  name: string;
  gender: VoiceGender;
  accent: string;
  description: string;
  /** Human portrait shown during the voice conversation. */
  imageUrl: string;
  /** Short description of the portrait used by screen readers. */
  imageDescription: string;
  /** Short line used by the natural voice preview. */
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
export type ResponseRating = 'helpful' | 'not_helpful' | 'liked_humour' | 'unwanted_humour';

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
  /** Marks a message from a voice conversation. Legacy demo turns are not backendChat. */
  viaVoice?: boolean;
  /** Fully played speech segments; an interrupted segment is never guessed. */
  voiceSpokenText?: string;
  voiceInterrupted?: boolean;
  /** Only messages from successful authenticated backend chat are sent as context. */
  backendChat?: boolean;
  /** Account that produced the verified exchange; never reuse another account's context. */
  backendUserID?: string;
  /** Consent/memory revision used for this exchange. */
  memoryRevision?: number;
  /** User reaction saved for this authenticated PADI reply. */
  responseFeedback?: ResponseRating;
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

export type MemorySnapshot = {
  enabled: boolean;
  revision: number;
  items: MemoryItem[];
};

export type PersonalityPreferences = {
  humour: 'off' | 'subtle' | 'occasional' | 'frequent';
  humour_explicit: boolean;
  tone: 'adaptive' | 'playful' | 'serious' | 'gentle' | 'direct';
  learn_from_feedback: boolean;
};

export type PersonalityPreferencePatch = Partial<Pick<PersonalityPreferences, 'humour' | 'tone' | 'learn_from_feedback'>>;

export type CheckInPreferences = {
  morning_enabled: boolean;
  morning_time: string;
  afternoon_enabled: boolean;
  afternoon_time: string;
  evening_enabled: boolean;
  evening_time: string;
  timezone: string;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
};

export type CheckInPreferencesPatch = Partial<CheckInPreferences>;

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
