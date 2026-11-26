import { useLocalSearchParams, useRouter } from 'expo-router';

import { VoiceConversation } from '@/components/chat/voice-conversation';
import { TranscriptionScreen } from '@/components/voice/transcription-screen';

export default function VoiceScreen() {
  const router = useRouter();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const textChat = () => router.replace({ pathname: '/(tabs)/chat', params: { mode: 'text' } });
  if (mode === 'transcribe') return <TranscriptionScreen />;
  return <VoiceConversation onText={textChat} onEnd={() => router.canGoBack() ? router.back() : textChat()} />;
}
