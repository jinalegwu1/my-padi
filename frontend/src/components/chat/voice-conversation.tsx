import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useIsFocused } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PadiOrb, type OrbState } from '@/components/padi-orb';
import { ChatLocation } from '@/components/chat/chat-location';
import { fonts, spacing, useColors, useType } from '@/constants/theme';
import { usePreferences } from '@/hooks/use-preferences';
import { useTranslation } from '@/hooks/use-translation';
import { useVoiceSession } from '@/hooks/use-voice-session';

type Props = {
  autoStart?: boolean;
  onEnd: () => void;
  onText: () => void;
  onMenu?: () => void;
};

export function VoiceConversation({ autoStart = false, onEnd, onText, onMenu }: Props) {
  const colors = useColors();
  const type = useType();
  const { width } = useWindowDimensions();
  const { t } = useTranslation();
  const { preferences } = usePreferences();
  const voice = useVoiceSession();
  const focused = useIsFocused();
  const attempted = useRef(false);
  useFocusEffect(useCallback(() => () => { void voice.session.cancel(); }, [voice.session]));

  useEffect(() => {
    if (!focused || !autoStart || !voice.ready || voice.chatBusy || attempted.current) return;
    attempted.current = true;
    voice.connect(true, false, true);
  }, [autoStart, focused, voice.ready, voice.chatBusy, voice.connect]);

  const busy = voice.connected || voice.phase === 'preparing';
  const state: OrbState = voice.phase === 'preparing' || voice.phase === 'transcribing' ? 'thinking' : voice.phase;
  const error = voice.configurationError ?? voice.error ?? voice.chatError;
  const handlePortrait = () => {
    if(voice.connected)void voice.session.reactToTouch();
    else if(!busy&&voice.ready&&!voice.chatBusy)voice.connect();
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('voice.end')} onPress={onEnd} hitSlop={10}
          style={({ pressed }) => [styles.closeButton, { backgroundColor: colors.cardMuted }, pressed && { opacity: 0.7 }]}>
          <Ionicons name="chevron-down" size={20} color={colors.textSecondary} />
        </Pressable>
        {onMenu && <Pressable accessibilityRole="button" accessibilityLabel="Open PADI menu" onPress={onMenu}
          style={[styles.closeButton, { backgroundColor: colors.cardMuted }]}>
          <Ionicons name="menu-outline" size={20} color={colors.textSecondary} />
        </Pressable>}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Switch to text"
          onPress={onText}
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
      {autoStart && <ChatLocation />}
      <View style={styles.orbArea}>
        <PadiOrb state={state} voiceId={preferences.voiceId} size={Math.min(240, width * .55)}
          onPress={handlePortrait} accessibilityHint={t('voice.tapToChat')} />
        {autoStart && <Text accessibilityLiveRegion="polite" style={[styles.status, { color: colors.textSecondary, fontSize: type.bodySmall }]}>
          {t(voice.phase === 'idle' ? 'voice.tapToChat' : voice.phase === 'preparing' || voice.phase === 'transcribing' || voice.phase === 'thinking' ? 'voice.thinking' : voice.phase === 'speaking' ? 'voice.speaking' : 'voice.listening')}
        </Text>}
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
  status: { fontFamily: fonts.medium, textAlign: 'center', paddingHorizontal: spacing.base },
  error: { fontFamily: fonts.regular, lineHeight: 22, textAlign: 'center', padding: spacing.base },
});
