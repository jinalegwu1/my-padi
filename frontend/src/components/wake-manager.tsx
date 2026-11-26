import { useEffect, useRef } from 'react';
import { useVoiceSession } from '@/hooks/use-voice-session';

export function WakeManager() {
  const voice = useVoiceSession();
  const enabledRef = useRef(false);

  useEffect(() => {
    if (enabledRef.current || !voice.ready || voice.chatBusy) return;
    enabledRef.current = true;
    voice.connect(false, true);
  }, [voice.ready, voice.chatBusy, voice.connect]);

  return null;
}
