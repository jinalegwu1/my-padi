// Keep the user's wording, including negations. The Memory editor is the only
// place that approves and saves a suggestion. Greeting cues have no user turn.
export function preferenceDraft(message, owner) {
  if (!owner || message?.backendUserID !== owner || message.role !== 'user' ||
      !message.backendChat || typeof message.text !== 'string') return;
  const words = message.text.trim().replace(/^(?:please\s+)?remember\s+(?:that\s+)?/i, '');
  if (!words || [...words].length > 500 || words.includes('?')) return;
  if (!/^i (?:really |usually |especially )?(?:like|love|prefer|enjoy|dislike|hate|(?:do not|don['’]t) (?:like|enjoy))\s+\S|^my favou?rite\s+\S/i.test(words)) return;
  return {category: 'preferences', label: 'Personal preference', value: words};
}

export function latestPreferenceID(messages, owner) {
  const last = messages?.findLast(item => item.role === 'user' && item.backendUserID === owner);
  return preferenceDraft(last, owner) ? last.id : null;
}
