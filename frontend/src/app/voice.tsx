import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PadiOrb, type OrbState } from '@/components/padi-orb';
import { VoiceCaption } from '@/components/voice/voice-caption';
import { VoiceStatePill } from '@/components/voice/voice-state-pill';
import { Button } from '@/components/ui/button';
import { fonts, radius, spacing, useColors, useType } from '@/constants/theme';
import { VOICE_SCRIPT } from '@/data/mock-replies';
import { useChat } from '@/hooks/use-chat';
import { usePreferences } from '@/hooks/use-preferences';
import { useTranslation } from '@/hooks/use-translation';

/**
 * Voice conversation screen.
 *
 * PADI's animated Orb lives here and only here. The session is SIMULATED: no
 * microphone is opened and no speech service is connected — the screen says so.
 */
export default function VoiceScreen() {
  const router = useRouter();
  const colors = useColors();
  const type = useType();
  const { t } = useTranslation();
  const { preferences, update } = usePreferences();
  const { addVoiceExchange } = useChat();

  const [state, setState] = useState<OrbState>('idle');
  const [turn, setTurn] = useState(0);
  const [userText, setUserText] = useState<string | undefined>(undefined);
  const [padiText, setPadiText] = useState(
    'Tap the microphone and I’ll listen. We can talk about anything at all.',
  );
  const [showWords, setShowWords] = useState(preferences.showVoiceTranscript);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  /** Runs one simulated turn: listening → thinking → speaking → idle. */
  const runTurn = useCallback(() => {
    clearTimers();
    const script = VOICE_SCRIPT[turn % VOICE_SCRIPT.length];

    setUserText(script.user);
    setPadiText('');
    setState('listening');

    timers.current.push(
      setTimeout(() => {
        setState('thinking');
      }, 1800),
    );

    timers.current.push(
      setTimeout(() => {
        setState('speaking');
        setPadiText(script.padi);
      }, 3000),
    );

    timers.current.push(
      setTimeout(() => {
        setState('idle');
        setTurn((prev) => prev + 1);
      }, 7000),
    );
  }, [clearTimers, turn]);

  const handleMic = () => {
    if (state === 'idle') {
      runTurn();
    } else {
      clearTimers();
      setState('idle');
    }
  };

  const handleEnd = () => {
    clearTimers();
    // Keep the exchange in the conversation so the user can read it later.
    if (userText && padiText) {
      addVoiceExchange(userText, padiText);
    }
    router.back();
  };

  const toggleWords = () => {
    const next = !showWords;
    setShowWords(next);
    update({ showVoiceTranscript: next });
  };

  const stateLabel = {
    idle: t('voice.idle'),
    listening: t('voice.listening'),
    thinking: t('voice.thinking'),
    speaking: t('voice.speaking'),
  }[state];

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('voice.end')}
          onPress={handleEnd}
          hitSlop={10}
          style={({ pressed }) => [
            styles.closeButton,
            { backgroundColor: colors.cardMuted },
            pressed && { opacity: 0.7 },
          ]}>
          <Ionicons name="chevron-down" size={20} color={colors.textSecondary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text, fontSize: type.subheading }]}>
          {t('voice.title')}
        </Text>
        <View style={styles.closeButton} />
      </View>

      <View style={styles.orbArea}>
        <PadiOrb state={state} size={190} />
        <VoiceStatePill state={state} label={stateLabel} />
      </View>

      <View style={styles.captionArea}>
        <VoiceCaption
          padiText={padiText || '…'}
          userText={userText}
          visible={showWords}
          onToggle={toggleWords}
          showLabel={t('voice.showWords')}
          hideLabel={t('voice.hideWords')}
          youSaidLabel={t('voice.youSaid')}
        />
      </View>

      <View style={styles.controls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={state === 'idle' ? t('voice.micStart') : t('voice.micStop')}
          accessibilityState={{ busy: state !== 'idle' }}
          onPress={handleMic}
          style={({ pressed }) => [
            styles.micButton,
            {
              backgroundColor: state === 'idle' ? colors.primary : colors.card,
              borderColor: state === 'idle' ? colors.primary : colors.border,
              opacity: pressed ? 0.85 : 1,
            },
          ]}>
          <Ionicons
            name={state === 'idle' ? 'mic' : 'stop'}
            size={30}
            color={state === 'idle' ? colors.onPrimary : colors.primary}
          />
        </Pressable>
        <Text style={[styles.micLabel, { color: colors.muted, fontSize: type.caption }]}>
          {t('voice.mic')}
        </Text>

        <Button
          title={t('voice.end')}
          variant="secondary"
          icon="close"
          onPress={handleEnd}
        />

        <View style={styles.notice}>
          <Ionicons name="information-circle-outline" size={14} color={colors.muted} />
          <Text style={[styles.noticeText, { color: colors.muted, fontSize: type.micro }]}>
            {t('voice.simulated')}
          </Text>
        </View>
      </View>
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
