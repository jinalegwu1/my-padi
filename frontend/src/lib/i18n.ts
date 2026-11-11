/**
 * Lightweight in-app translations.
 *
 * The app ships with English, Nigerian Pidgin and French strings for the main
 * flows; anything missing falls back to English. This is a frontend-only
 * dictionary — no translation service is called.
 */

export type TranslationKey = keyof typeof en;

const en = {
  // Onboarding
  'onboarding.step': 'Step {current} of {total}',
  'onboarding.country.title': 'Where are you joining from?',
  'onboarding.country.subtitle':
    'This helps PADI use the right time, dates and local context. You can change it later.',
  'onboarding.country.suggested': 'Suggested for you',
  'onboarding.country.search': 'Search countries',
  'onboarding.country.confirm': 'Yes, that’s right',
  'onboarding.country.change': 'Choose another country',
  'onboarding.country.selected': 'Selected country',
  'onboarding.language.title': 'How should PADI speak with you?',
  'onboarding.language.subtitle':
    'Pick one preferred language. Nigerian Pidgin, Nigerian English and standard English are separate choices.',
  'onboarding.language.featured': 'Popular choices',
  'onboarding.language.others': 'Other languages',
  'onboarding.welcome.title': 'Hello! 😊 I’m PADI.',
  'onboarding.welcome.body':
    'I’m happy you’re here. Think of me as a friendly companion you can talk to, learn with, laugh with and share your day with. I’d love to get to know you.',
  'onboarding.welcome.cta': 'Let’s begin',
  'onboarding.name.title': 'What should I call you?',
  'onboarding.name.subtitle':
    'Just a name — nothing else. You can change it any time in Settings.',
  'onboarding.name.placeholder': 'Your name or nickname',
  'onboarding.name.cta': 'Start talking',
  'onboarding.name.skip': 'Skip for now',
  'onboarding.back': 'Back',
  'onboarding.continue': 'Continue',

  // Conversation
  'chat.title': 'PADI',
  'chat.status': 'Your companion',
  'chat.placeholder': 'Message PADI…',
  'chat.send': 'Send message',
  'chat.voice': 'Start voice conversation',
  'chat.settings': 'Open settings',
  'chat.typing': 'PADI is typing…',
  'chat.suggestions': 'Try one of these',
  'chat.newChat': 'New conversation',
  'chat.history': 'Recent conversations',
  'chat.mockNotice': 'Sample conversation — replies are simulated on this phone.',
  'chat.you': 'You',
  'chat.voiceNote': 'Spoken in a voice session',

  // Voice
  'voice.title': 'Voice conversation',
  'voice.listening': 'Listening…',
  'voice.thinking': 'Thinking…',
  'voice.speaking': 'PADI is speaking',
  'voice.idle': 'Tap the microphone to speak',
  'voice.mic': 'Microphone',
  'voice.micStart': 'Start listening',
  'voice.micStop': 'Stop listening',
  'voice.end': 'End voice session',
  'voice.showWords': 'Show words',
  'voice.hideWords': 'Hide words',
  'voice.simulated': 'Simulated voice session — no microphone or speech service is connected.',
  'voice.youSaid': 'You said',

  // Reminders
  'reminders.title': 'Reminders',
  'reminders.subtitle': 'Things you asked PADI to keep track of.',
  'reminders.upcoming': 'Upcoming',
  'reminders.repeating': 'Repeating',
  'reminders.completed': 'Completed',
  'reminders.empty': 'No reminders here yet.',
  'reminders.add': 'Add reminder',
  'reminders.edit': 'Edit',
  'reminders.cancel': 'Cancel reminder',
  'reminders.markDone': 'Mark as done',
  'reminders.markUndone': 'Mark as not done',
  'reminders.openChat': 'Open conversation',
  'reminders.notice':
    'Reminders are saved on this phone only. Background notifications are not switched on yet.',
  'reminders.form.title': 'Title',
  'reminders.form.date': 'Date',
  'reminders.form.time': 'Time',
  'reminders.form.repeat': 'Repeat',
  'reminders.form.notes': 'Notes (optional)',
  'reminders.form.save': 'Save reminder',
  'reminders.form.delete': 'Delete reminder',

  // Settings
  'settings.title': 'Settings',
  'settings.language': 'Preferred language',
  'settings.language.hint': 'The language PADI uses with you.',
  'settings.voice': 'Voice',
  'settings.voice.hint': 'Choose how PADI sounds when speaking.',
  'settings.voice.preview': 'Preview voice',
  'settings.voice.stop': 'Stop preview',
  'settings.voice.female': 'Female voices',
  'settings.voice.male': 'Male voices',
  'settings.voice.speed': 'Speaking speed',
  'settings.appearance': 'Appearance',
  'settings.appearance.system': 'Automatic',
  'settings.appearance.light': 'Light',
  'settings.appearance.dark': 'Dark',
  'settings.memory': 'Memory and personalisation',
  'settings.memory.hint': 'See and control what PADI remembers.',
  'settings.notifications': 'Notifications',
  'settings.notifications.hint': 'Reminder and message alerts.',
  'settings.checkIn': 'Daily check-in',
  'settings.checkIn.hint': 'A gentle hello from PADI each day.',
  'settings.checkIn.time': 'Check-in time',
  'settings.accessibility': 'Accessibility',
  'settings.accessibility.textSize': 'Text size',
  'settings.accessibility.reduceMotion': 'Reduce motion',
  'settings.accessibility.reduceMotion.hint': 'Fewer animations and softer transitions.',
  'settings.accessibility.highContrast': 'Higher contrast',
  'settings.accessibility.highContrast.hint': 'Stronger colours for easier reading.',
  'settings.about': 'About',
  'settings.about.body':
    'My PADI is a frontend prototype. Conversations, voice and reminders are simulated on this phone.',
  'settings.reset': 'Reset app data',
  'settings.reset.hint': 'Clears your name, preferences and sample data on this phone.',

  // Memory
  'memory.title': 'Memory',
  'memory.subtitle': 'What PADI remembers, and only with your permission.',
  'memory.consent': 'PADI only remembers something when you say yes.',
  'memory.consentOff': 'Memory is paused. PADI will not keep anything new.',
  'memory.paused': 'Paused',
  'memory.active': 'In use',
  'memory.review': 'Review',
  'memory.correct': 'Correct',
  'memory.pause': 'Pause',
  'memory.resume': 'Resume',
  'memory.delete': 'Delete',
  'memory.empty': 'Nothing remembered yet.',
  'memory.editTitle': 'Correct this memory',
  'memory.save': 'Save change',
  'memory.deleteTitle': 'Delete this memory?',
  'memory.deleteBody': 'PADI will forget this and will not use it again.',
  'memory.source': 'Source',

  // Common
  'common.done': 'Done',
  'common.close': 'Close',
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.retry': 'Try again',
  'common.loading': 'Loading…',
  'common.error': 'Something went wrong loading your data.',
  'common.optional': 'Optional',
};

