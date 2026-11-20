import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PadiOrb, type OrbState } from '@/components/padi-orb';
import { VoiceCaption } from '@/components/voice/voice-caption';
import { VoiceStatePill } from '@/components/voice/voice-state-pill';
import { Button } from '@/components/ui/button';
import { fonts, spacing, useColors, useType } from '@/constants/theme';
import { usePreferences } from '@/hooks/use-preferences';
import { useTranslation } from '@/hooks/use-translation';
import { useVoiceSession } from '@/hooks/use-voice-session';

/**
 * Runs the human-portrait hands-free conversation: microphone capture, transcription,
 * chat reply, listening/thinking/speaking portrait state, and natural voice playback.
 */
export default function VoiceScreen() {
  const router = useRouter();
  const colors = useColors();
  const type = useType();
  const { t } = useTranslation();
  const { preferences, update } = usePreferences();
  const voice = useVoiceSession();
  const [showWords, setShowWords] = useState(preferences.showVoiceTranscript);
  useFocusEffect(useCallback(() => () => { void voice.session.cancel(); }, [voice.session]));

  const busy = voice.connected || voice.phase === 'preparing';
  const state: OrbState = voice.phase === 'preparing' || voice.phase === 'transcribing' ? 'thinking' : voice.phase;
  const label = voice.phase === 'preparing' ? 'Starting conversation…'
    : voice.phase === 'transcribing' ? 'Understanding your voice…'
    : state === 'listening' ? 'I’m listening'
    : t(`voice.${state}`);
  const micLabel = busy ? 'Pause conversation' : 'Start conversation';
  const error = voice.configurationError ?? voice.error ?? voice.chatError;
  const handleMic = () => {
    if (busy) void voice.session.cancel();
    else if (voice.ready && !voice.chatBusy) { void voice.session.start(); }
  };
  const handleEnd = () => { void voice.session.cancel(); router.back(); };
  const toggleWords = () => { const next = !showWords; setShowWords(next); update({ showVoiceTranscript: next }); };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('voice.end')} onPress={handleEnd} hitSlop={10}
          style={({ pressed }) => [styles.closeButton, { backgroundColor: colors.cardMuted }, pressed && { opacity: 0.7 }]}>
          <Ionicons name="chevron-down" size={20} color={colors.textSecondary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text, fontSize: type.subheading }]}>{t('voice.title')}</Text>
        <View style={styles.closeButton} />
      </View>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <View style={[styles.orbArea, { minHeight: 250 }]}>
          <PadiOrb state={state} voiceId={preferences.voiceId} size={190} />
          <VoiceStatePill state={state} label={label} />
        </View>
        <View style={styles.captionArea}>
          <VoiceCaption padiText={voice.padiText || '…'} userText={voice.userText} visible={showWords} onToggle={toggleWords}
            showLabel={t('voice.showWords')} hideLabel={t('voice.hideWords')} youSaidLabel={t('voice.youSaid')} />
        </View>
        <View style={styles.controls}>
          {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite"
            style={{ color: colors.text, fontSize: type.bodySmall, textAlign: 'center' }}>{error}</Text> : null}
          <Pressable accessibilityRole="button" accessibilityLabel={micLabel}
            accessibilityState={{ disabled: !busy && (!voice.ready || voice.chatBusy) }}
            disabled={!busy && (!voice.ready || voice.chatBusy)} onPress={handleMic}
            style={({ pressed }) => [styles.micButton, { backgroundColor: busy ? colors.card : colors.primary,
              borderColor: busy ? colors.border : colors.primary, opacity: !busy && (!voice.ready || voice.chatBusy) ? 0.4 : pressed ? 0.85 : 1 }]}>
            <Ionicons name={busy ? 'stop' : 'mic'} size={30} color={busy ? colors.primary : colors.onPrimary} />
          </Pressable>
          <Text style={[styles.micLabel, { color: colors.muted, fontSize: type.caption }]}>{micLabel}</Text>
          <Button title={t('voice.end')} variant="secondary" icon="close" onPress={handleEnd} />
          <View style={styles.notice}>
            <Ionicons name="information-circle-outline" size={14} color={colors.muted} />
            <Text style={[styles.noticeText, { color: colors.muted, fontSize: type.micro }]}>
              Start conversation keeps the microphone on while this screen is open. When you finish speaking, PADI sends your speaking turn for transcription and answers automatically. Start talking to interrupt PADI. Pause or End stops the microphone.
            </Text>
          </View>
          <Text style={[styles.noticeText, { color: colors.muted, fontSize: type.micro }]}>
            Groq transcribes your speaking turns and Gemini generates spoken replies. Recordings are temporary. Noise and accents can affect recognition. Calls, messages, and emails are not connected yet.
          </Text>
        </View>
      </ScrollView>
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
  headerTitle: { fontFamily: fonts.semibold },
  orbArea: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg },
  captionArea: { paddingHorizontal: spacing.base, paddingBottom: spacing.md },
  controls: { paddingHorizontal: spacing.base, paddingBottom: spacing.md, gap: spacing.sm, alignItems: 'center' },
  micButton: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micLabel: { fontFamily: fonts.medium, marginBottom: spacing.sm },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs, paddingTop: spacing.xs },
  noticeText: { flex: 1, fontFamily: fonts.regular, lineHeight: 16, textAlign: 'center' },
});
