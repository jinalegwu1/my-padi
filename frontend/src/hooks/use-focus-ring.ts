import { useCallback, useState } from 'react';

/**
 * Tracks keyboard/switch-control focus so a control can draw a visible focus
 * ring. React Native's Pressable does not expose focus in its style state, so
 * components wire `onFocus`/`onBlur` to this hook.
 */
export function useFocusRing() {
  const [focused, setFocused] = useState(false);
  const onFocus = useCallback(() => setFocused(true), []);
  const onBlur = useCallback(() => setFocused(false), []);
  return { focused, onFocus, onBlur };
}