const pcm: Partial<Record<TranslationKey, string>> = {
  'onboarding.country.title': 'Which place you dey come from?',
  'onboarding.country.subtitle':
    'E go help PADI know your time and date. You fit change am later.',
  'onboarding.country.suggested': 'We suggest this one',
  'onboarding.country.search': 'Find country',
  'onboarding.country.confirm': 'Yes, na correct',
  'onboarding.country.change': 'Choose another country',
  'onboarding.language.title': 'How you want make PADI talk with you?',
  'onboarding.language.subtitle':
    'Pick one language. Naija Pidgin, Nigerian English and standard English na three different things.',
  'onboarding.welcome.title': 'Hello! 😊 Na me be PADI.',
  'onboarding.welcome.body':
    'I happy say you dey here. See me as your padi wey you fit gist with, learn with, laugh with and share your day with. I wan know you well.',
  'onboarding.welcome.cta': 'Make we start',
  'onboarding.name.title': 'Wetin I go call you?',
  'onboarding.name.subtitle': 'Just name — nothing more. You fit change am anytime.',
  'onboarding.name.placeholder': 'Your name or nickname',
  'onboarding.name.cta': 'Start gist',
  'onboarding.name.skip': 'Skip for now',
  'chat.placeholder': 'Message PADI…',
  'chat.typing': 'PADI dey type…',
  'chat.suggestions': 'Try one of these',
  'chat.mockNotice': 'Na sample conversation — the replies dey come from this phone.',
  'voice.listening': 'I dey listen…',
  'voice.thinking': 'I dey think…',
  'voice.speaking': 'PADI dey talk',
  'voice.idle': 'Tap the mic make you talk',
  'voice.end': 'End voice session',
  'reminders.title': 'Reminders',
  'reminders.upcoming': 'Dey come',
  'reminders.repeating': 'Dey repeat',
  'reminders.completed': 'Don finish',
  'settings.title': 'Settings',
  'settings.language': 'Language wey you like',
  'settings.voice': 'Voice',
  'settings.appearance': 'How e go look',
  'settings.memory': 'Memory',
  'settings.notifications': 'Alerts',
  'settings.accessibility': 'Accessibility',
  'memory.title': 'Memory',
  'memory.consent': 'PADI dey remember something only when you agree.',
};

