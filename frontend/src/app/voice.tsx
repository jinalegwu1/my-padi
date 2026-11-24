import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PadiOrb, type OrbState } from '@/components/padi-orb';
import { TranscriptionScreen } from '@/components/voice/transcription-screen';
import { fonts, spacing, useColors, useType } from '@/constants/theme';
import { usePreferences } from '@/hooks/use-preferences';
import { useTranslation } from '@/hooks/use-translation';
import { useVoiceSession } from '@/hooks/use-voice-session';

/**
 * Runs the human-portrait hands-free conversation: microphone capture, transcription,
 * chat reply, listening/thinking/speaking portrait state, and natural voice playback.
 */
export default function VoiceScreen() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  return mode === 'transcribe' ? <TranscriptionScreen /> : <ConversationScreen />;
}

function ConversationScreen() {
  const router = useRouter();
  const colors = useColors();
  const type = useType();
  const { width } = useWindowDimensions();
  const { t } = useTranslation();
  const { preferences } = usePreferences();
  const voice = useVoiceSession();
  useFocusEffect(useCallback(() => () => {void voice.session.cancel();}, [voice.session]));

  const busy = voice.connected || voice.phase === 'preparing';
  const state: OrbState = voice.phase === 'preparing' || voice.phase === 'transcribing' ? 'thinking' : voice.phase;
  const error = voice.configurationError ?? voice.error ?? voice.chatError;
  const handleEnd = async () => {
    await voice.session.cancel();
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/chat');
  };
  const handleText = async () => {
    await voice.session.cancel();
    router.replace('/(tabs)/chat');
  };
  const handlePortrait = () => {
    if(voice.connected)void voice.session.reactToTouch();
    else if(!busy&&voice.ready&&!voice.chatBusy)voice.connect();
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('voice.end')} onPress={handleEnd} hitSlop={10}
          style={({ pressed }) => [styles.closeButton, { backgroundColor: colors.cardMuted }, pressed && { opacity: 0.7 }]}>
          <Ionicons name="chevron-down" size={20} color={colors.textSecondary} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Switch to text"
          onPress={handleText}
          hitSlop={8}
          style={({ pressed }) => [
            styles.textSwitch,
            { backgroundColor: colors.primarySoft, borderColor: colors.primary },
            pressed && { opacity: 0.7 },
          ]}>
          <Ionicons name="chatbubble-outline" size={16} color={colors.primary} />
          <Text style={[styles.textSwitchText, { color: colors.primary, fontSize: type.micro }]}>Text</Text>
        </Pressable>
      </View>
      <View style={styles.orbArea}>
        <PadiOrb state={state} voiceId={preferences.voiceId} size={Math.min(240, width * .55)}
          onPress={handlePortrait} accessibilityHint={t('voice.tapToChat')} />
      </View>
      {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite"
        style={[styles.error, { color: colors.danger, fontSize: type.bodySmall }]}>{error}</Text> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textSwitch: {
    minHeight: 38,
    borderRadius: 19,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.sm,
  },
  textSwitchText: { fontFamily: fonts.semibold },
  orbArea: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  error: { fontFamily: fonts.regular, lineHeight: 22, textAlign: 'center', padding: spacing.base },
});
