import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PadiOrb, type OrbState } from '@/components/padi-orb';
import { VoiceCaption } from '@/components/voice/voice-caption';
import { VoiceStatePill } from '@/components/voice/voice-state-pill';
import { Button } from '@/components/ui/button';
import { fonts, spacing, useColors, useType } from '@/constants/theme';
import { usePreferences } from '@/hooks/use-preferences';
import { useTranslation } from '@/hooks/use-translation';
import { useVoiceSession } from '@/hooks/use-voice-session';
import { speakPortraitGreeting } from '@/lib/speech';

/**
 * Runs the human-portrait hands-free conversation: microphone capture, transcription,
 * chat reply, listening/thinking/speaking portrait state, and natural voice playback.
 */
export default function VoiceScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ connect?: string }>();
  const colors = useColors();
  const type = useType();
  const { width } = useWindowDimensions();
  const { t } = useTranslation();
  const { preferences, update } = usePreferences();
  const voice = useVoiceSession();
  const [showWords, setShowWords] = useState(preferences.showVoiceTranscript);
  const hasConnected = useRef(false);
  const autoAttempted = useRef(false);
  const touchReply = useRef<AbortController|null>(null);
  const [touchPhase,setTouchPhase]=useState<'idle'|'thinking'|'speaking'>('idle');
  const [touchText,setTouchText]=useState('');
  const [touchError,setTouchError]=useState<string|null>(null);
  const welcomed=useRef(false);
  useEffect(() => { if (voice.connected) hasConnected.current = true; }, [voice.connected]);
  useEffect(() => {
    if (params.connect === '1' && voice.ready && !voice.chatBusy && !autoAttempted.current) {
      autoAttempted.current = true;
      voice.connect();
    }
  }, [params.connect, voice.ready, voice.chatBusy, voice.connect]);
  useFocusEffect(useCallback(() => () => {touchReply.current?.abort();touchReply.current=null;void voice.session.cancel();}, [voice.session]));

  const busy = voice.connected || voice.phase === 'preparing';
  const state: OrbState = touchPhase!=='idle'?touchPhase:voice.phase === 'preparing' || voice.phase === 'transcribing' ? 'thinking' : voice.phase;
  const label = voice.phase === 'preparing' ? t('voice.connecting')
    : voice.phase === 'transcribing' ? t('voice.understanding')
    : t(`voice.${state}`);
  const micLabel = busy ? t('voice.pause') : hasConnected.current ? t('voice.resume') : t('voice.tapToChat');
  const error = touchError ?? voice.configurationError ?? voice.error ?? voice.chatError;
  const handleMic = () => {
    touchReply.current?.abort();touchReply.current=null;setTouchPhase('idle');setTouchError(null);
    if (busy) void voice.session.cancel();
    else if (voice.ready && !voice.chatBusy) { voice.connect(!hasConnected.current&&!welcomed.current); }
  };
  const handleEnd = () => {
    touchReply.current?.abort();
    touchReply.current=null;
    void voice.session.cancel();
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/chat');
  };
  const handlePortrait = () => {
    if(voice.connected)void voice.session.reactToTouch();
    else if(!busy) {
      touchReply.current?.abort();
      const controller=new AbortController();touchReply.current=controller;
      setTouchError(null);setTouchPhase('thinking');
      void speakPortraitGreeting(preferences.voiceId,preferences.languageCode,preferences.voiceRate,controller.signal,
        ()=>{if(touchReply.current===controller&&!controller.signal.aborted)setTouchPhase('speaking');},
        text=>{if(touchReply.current===controller&&!controller.signal.aborted)setTouchText(text);})
        .then(result=>{if(result==='played'&&touchReply.current===controller)welcomed.current=true;})
        .catch(error=>{if(touchReply.current===controller&&!controller.signal.aborted)setTouchError(error instanceof Error?error.message:'The greeting could not play.');})
        .finally(()=>{if(touchReply.current===controller){touchReply.current=null;setTouchPhase('idle');}});
    }
  };
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
          <PadiOrb state={state} voiceId={preferences.voiceId} size={Math.min(210, width * .5)}
            onPress={handlePortrait} accessibilityHint={t('voice.touchHint')} />
          <VoiceStatePill state={state} label={label} />
          {!busy && !hasConnected.current ? <Text style={[styles.invitation, {color: colors.textSecondary, fontSize: type.body}]}>{t('voice.invitation')}</Text> : null}
        </View>
        {voice.padiText || voice.userText || touchText ? <View style={styles.captionArea}>
          <VoiceCaption padiText={touchPhase!=='idle'?touchText:voice.padiText||touchText||'…'} userText={voice.userText} visible={showWords} onToggle={toggleWords}
            showLabel={t('voice.showWords')} hideLabel={t('voice.hideWords')} youSaidLabel={t('voice.youSaid')} />
        </View> : null}
        <View style={styles.controls}>
          {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite"
            style={{ color: colors.text, fontSize: type.bodySmall, textAlign: 'center' }}>{error}</Text> : null}
          <View style={styles.chatControls}>
            <Button title={micLabel} onPress={handleMic} icon={busy?'pause':hasConnected.current?'mic':'chatbubbles'}
              disabled={!busy&&(!voice.ready||voice.chatBusy)} variant={busy?'secondary':'primary'} />
            <Button title={t('voice.end')} onPress={handleEnd} icon="close" variant="ghost" />
          </View>
          <Text style={[styles.noticeText, { color: colors.muted, fontSize: type.micro }]}>
            {busy ? t('voice.liveHint') : hasConnected.current ? t('voice.pausedHint') : t('voice.readyHint')}
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
  invitation: {fontFamily: fonts.medium, textAlign:'center'},
  chatControls: {gap:spacing.sm, width:'100%',maxWidth:320},
  noticeText: { fontFamily: fonts.regular, lineHeight: 18, textAlign: 'center', maxWidth:310 },
});
