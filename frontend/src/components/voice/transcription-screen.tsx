import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PadiOrb, type OrbState } from '@/components/padi-orb';
import { Button } from '@/components/ui/button';
import { fonts, spacing, useColors, useType } from '@/constants/theme';
import { usePreferences } from '@/hooks/use-preferences';
import { useTranscriptionSession } from '@/hooks/use-transcription-session';

/** PADI's incoming recording and transcript screen; it never submits to AI. */
export function TranscriptionScreen() {
  const router = useRouter();
  const colors = useColors();
  const type = useType();
  const { width } = useWindowDimensions();
  const { preferences } = usePreferences();
  const voice = useTranscriptionSession();
  const [language, setLanguage] = useState('auto');
  const [details, setDetails] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const busy = voice.phase !== 'idle';
  useEffect(() => {
    if (voice.phase !== 'recording') return;
    setElapsed(0);
    const began = Date.now();
    const timer = setInterval(() => setElapsed((Date.now() - began) / 1000), 100);
    return () => clearInterval(timer);
  }, [voice.phase]);
  useFocusEffect(useCallback(() => () => { void voice.session.cancel(); }, [voice.session]));
  const close = () => {
    void voice.session.cancel();
    if (router.canGoBack()) router.back(); else router.replace('/(tabs)/chat');
  };
  const start = () => { void voice.session.start(language); };
  const phaseLabel = {
    idle: voice.transcript ? 'Your transcript is ready' : 'Ready to record',
    preparing: 'Starting microphone…', recording: `Recording · ${elapsed.toFixed(1)}s`,
    compressing: 'Finishing audio compression…', uploading: `Uploading audio${voice.progress ? ` · ${Math.round(voice.progress)}%` : '…'}`,
    processing: 'Processing speech…',
  }[voice.phase];
  const orb: OrbState = voice.phase === 'recording' ? 'listening' : busy ? 'thinking' : 'idle';
  const result = voice.transcript;
  const error = voice.error ?? voice.configurationError;
  const bytes = (value: number) => `${value.toLocaleString()} bytes (${(value / 1024).toFixed(1)} KiB)`;
  const ms = (value: number) => `${(value / 1000).toFixed(2)}s`;
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top','left','right','bottom']}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close voice" onPress={close} hitSlop={10}>
          <Ionicons name="chevron-down" size={24} color={colors.textSecondary}/>
        </Pressable>
        <Text style={{ fontFamily: fonts.semibold, color: colors.text, fontSize: type.subheading }}>PADI · Voice to text</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Switch to text" onPress={close} hitSlop={10}>
          <Ionicons name="chatbubble-outline" size={23} color={colors.primary}/>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.portrait}>
          <PadiOrb state={orb} voiceId={preferences.voiceId} size={Math.min(210, width * .5)}/>
          <Text accessibilityLiveRegion="polite" style={{ fontFamily: fonts.medium, color: colors.text, fontSize: type.body }}>{phaseLabel}</Text>
        </View>
        <Text style={{ color: colors.textSecondary, fontSize: type.bodySmall, textAlign: 'center' }}>Record a sentence, stop, and compare the recognised words. Maximum 60 seconds.</Text>
        <View style={styles.languages}>
          {([['auto','Automatic'],['en','English'],['pcm-NG','Nigerian Pidgin']] as const).map(([code,label]) => (
            <Pressable key={code} accessibilityRole="button" accessibilityLabel={`Recognition language: ${label}`} accessibilityState={{ selected: code === language, disabled: busy }} disabled={busy}
              onPress={() => setLanguage(code)} style={[styles.choice, { backgroundColor: code === language ? colors.primarySoft : colors.card, borderColor: colors.border }]}>
              <Text style={{ color: code === language ? colors.primary : colors.text, fontSize: type.caption }}>{label}</Text>
            </Pressable>
          ))}
        </View>
        {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ color: colors.text, fontSize: type.bodySmall }}>{error}</Text> : null}
        {voice.phase === 'recording' ? <Button title="Stop and transcribe" icon="stop" onPress={() => { void voice.session.finish(); }}/>
          : !busy ? <Button title={result ? 'Record another sentence' : 'Start recording'} icon="mic" disabled={!voice.ready} onPress={start}/>
          : <Button title="Cancel processing" variant="secondary" onPress={() => { void voice.session.cancel(); }}/>
        }
        {voice.phase === 'recording' || voice.phase === 'preparing' ? <Button title="Cancel recording" variant="ghost" onPress={() => { void voice.session.cancel(); }}/> : null}
        <Button title="Voice conversation" variant="ghost" onPress={() => { void voice.session.cancel(); router.replace('/voice'); }}/>
        {result ? <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={{ color: colors.primary, fontFamily: fonts.semibold, fontSize: type.caption }}>Recognised text</Text>
          <Text selectable testID="voice-transcript" accessibilityLiveRegion="polite" style={{ color: colors.text, fontSize: type.body }}>{result.text}</Text>
          <Text style={{ color: colors.muted, fontSize: type.caption }}>{result.language_detected ? `Detected language: ${result.language} · ${(result.language_probability * 100).toFixed(0)}% language confidence` : `Recognition language: ${result.language} (selected)`}</Text>
        </View> : null}
        {voice.recording || result ? <Pressable accessibilityRole="button" accessibilityLabel="Audio details" accessibilityState={{ expanded: details }} onPress={() => setDetails(value => !value)}>
          <Text style={{ color: colors.primary, fontSize: type.caption }}>{details ? 'Hide audio details' : 'Show audio details'}</Text>
        </Pressable> : null}
        {details ? <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {voice.recording ? <>
            <Text style={{ color: colors.textSecondary }}>Recorded format: {voice.recording.mime}</Text>
            <Text style={{ color: colors.textSecondary }}>Compressed recording: {bytes(voice.recording.audioBytes)}</Text>
            {voice.recording.pcmBytes > 0 ? <Text style={{ color: colors.textSecondary }}>Captured PCM (16 kHz mono): {bytes(voice.recording.pcmBytes)}</Text> : null}
            <Text style={{ color: colors.textSecondary }}>Compression finalisation: {ms(voice.recording.compressionMs)}</Text>
          </> : null}
          {result ? <>
            <Text style={{ color: colors.textSecondary }}>Validated format: {result.container} / {result.codec}</Text>
            <Text style={{ color: colors.textSecondary }}>Duration: {result.duration_seconds.toFixed(2)}s</Text>
            <Text style={{ color: colors.textSecondary }}>Uploaded audio: {bytes(result.audio_bytes)}</Text>
            <Text style={{ color: colors.textSecondary }}>Decoded PCM (16 kHz mono): {bytes(result.decoded_pcm_bytes)}</Text>
            <Text style={{ color: colors.textSecondary }}>Upload saving against decoded PCM: {(100 * (1 - result.audio_bytes / result.decoded_pcm_bytes)).toFixed(1)}%</Text>
            <Text style={{ color: colors.textSecondary }}>Compression ratio: {(result.decoded_pcm_bytes / result.audio_bytes).toFixed(2)}×</Text>
            <Text style={{ color: colors.textSecondary }}>Upload: {voice.uploadMs > 0 ? ms(voice.uploadMs) : 'not reported'}</Text>
            <Text style={{ color: colors.textSecondary }}>Decoding: {ms(result.decode_ms)}</Text>
            <Text style={{ color: colors.textSecondary }}>Audio preparation: {ms(result.prepare_ms)}</Text>
            <Text style={{ color: colors.textSecondary }}>Transcription: {ms(result.transcription_ms)}</Text>
            <Text style={{ color: colors.textSecondary }}>Total after stopping: {ms(voice.totalMs)}</Text>
          </> : null}
        </View> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1 }, header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.base },
  content: { padding: spacing.base, gap: spacing.base }, portrait: { alignItems: 'center', gap: spacing.sm },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, padding: spacing.base, gap: spacing.sm },
  languages: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, choice: { padding: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12 },
});
