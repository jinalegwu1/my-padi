/** Greeting generation uses the ordinary chat request and its shared personality,
 * saved preferences, account context, and configured text/voice provider. */
// Retain only a nonpersonal opening word for variation, never previous greeting
// facts that could cross a memory revision or account boundary.
export function greetingOpening(text: string): string | undefined {
  const word = text.match(/^[^A-Za-z]*([A-Za-z]+)/)?.[1]?.toLowerCase();
  return word && ['well', 'hey', 'hi', 'hello', 'hiya', 'welcome', 'good', 'bonjour', 'bonsoir', 'salut', 'coucou', 'how'].includes(word) ? word : undefined;
}

export function greetingRequest(languageCode = 'en-NG', previousOpening?: string): string {
  const language = languageCode === 'pcm-NG' ? 'Nigerian Pidgin (pcm-NG)' :
    languageCode === 'fr-FR' ? 'French (fr-FR)' :
    languageCode === 'en-NG' ? 'English (en-NG), without switching to Pidgin or other languages' : languageCode;
  const opening = greetingOpening(previousOpening ?? '');
  const variation = opening ? ` Begin with a different word from ${opening}; change the greeting's rhythm too.` : '';
  return `Say hello naturally in one or two short, spontaneous sentences, like a friend glad to see me. Be warm and curious. Let wit fit naturally rather than announcing an entrance or making a grand comparison. With no earlier turns, this is our first greeting; with earlier turns, welcome me back in a way that fits the conversation. Follow my conversation preferences. Speak ${language}.${variation}`;
}
