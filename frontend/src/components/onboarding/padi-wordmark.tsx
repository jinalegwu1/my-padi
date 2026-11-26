import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Image, Platform, StyleSheet, Text, View } from 'react-native';

import { usePreferences } from '@/hooks/use-preferences';

export const identity = {
  forest: '#102E29', gold: '#E3BC77', ivory: '#FAF8F1', mist: '#CAD7CC',
  rule: '#49615A', darkGold: '#785522', charcoal: '#19352E',
  serif: Platform.select({ ios: 'Georgia', web: 'Georgia, "Times New Roman", serif', default: 'serif' }),
};

/** Two lighting passes on the same gold knot. The lettering stays still. */
export function PadiWordmark({ large = false }: { large?: boolean }) {
  const { preferences } = usePreferences();
  const [systemReduced, setSystemReduced] = useState(true);
  const light = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted) setSystemReduced(value); });
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setSystemReduced);
    return () => { mounted = false; listener.remove(); };
  }, []);
  useEffect(() => {
    if (systemReduced || preferences.reduceMotion) return;
    const pass = (toValue: number) => Animated.timing(light, {
      toValue, duration: 2700, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== 'web',
      isInteraction: false,
    });
    const animation = Animated.loop(Animated.sequence([pass(1), pass(0)]));
    animation.start();
    return () => { animation.stop(); light.setValue(0); };
  }, [preferences.reduceMotion, systemReduced, light]);

  return <View style={styles.logo}>
    <Animated.View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={{ width: large ? 130 : 91, height: large ? 121 : 85,
        transform: [{ rotate: light.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '7deg'] }) }] }}>
      <Image source={require('../../../assets/images/onboarding/gold-knot.png')} resizeMode="contain" style={styles.metal} />
      <Animated.Image source={require('../../../assets/images/onboarding/gold-knot-light.png')} resizeMode="contain"
        style={[styles.metal, { opacity: light }]} />
    </Animated.View>
    <Text accessibilityRole="header" maxFontSizeMultiplier={1.1} style={[styles.name, { fontSize: large ? 120 : 90 }]}>PADI</Text>
  </View>;
}
const styles = StyleSheet.create({
  logo: { alignItems: 'center' },
  metal: { position: 'absolute', width: '100%', height: '100%' },
  name: { fontFamily: identity.serif, letterSpacing: 3, color: identity.gold, includeFontPadding: false },
});
