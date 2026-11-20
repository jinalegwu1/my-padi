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
    name: 'PADI',
    gender: 'male',
    accent: 'Nigerian English style',
    description: 'Cute, confident and expressive',
    imageUrl: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=900&q=88',
    imageDescription: 'A cute fine boy with a warm smile',
    sample: "Hey, I'm PADI. Good to have you here. Tell me, how is your day going?",
  },
  {
    id: 'ada',
    name: 'Ada',
    gender: 'female',
    accent: 'Nigerian English style',
    description: 'Beautiful Idoma girl, warm and encouraging',
    imageUrl: 'https://images.pexels.com/photos/33588240/pexels-photo-33588240.jpeg?auto=compress&cs=tinysrgb&w=1200',
    imageDescription: 'An African woman in a traditional headwrap and attire',
    sample: "Hey! I'm PADI. I'm here whenever you want to talk.",
  },
  {
    id: 'chidi',
    name: 'Chidi',
    gender: 'female',
    accent: 'Nigerian English style',
    description: 'Beautiful Igbo girl, calm and friendly',
    imageUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=900&q=88',
    imageDescription: 'A beautiful Igbo girl',
    sample: "Hello, I'm PADI. Let's take it one step at a time.",
  },
  {
    id: 'zainab',
    name: 'Zainab',
    gender: 'female',
    accent: 'Nigerian English style',
    description: 'Beautiful Hausa girl, bright and lively',
    imageUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=900&q=88',
    imageDescription: 'A beautiful Hausa girl',
    sample: "Hi there! I'm PADI. What are we learning today?",
  },
  {
    id: 'tunde',
    name: 'Tunde',
    gender: 'male',
    accent: 'Nigerian Pidgin style',
    description: 'Handsome Yoruba guy, relaxed and playful',
    imageUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=900&q=88',
    imageDescription: 'A handsome Yoruba guy',
    sample: "Hey, I'm PADI. Let's have a little chat.",
  },
  {
    id: 'amara',
    name: 'Amara',
    gender: 'male',
    accent: 'Nigerian English style',
    description: 'Handsome Edo man, soft and thoughtful',
    imageUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=900&q=88',
    imageDescription: 'A handsome Edo man',
    sample: "Hey, I'm PADI. Take your time. I'm here with you.",
  },
];

export function findVoice(id: string): VoiceOption {
  return VOICES.find((v) => v.id === id) ?? VOICES[0];
}
