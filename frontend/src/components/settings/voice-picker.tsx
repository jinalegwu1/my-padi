import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import { ReactivePortrait } from '@/components/reactive-portrait';
import { fonts, radius, spacing, useColors, useType } from '@/constants/theme';
import { VOICES } from '@/data/languages';
import { usePreferences } from '@/hooks/use-preferences';
import { speakPortraitGreeting, stopPadiSpeech } from '@/lib/speech';
import { previewVoice } from '@/lib/voice-preview';
import { subscribeSession } from '@/lib/session';
import type { VoiceOption } from '@/types';

type Props = {
  labels: {
    female: string;
    male: string;
    preview: string;
    stop: string;
    speed: string;
  };
};

/**
 * Selects a human PADI voice/persona and previews its natural spoken style.
 * The picked identity is reused by the listening and reply voice screen.
 */
export function VoicePicker({ labels }: Props) {
  const colors = useColors();
  const type = useType();
  const { preferences, update } = usePreferences();
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState('');
  const preview=useRef<AbortController|null>(null);
  const [hasStarted,setHasStarted]=useState(false);
  const [playingWords,setPlayingWords]=useState('');
  const [touch,setTouch]=useState({voiceId:'',version:0});

  useEffect(
    () => {
      const unsubscribe=subscribeSession(()=>{preview.current?.abort();preview.current=null;setPreviewing(null);setHasStarted(false);});
      return () => {preview.current?.abort();void stopPadiSpeech();unsubscribe();};
    },
    [],
  );

  const startPreview = (voice: VoiceOption, greeting=false) => {
    preview.current?.abort();
    const controller=new AbortController();preview.current=controller;
    setPreviewError('');
    setPreviewing(voice.id);
    setHasStarted(false);
    setPlayingWords(voice.sample);
    void stopPadiSpeech();
    const started=()=>{if(!controller.signal.aborted&&preview.current===controller)setHasStarted(true);};
    const words=(text:string)=>{if(!controller.signal.aborted&&preview.current===controller)setPlayingWords(text);};
    const playback=greeting?speakPortraitGreeting(voice.id,preferences.languageCode,preferences.voiceRate,controller.signal,started,words)
      :previewVoice(voice.sample,voice.id,preferences.voiceRate,controller.signal,started,preferences.languageCode,words);
    void playback
      .catch(error=>{if(!controller.signal.aborted&&preview.current===controller)setPreviewError(error instanceof Error?error.message:'Voice preview failed.');})
      .finally(()=>{if(preview.current===controller){preview.current=null;setPreviewing(null);setHasStarted(false);}});
  };

  const stopPreview = () => {
    preview.current?.abort();preview.current=null;setHasStarted(false);
    void stopPadiSpeech();
    setPreviewing(null);
  };

  const selectVoice = (voice: VoiceOption) => {
    setTouch(previous=>({voiceId:voice.id,version:previous.version+1}));
    update({ voiceId: voice.id });
    startPreview(voice,true);
  };

  const renderVoice = (voice: VoiceOption) => {
    const selected = voice.id === preferences.voiceId;
    const isPreviewing = previewing === voice.id;
    return (
      <View
        key={voice.id}
        style={[
          styles.voiceCard,
          {
            backgroundColor: selected ? colors.primarySoft : colors.card,
            borderColor: selected ? colors.primary : colors.border,
          },
        ]}>
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ selected }}
          accessibilityLabel={`${voice.name}, ${voice.gender} voice, ${voice.accent}. ${voice.description}`}
          onPress={() => selectVoice(voice)}
          style={({ pressed }) => [styles.voiceMain, pressed && { opacity: 0.75 }]}>
          {({ pressed }) => (
            <>
              <ReactivePortrait
                voiceId={voice.id}
                size={64}
                interactive={false}
                pressed={pressed}
                touchVersion={touch.voiceId===voice.id?touch.version:0}
                state={isPreviewing ? hasStarted ? 'speaking' : 'thinking' : selected ? 'listening' : 'idle'}
              />
              <View style={styles.voiceText}>
                <Text style={[styles.voiceName, { color: colors.text, fontSize: type.body }]}>
                  {voice.name}
                </Text>
                <Text style={[styles.voiceMeta, { color: colors.muted, fontSize: type.caption }]}>
                  {voice.accent} · {voice.description}
                </Text>
              </View>
              {selected ? (
                <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
              ) : null}
            </>
          )}
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isPreviewing ? labels.stop : `${labels.preview}: ${voice.name}`}
          onPress={() => (isPreviewing ? stopPreview() : startPreview(voice))}
          hitSlop={6}
          style={({ pressed }) => [
            styles.previewButton,
            {
              backgroundColor: isPreviewing ? colors.primary : colors.cardMuted,
              opacity: pressed ? 0.75 : 1,
            },
          ]}>
          <Ionicons
            name={isPreviewing ? 'stop' : 'play'}
            size={14}
            color={isPreviewing ? colors.onPrimary : colors.primary}
          />
          <Text
            style={[
              styles.previewText,
              {
                color: isPreviewing ? colors.onPrimary : colors.primary,
                fontSize: type.micro,
              },
            ]}>
            {isPreviewing ? labels.stop : labels.preview}
          </Text>
        </Pressable>
      </View>
    );
  };

  const female = VOICES.filter((v) => v.gender === 'female');
  const male = VOICES.filter((v) => v.gender === 'male');
  const active = VOICES.find((v) => v.id === previewing);
  const character = active ?? VOICES.find(v=>v.id===preferences.voiceId) ?? VOICES[0];

  return (
    <View style={styles.wrap}>
      <View style={styles.characterStage}>
        <ReactivePortrait voiceId={character.id} size={140} onPress={()=>selectVoice(character)}
          touchVersion={touch.voiceId===character.id?touch.version:0}
          state={active ? hasStarted?'speaking':'thinking':'listening'} />
        <Text style={[styles.previewText,{color:colors.muted,fontSize:type.caption}]}>Tap a face to hear a greeting.</Text>
      </View>
      {active && hasStarted ? (
        <View
          style={[
            styles.nowPlaying,
            { backgroundColor: colors.accentSoft, borderColor: colors.border },
          ]}>
          <PreviewBars />
          <Text style={[styles.nowPlayingText, { color: colors.text, fontSize: type.caption }]}>
            “{playingWords}”
          </Text>
        </View>
      ) : null}
      {active&&!hasStarted?<Text style={{color:colors.muted,fontSize:type.caption}}>Preparing voice preview…</Text>:null}

      <Text style={[styles.groupLabel, { color: colors.muted, fontSize: type.micro }]}>
        {labels.female.toUpperCase()}
      </Text>
      {female.map(renderVoice)}

      <Text
        style={[
          styles.groupLabel,
          styles.groupLabelSpaced,
          { color: colors.muted, fontSize: type.micro },
        ]}>
        {labels.male.toUpperCase()}
      </Text>
      {male.map(renderVoice)}

      <View style={styles.speedBlock}>
        <Text style={[styles.groupLabel, { color: colors.muted, fontSize: type.micro }]}>
          {labels.speed.toUpperCase()}
        </Text>
        <View style={styles.speedRow}>
          {[0.85, 1, 1.15].map((rate) => {
            const selected = Math.abs(preferences.voiceRate - rate) < 0.01;
            return (
              <Pressable
                key={rate}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`${rate}x`}
                onPress={() => update({ voiceRate: rate })}
                style={({ pressed }) => [
                  styles.speedChip,
                  {
                    backgroundColor: selected ? colors.primary : colors.card,
                    borderColor: selected ? colors.primary : colors.border,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}>
                <Text
                  style={[
                    styles.speedText,
                    {
                      color: selected ? colors.onPrimary : colors.textSecondary,
                      fontSize: type.caption,
                    },
                  ]}>
                  {rate === 1 ? 'Normal' : `${rate}×`}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {previewError ? (
        <Text accessibilityRole="alert" style={[styles.noticeText, { color: colors.danger }]}>
          {previewError}
        </Text>
      ) : null}
      <View style={styles.notice}>
        <Ionicons name="information-circle-outline" size={14} color={colors.muted} />
        <Text style={[styles.noticeText, { color: colors.muted, fontSize: type.micro }]}>
          Previews use the same expressive voice as conversations. An internet connection is needed.
        </Text>
      </View>
    </View>
  );
}

/** Small animated bars shown while a voice preview is "playing". */
function PreviewBars() {
  const colors = useColors();
  const { preferences } = usePreferences();
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (preferences.reduceMotion) {
      anim.setValue(0.5);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, {
          toValue: 1,
          duration: 420,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(anim, {
          toValue: 0,
          duration: 420,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [anim, preferences.reduceMotion]);

  return (
    <View style={styles.bars}>
      {[0.5, 1, 0.7].map((factor, index) => (
        <Animated.View
          key={index}
          style={[
            styles.bar,
            {
              backgroundColor: colors.accent,
              transform: [
                {
                  scaleY: anim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [factor * 0.5, factor * 1.6],
                  }),
                },
              ],
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  characterStage: {alignItems:'center', gap:spacing.sm, paddingVertical:spacing.sm},
  groupLabel: {
    fontFamily: fonts.semibold,
    letterSpacing: 0.7,
    marginTop: spacing.xs,
  },
  groupLabelSpaced: { marginTop: spacing.md },
  voiceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingStart: spacing.md,
    paddingEnd: spacing.sm,
    paddingVertical: spacing.sm,
  },
  voiceMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  voiceText: { flex: 1, gap: 1 },
  voiceName: { fontFamily: fonts.semibold },
  voiceMeta: { fontFamily: fonts.regular },
  previewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm,
  },
  previewText: { fontFamily: fonts.semibold },
  nowPlaying: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  nowPlayingText: { flex: 1, fontFamily: fonts.medium, fontStyle: 'italic' },
  bars: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 20 },
  bar: { width: 3, height: 12, borderRadius: 2 },
  speedBlock: { gap: spacing.sm, marginTop: spacing.sm },
  speedRow: { flexDirection: 'row', gap: spacing.sm },
  speedChip: {
    flex: 1,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  speedText: { fontFamily: fonts.medium },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs, marginTop: spacing.sm },
  noticeText: { flex: 1, fontFamily: fonts.regular, lineHeight: 16 },
});