const fr: Partial<Record<TranslationKey, string>> = {
  'onboarding.step': 'Étape {current} sur {total}',
  'onboarding.country.title': 'D’où nous rejoignez-vous ?',
  'onboarding.country.subtitle':
    'Cela aide PADI à utiliser la bonne heure, les bonnes dates et le bon contexte local. Modifiable plus tard.',
  'onboarding.country.suggested': 'Suggéré pour vous',
  'onboarding.country.search': 'Rechercher un pays',
  'onboarding.country.confirm': 'Oui, c’est exact',
  'onboarding.country.change': 'Choisir un autre pays',
  'onboarding.country.selected': 'Pays sélectionné',
  'onboarding.language.title': 'Comment PADI doit-il vous parler ?',
  'onboarding.language.subtitle':
    'Choisissez une langue préférée. Le pidgin nigérian, l’anglais nigérian et l’anglais standard sont trois choix distincts.',
  'onboarding.language.featured': 'Choix populaires',
  'onboarding.language.others': 'Autres langues',
  'onboarding.welcome.title': 'Bonjour ! 😊 Je suis PADI.',
  'onboarding.welcome.body':
    'Je suis content que vous soyez là. Voyez-moi comme un compagnon amical avec qui parler, apprendre, rire et partager votre journée. J’aimerais beaucoup vous connaître.',
  'onboarding.welcome.cta': 'Commençons',
  'onboarding.name.title': 'Comment dois-je vous appeler ?',
  'onboarding.name.subtitle':
    'Juste un nom — rien d’autre. Modifiable à tout moment dans les réglages.',
  'onboarding.name.placeholder': 'Votre nom ou surnom',
  'onboarding.name.cta': 'Commencer à parler',
  'onboarding.name.skip': 'Passer pour l’instant',
  'onboarding.back': 'Retour',
  'onboarding.continue': 'Continuer',
  'chat.placeholder': 'Écrire à PADI…',
  'chat.send': 'Envoyer le message',
  'chat.voice': 'Démarrer une conversation vocale',
  'chat.settings': 'Ouvrir les réglages',
  'chat.typing': 'PADI écrit…',
  'chat.suggestions': 'Essayez l’une de ces idées',
  'chat.mockNotice': 'Conversation d’exemple — les réponses sont simulées sur ce téléphone.',
  'voice.title': 'Conversation vocale',
  'voice.listening': 'J’écoute…',
  'voice.thinking': 'Je réfléchis…',
  'voice.speaking': 'PADI parle',
  'voice.idle': 'Touchez le micro pour parler',
  'voice.end': 'Terminer la session vocale',
  'voice.showWords': 'Afficher les mots',
  'voice.hideWords': 'Masquer les mots',
  'reminders.title': 'Rappels',
  'reminders.upcoming': 'À venir',
  'reminders.repeating': 'Récurrents',
  'reminders.completed': 'Terminés',
  'reminders.add': 'Ajouter un rappel',
  'settings.title': 'Réglages',
  'settings.language': 'Langue préférée',
  'settings.voice': 'Voix',
  'settings.appearance': 'Apparence',
  'settings.appearance.system': 'Automatique',
  'settings.appearance.light': 'Clair',
  'settings.appearance.dark': 'Sombre',
  'settings.memory': 'Mémoire et personnalisation',
  'settings.notifications': 'Notifications',
  'settings.checkIn': 'Point quotidien',
  'settings.accessibility': 'Accessibilité',
  'settings.accessibility.textSize': 'Taille du texte',
  'settings.accessibility.reduceMotion': 'Réduire les animations',
  'memory.title': 'Mémoire',
  'memory.subtitle': 'Ce que PADI retient, et seulement avec votre accord.',
  'memory.consent': 'PADI ne retient quelque chose que si vous dites oui.',
  'memory.paused': 'En pause',
  'memory.active': 'Utilisé',
  'memory.correct': 'Corriger',
  'memory.pause': 'Mettre en pause',
  'memory.resume': 'Reprendre',
  'memory.delete': 'Supprimer',
  'common.done': 'Terminé',
  'common.cancel': 'Annuler',
  'common.save': 'Enregistrer',
  'common.delete': 'Supprimer',
};

const DICTIONARIES: Record<string, Partial<Record<TranslationKey, string>>> = {
  en,
  'en-GB': en,
  'en-NG': en,
  'pcm-NG': pcm,
  'fr-FR': fr,
};

export function translate(
  languageCode: string,
  key: TranslationKey,
  vars?: Record<string, string | number>,
): string {
  const dict = DICTIONARIES[languageCode] ?? {};
  let value = dict[key] ?? en[key] ?? key;
  if (vars) {
    for (const [name, replacement] of Object.entries(vars)) {
      value = value.replace(`{${name}}`, String(replacement));
    }
  }
  return value;
}

export type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;
