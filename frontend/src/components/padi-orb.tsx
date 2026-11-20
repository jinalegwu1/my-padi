import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { ReactivePortrait, type PortraitState } from '@/components/reactive-portrait';
import { useColors } from '@/constants/theme';
import { usePreferences } from '@/hooks/use-preferences';

export type OrbState = PortraitState;

type Props = {
  state: OrbState;
  size?: number;
  /** Portrait style selected in Settings. */
  voiceId?: string;
  onPress?: () => void;
  accessibilityHint?: string;
};

/**
 * Renders the selected human PADI portrait and visually responds to listening,
 * thinking, and speaking states. It is only used on the voice conversation screen.
 */
export function PadiOrb({ state, size = 220, voiceId, onPress, accessibilityHint }: Props) {
  const colors = useColors();
  const { preferences } = usePreferences();
  const reduceMotion = preferences.reduceMotion;

  const pulse = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;

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

  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.22] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.42, 0.05] });
  const rotation = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const ringSize = size * 1.5;
  const midSize = size * 1.22;

  return (
    <View
      style={[styles.wrap, { width: ringSize, height: ringSize }]}>
      {/* Outer pulse ring */}
      <Animated.View
        pointerEvents="none"
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
        pointerEvents="none"
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
          pointerEvents="none"
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
      {/* Keep the touch target still; breathing happens inside the portrait. */}
      <View
        style={[
          styles.core,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            shadowColor: colors.orbCore,
          },
        ]}>
        <ReactivePortrait voiceId={voiceId ?? preferences.voiceId} state={state} size={size}
          onPress={onPress} accessibilityHint={accessibilityHint} />
      </View>
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
});
