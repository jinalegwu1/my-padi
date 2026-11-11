import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { useColors } from '@/constants/theme';
import { usePreferences } from '@/hooks/use-preferences';

export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking';

type Props = {
  state: OrbState;
  size?: number;
};

/**
 * PADI's animated AI Orb.
 *
 * Only ever rendered on the voice screen — never on the main conversation screen.
 * The animation is driven by React Native's Animated API (no extra dependency) and
 * is reduced to a gentle static glow when the user turns on "Reduce motion".
 */
export function PadiOrb({ state, size = 220 }: Props) {
  const colors = useColors();
  const { preferences } = usePreferences();
  const reduceMotion = preferences.reduceMotion;

  const pulse = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;

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
      accessibilityLabel={`PADI orb, ${stateLabel}`}
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
          <View
            style={[
              styles.gloss,
              {
                width: size * 0.3,
                height: size * 0.3,
                borderRadius: size * 0.15,
                top: size * 0.14,
                left: size * 0.18,
              },
            ]}
          />
          <View
            style={[
              styles.innerGlow,
              {
                width: size * 0.62,
                height: size * 0.62,
                borderRadius: size * 0.31,
              },
            ]}
          />
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
  gloss: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.5)' },
  innerGlow: { backgroundColor: 'rgba(255,255,255,0.12)' },
});
