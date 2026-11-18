import type { LanguageOption, VoiceOption } from '@/types';

/**
 * Onboarding step 2 — one preferred language.
 * Nigerian Pidgin, Nigerian English and standard English are deliberately three
 * separate choices, because they are three different ways of speaking.
 */
export const LANGUAGES: LanguageOption[] = [
  {
    code: 'en-NG',
    label: 'Nigerian English',
    nativeLabel: 'Nigerian English',
    note: 'English as we speak it in Nigeria',
    featured: true,
  },
  {
    code: 'pcm-NG',
    label: 'Nigerian Pidgin',
    nativeLabel: 'Naija Pidgin',
    note: 'How you dey? Make we gist.',
    featured: true,
  },
  {
    code: 'en-GB',
    label: 'English',
    nativeLabel: 'English',
    note: 'Standard English',
    featured: true,
  },
  { code: 'fr-FR', label: 'French', nativeLabel: 'Français' },
  { code: 'pt-BR', label: 'Portuguese', nativeLabel: 'Português' },
  { code: 'es-ES', label: 'Spanish', nativeLabel: 'Español' },
  { code: 'ar-SA', label: 'Arabic', nativeLabel: 'العربية' },
  { code: 'sw-KE', label: 'Swahili', nativeLabel: 'Kiswahili' },
  { code: 'ha-NG', label: 'Hausa', nativeLabel: 'Hausa' },
  { code: 'yo-NG', label: 'Yoruba', nativeLabel: 'Yorùbá' },
  { code: 'ig-NG', label: 'Igbo', nativeLabel: 'Igbo' },
  { code: 'am-ET', label: 'Amharic', nativeLabel: 'አማርኛ' },
  { code: 'hi-IN', label: 'Hindi', nativeLabel: 'हिन्दी' },
  { code: 'zh-CN', label: 'Chinese', nativeLabel: '中文' },
];

export function findLanguage(code: string): LanguageOption | undefined {
  return LANGUAGES.find((l) => l.code === code);
}

export function languageLabel(code: string): string {
  return findLanguage(code)?.label ?? 'English';
}

/**
 * Voice styles for Settings → Voice, mapped to speech models by Python.
 * Named styles are not recordings or a guarantee of a particular local accent.
 */
export const VOICES: VoiceOption[] = [
  {
    id: 'baby',
    name: 'Baby',
    gender: 'female',
    accent: 'Natural voice',
    description: 'Bright and gently playful',
    sample: "Hello! I'm PADI. I'm happy to be here with you.",
  },
  {
    id: 'ada',
    name: 'Ada',
    gender: 'female',
    accent: 'Natural voice',
    description: 'Warm, clear and encouraging',
    sample: "Hey! I'm PADI. I'm here whenever you want to talk.",
  },
  {
    id: 'chidi',
    name: 'Chidi',
    gender: 'male',
    accent: 'Natural voice',
    description: 'Calm, steady and friendly',
    sample: "Hello, I'm PADI. Let's take it one step at a time.",
  },
  {
    id: 'zainab',
    name: 'Zainab',
    gender: 'female',
    accent: 'Natural voice',
    description: 'Bright and lively',
    sample: "Hi there! I'm PADI. What are we learning today?",
  },
  {
    id: 'tunde',
    name: 'Tunde',
    gender: 'male',
    accent: 'Natural voice',
    description: 'Relaxed and playful',
    sample: 'How you dey? Na me be PADI. Make we gist small.',
  },
  {
    id: 'amara',
    name: 'Amara',
    gender: 'female',
    accent: 'Natural voice',
    description: 'Soft and thoughtful',
    sample: "I'm Amara. Take your time — I'm listening.",
  },
  {
    id: 'daniel',
    name: 'Daniel',
    gender: 'male',
    accent: 'Natural voice',
    description: 'Deep and reassuring',
    sample: "Good to see you. I'm PADI. Shall we begin?",
  },
];

export function findVoice(id: string): VoiceOption {
  return VOICES.find((v) => v.id === id) ?? VOICES[0];
}
