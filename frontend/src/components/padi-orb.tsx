import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { useColors } from '@/constants/theme';
import { findVoice } from '@/data/languages';
import { usePreferences } from '@/hooks/use-preferences';

export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking';

type Props = {
  state: OrbState;
  size?: number;
  /** Portrait style selected in Settings. */
  voiceId?: string;
};

/**
 * Renders the selected human PADI portrait and visually responds to listening,
 * thinking, and speaking states. It is only used on the voice conversation screen.
 */
export function PadiOrb({ state, size = 220, voiceId }: Props) {
  const colors = useColors();
  const { preferences } = usePreferences();
  const reduceMotion = preferences.reduceMotion;
  const voice = findVoice(voiceId ?? preferences.voiceId);

  const pulse = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;
  const mouth = useRef(new Animated.Value(0)).current;

  /** Animate the portrait's mouth only while PADI is speaking. */
  useEffect(() => {
    if (reduceMotion || state !== 'speaking') {
      mouth.stopAnimation();
      mouth.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(mouth, { toValue: 1, duration: 180, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(mouth, { toValue: 0.25, duration: 220, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(mouth, { toValue: 0.75, duration: 160, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(mouth, { toValue: 0, duration: 200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [mouth, reduceMotion, state]);

  // Outer pulse: fast while listening, slow while speaking, still when idle.
  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(0.35);
      return;
    }
    const duration = state === 'listening' ? 1100 : state === 'thinking' ? 1500 : state === 'speaking' ? 1900 : 3200;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion, state]);

  // Slow rotation of the outer ring while PADI is thinking.
  useEffect(() => {
    if (reduceMotion || state !== 'thinking') {
      spin.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 2600,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin, reduceMotion, state]);

  // Gentle breathing of the core.
  useEffect(() => {
    if (reduceMotion) {
      breathe.setValue(0.5);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1,
          duration: 2400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(breathe, {
          toValue: 0,
          duration: 2400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breathe, reduceMotion]);

  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.22] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.42, 0.05] });
  const coreScale = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1.05] });
  const rotation = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const mouthScale = mouth.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1.45] });

  const ringSize = size * 1.5;
  const midSize = size * 1.22;

  const stateLabel = useMemo(() => {
    switch (state) {
      case 'listening':
        return 'listening';
      case 'thinking':
        return 'thinking';
      case 'speaking':
        return 'speaking';
      default:
        return 'idle';
    }
  }, [state]);

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${voice.imageDescription}, PADI ${stateLabel}`}
      style={[styles.wrap, { width: ringSize, height: ringSize }]}>
      {/* Outer pulse ring */}
      <Animated.View
        style={[
          styles.ring,
          {
            width: ringSize,
            height: ringSize,
            borderRadius: ringSize / 2,
            borderColor: colors.orbGlow,
            opacity: ringOpacity,
            transform: [{ scale: ringScale }],
          },
        ]}
      />
      {/* Mid halo */}
      <View
        style={[
          styles.halo,
          {
            width: midSize,
            height: midSize,
            borderRadius: midSize / 2,
            backgroundColor: colors.orbGlow,
            opacity: 0.14,
          },
        ]}
      />
      {/* Rotating dashed ring while thinking */}
      {state === 'thinking' ? (
        <Animated.View
          style={[
            styles.ring,
            {
              width: midSize,
              height: midSize,
              borderRadius: midSize / 2,
              borderColor: colors.orbCore,
              borderStyle: 'dashed',
              opacity: 0.55,
              transform: [{ rotate: rotation }],
            },
          ]}
        />
      ) : null}
      {/* Core */}
      <Animated.View style={{ transform: [{ scale: coreScale }] }}>
        <LinearGradient
          colors={[colors.orbCore, colors.orbGlow]}
          start={{ x: 0.15, y: 0 }}
          end={{ x: 0.85, y: 1 }}
          style={[
            styles.core,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              shadowColor: colors.orbCore,
            },
          ]}>
          <Image
            source={{ uri: voice.imageUrl }}
            contentFit="cover"
            transition={reduceMotion ? 0 : 220}
            style={styles.portrait}
            accessibilityLabel={voice.imageDescription}
          />
          <View
            pointerEvents="none"
            style={[
              styles.listeningShade,
              {
                backgroundColor: state === 'listening' ? 'rgba(82, 109, 255, 0.18)' : state === 'thinking' ? 'rgba(12, 18, 35, 0.28)' : 'rgba(12, 18, 35, 0.08)',
              },
            ]}
          />
          {state === 'speaking' ? (
            <Animated.View
              pointerEvents="none"
              accessibilityElementsHidden
              style={[
                styles.mouth,
                {
                  width: size * 0.055,
                  height: size * 0.018,
                  borderRadius: size * 0.02,
                  transform: [{ scaleY: mouthScale }],
                },
              ]}
            />
          ) : null}
        </LinearGradient>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', borderWidth: 1.5 },
  halo: { position: 'absolute' },
  core: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowOpacity: 0.5,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  portrait: { width: '100%', height: '100%' },
  listeningShade: { ...StyleSheet.absoluteFillObject },
  mouth: {
    position: 'absolute',
    left: '47.25%',
    top: '68%',
    backgroundColor: '#7A2F35',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
  },
});
