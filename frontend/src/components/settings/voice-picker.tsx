import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { fonts, radius, spacing, useColors, useType } from '@/constants/theme';
import { VOICES } from '@/data/languages';
import { usePreferences } from '@/hooks/use-preferences';
import type { VoiceOption } from '@/types';

type Props = {
  labels: {
    female: string;
    male: string;
    preview: string;
    stop: string;
    speed: string;
    simulated: string;
  };
};

/**
 * Voice selection with male and female options and a preview player.
 * The preview is simulated in the UI only — no speech service is connected.
 */
export function VoicePicker({ labels }: Props) {
  const colors = useColors();
  const type = useType();
  const { preferences, update } = usePreferences();
  const [previewing, setPreviewing] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const startPreview = (voice: VoiceOption) => {
    if (timer.current) clearTimeout(timer.current);
    setPreviewing(voice.id);
    timer.current = setTimeout(() => setPreviewing(null), 3200);
  };

  const stopPreview = () => {
    if (timer.current) clearTimeout(timer.current);
    setPreviewing(null);
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
          onPress={() => update({ voiceId: voice.id })}
          style={({ pressed }) => [styles.voiceMain, pressed && { opacity: 0.75 }]}>
          <View
            style={[
              styles.voiceIcon,
              { backgroundColor: selected ? colors.primary : colors.cardMuted },
            ]}>
            <Ionicons
              name={voice.gender === 'female' ? 'woman' : 'man'}
              size={17}
              color={selected ? colors.onPrimary : colors.muted}
            />
          </View>
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

  return (
    <View style={styles.wrap}>
      {active ? (
        <View
          style={[
            styles.nowPlaying,
            { backgroundColor: colors.accentSoft, borderColor: colors.border },
          ]}>
          <PreviewBars />
          <Text style={[styles.nowPlayingText, { color: colors.text, fontSize: type.caption }]}>
            “{active.sample}”
          </Text>
        </View>
      ) : null}

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

      <View style={styles.notice}>
        <Ionicons name="information-circle-outline" size={14} color={colors.muted} />
        <Text style={[styles.noticeText, { color: colors.muted, fontSize: type.micro }]}>
          {labels.simulated}
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
  voiceIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
