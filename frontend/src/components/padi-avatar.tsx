import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { fonts, useColors } from '@/constants/theme';

type Props = {
  size?: number;
  /** Shows a small online dot. */
  online?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Renders the letter mark instead of the gradient orb. */
  letter?: boolean;
};

/**
 * PADI's identity mark: a small gradient orb with a soft ring.
 * Deliberately compact — the full animated Orb belongs to the voice screen only.
 */
export function PadiAvatar({ size = 40, online = false, style, letter = false }: Props) {
  const colors = useColors();
  const dot = Math.max(9, Math.round(size * 0.26));

  return (
    <View style={[{ width: size, height: size }, style]}>
      <LinearGradient
        colors={[colors.orbCore, colors.orbGlow]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={[
          styles.orb,
          { width: size, height: size, borderRadius: size / 2, borderColor: colors.card },
        ]}>
        {letter ? (
          <Text
            style={[
              styles.letter,
              { fontSize: Math.round(size * 0.42), color: '#FFFFFF', fontFamily: fonts.extrabold },
            ]}>
            P
          </Text>
        ) : (
          <View
            style={[
              styles.highlight,
              {
                width: size * 0.34,
                height: size * 0.34,
                borderRadius: size * 0.17,
                top: size * 0.16,
                left: size * 0.18,
              },
            ]}
          />
        )}
      </LinearGradient>
      {online ? (
        <View
          style={[
            styles.dot,
            {
              width: dot,
              height: dot,
              borderRadius: dot / 2,
              backgroundColor: colors.success,
              borderColor: colors.background,
            },
          ]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  orb: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    overflow: 'hidden',
  },
  highlight: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.45)' },
  letter: { letterSpacing: -0.5 },
  dot: { position: 'absolute', right: -1, bottom: -1, borderWidth: 2 },
});
