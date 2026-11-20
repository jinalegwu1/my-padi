import { Image } from 'expo-image';
import { useCallback, useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';

import { useColors } from '@/constants/theme';
import { findVoice, VOICES } from '@/data/languages';
import { portraitRig } from '@/data/portrait-rigs';
import { usePreferences } from '@/hooks/use-preferences';
import { subscribePortraitSpeech } from '@/lib/portrait-speech';

export type PortraitState = 'idle' | 'listening' | 'thinking' | 'speaking';

type Props = {
  voiceId: string;
  state?: PortraitState;
  size: number;
  /** Picker rows own selection and pass their touch state through. */
  interactive?: boolean;
  pressed?: boolean;
  /** A completed picker tap must react even when press-in/out are batched. */
  touchVersion?: number;
  onPress?: () => void;
  accessibilityHint?: string;
};

/** The same face rig powers every picker portrait and the live conversation. */
export function ReactivePortrait({ voiceId, state = 'idle', size, interactive = true, pressed, touchVersion = 0, onPress, accessibilityHint }: Props) {
  const colors = useColors();
  const { preferences } = usePreferences();
  const { reduceMotion } = preferences;
  const voice = findVoice(voiceId);
  const rig = portraitRig(voice.id);
  const breath = useRef(new Animated.Value(0)).current;
  const attention = useRef(new Animated.Value(0)).current;
  const blink = useRef(new Animated.Value(0)).current;
  const mouth = useRef(new Animated.Value(0)).current;
  const reaction = useRef(new Animated.Value(0)).current;
  const contact = useRef(new Animated.Value(0)).current;
  const touchBlink = useRef(new Animated.Value(0)).current;
  const lastMouthLevel = useRef(0);
  const touchAnimation = useRef<Animated.CompositeAnimation | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reactToTouch = useCallback(() => {
    touchAnimation.current?.stop();
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    contact.stopAnimation();
    contact.setValue(1);
    reaction.setValue(0);
    touchBlink.setValue(0);
    if (reduceMotion) {
      touchBlink.setValue(1);
      feedbackTimer.current = setTimeout(() => {contact.setValue(0);touchBlink.setValue(0);}, 200);
      return;
    }
    const animation = Animated.parallel([
      Animated.sequence([
        Animated.timing(touchBlink, {toValue:1,duration:70,useNativeDriver:true}),
        Animated.delay(90),
        Animated.timing(touchBlink, {toValue:0,duration:130,useNativeDriver:true}),
      ]),
      Animated.sequence([
        Animated.timing(reaction, { toValue: 1, duration: 140, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(reaction, { toValue: -.35, duration: 180, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(reaction, { toValue: .18, duration: 160, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(reaction, { toValue: 0, duration: 180, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
      Animated.timing(contact, { toValue: 0, duration: 650, useNativeDriver: true }),
    ]);
    touchAnimation.current = animation;
    animation.start();
  }, [contact, reaction, reduceMotion, touchBlink]);

  useEffect(() => {
    touchAnimation.current?.stop();
    reaction.setValue(0);
    contact.setValue(0);
    touchBlink.setValue(0);
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    return () => {
      touchAnimation.current?.stop();
      contact.stopAnimation();
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    };
  }, [contact, reaction, reduceMotion, touchBlink, voice.id]);

  useEffect(() => {
    if (pressed) reactToTouch();
  }, [pressed, reactToTouch]);

  useEffect(() => {
    if (touchVersion > 0) reactToTouch();
  }, [touchVersion, reactToTouch, voice.id]);

  useEffect(() => {
    breath.setValue(0);
    blink.setValue(0);
    if (reduceMotion) return;
    const breathing = Animated.loop(Animated.sequence([
      Animated.timing(breath, { toValue: 1, duration: 2300, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(breath, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    // Each person blinks at a different interval instead of blinking together.
    const offset = VOICES.findIndex(option => option.id === voice.id);
    const blinking = Animated.loop(Animated.sequence([
      Animated.delay(1200 + offset * 200),
      Animated.timing(blink, { toValue: 1, duration: 95, useNativeDriver: true }),
      Animated.delay(85),
      Animated.timing(blink, { toValue: 0, duration: 160, useNativeDriver: true }),
    ]));
    breathing.start();
    blinking.start();
    return () => { breathing.stop(); blinking.stop(); };
  }, [blink, breath, reduceMotion, voice.id]);

  useEffect(() => {
    attention.setValue(0);
    if (reduceMotion || state === 'idle') return;
    const duration = state === 'speaking' ? 380 : state === 'listening' ? 650 : 1200;
    const motion = Animated.loop(Animated.sequence([
      Animated.timing(attention, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(attention, { toValue: -.35, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(attention, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.delay(state === 'listening' ? 1600 : 300),
    ]));
    motion.start();
    return () => motion.stop();
  }, [attention, reduceMotion, state]);

  useEffect(() => {
    mouth.setValue(0);
    lastMouthLevel.current = 0;
    // The playing audio drives the lips, including silent pauses. Functional
    // speech feedback remains available when decorative motion is reduced.
    const unsubscribe = subscribePortraitSpeech(snapshot => {
      const level = snapshot.voiceId === voice.id ? snapshot.level : 0;
      if (level === lastMouthLevel.current) return;
      lastMouthLevel.current = level;
      mouth.stopAnimation();
      if (reduceMotion || level === 0) mouth.setValue(level);
      else Animated.timing(mouth, {toValue:level,duration:55,easing:Easing.out(Easing.quad),useNativeDriver:true}).start();
    });
    return () => { unsubscribe(); mouth.stopAnimation(); mouth.setValue(0); };
  }, [mouth, reduceMotion, voice.id]);

  const imageSize = size * (rig.zoom ?? 1.4);
  const [focusX, focusY] = rig.focus ?? [300, 240];
  const [left, top, width, height] = rig.mouthBox.map(value => value * imageSize / 600);
  const face = (
    <>
      <Animated.View
        testID={`padi-portrait-${voice.id}-face`}
        pointerEvents="none"
        style={[styles.imageLayer, {
          width:imageSize,height:imageSize,
          left:size*.5-focusX*imageSize/600,
          top:Math.min(0,size*.45-focusY*imageSize/600),
          transform: [
            { scale: breath.interpolate({ inputRange: [0, 1], outputRange: [1.015, 1.035] }) },
            { scale: reaction.interpolate({ inputRange: [-1, 0, 1], outputRange: [1.005, 1, 1.045] }) },
            { translateY: Animated.add(
              attention.interpolate({ inputRange: [-1, 0, 1], outputRange: [-size * .008, 0, size * .008] }),
              reaction.interpolate({ inputRange: [-1, 0, 1], outputRange: [size * .016, 0, -size * .016] }),
            ) },
            { rotate: Animated.add(
              attention.interpolate({ inputRange: [-1, 1], outputRange: state === 'thinking' ? [-1.8, 1.8] : [-.6, .6] }),
              reaction.interpolate({ inputRange: [-1, 1], outputRange: [-5, 5] }),
            ).interpolate({ inputRange: [-10, 10], outputRange: ['-10deg', '10deg'] }) },
          ],
        }]}>
        <Image source={rig.photo} contentFit="fill" style={styles.photo} accessible={false} />
        <Animated.View testID={`padi-portrait-${voice.id}-blink`} style={[styles.face, { opacity: Animated.add(blink,touchBlink).interpolate({inputRange:[0,1],outputRange:[0,1],extrapolate:'clamp'}) }]}>
          <Image source={rig.blink} contentFit="fill" style={styles.photo} accessible={false} />
        </Animated.View>
        <Animated.View
          testID={`padi-portrait-${voice.id}-mouth`}
          style={{ position: 'absolute', left, top, width, height,
            opacity: mouth,
          }}>
          <Image source={rig.mouthOpen} contentFit="fill" style={styles.photo} accessible={false} />
        </Animated.View>
      </Animated.View>
      <Animated.View testID={`padi-portrait-${voice.id}-touch`} pointerEvents="none" style={[styles.touchRing, {
        borderColor: colors.primary, borderRadius: size / 2, opacity: contact,
      }]} />
    </>
  );
  const style = [styles.wrap, { width: size, height: size, borderRadius: size / 2, backgroundColor: colors.cardMuted }];

  return interactive ? (
    <Pressable testID={`padi-portrait-${voice.id}`} accessibilityRole="button" accessibilityLabel={`${voice.name} portrait, PADI ${state}`}
      accessibilityHint={accessibilityHint ?? `Touch to hear ${voice.name} greet you`} onPress={() => { reactToTouch(); onPress?.(); }}
      onPressIn={() => { contact.stopAnimation(); contact.setValue(1); }}
      onPressOut={() => { if (!reduceMotion) Animated.timing(contact, { toValue: 0, duration: 250, useNativeDriver: true }).start(); else contact.setValue(0); }}
      style={style}>
      {face}
    </Pressable>
  ) : <View testID={`padi-portrait-${voice.id}`} pointerEvents="none" style={style}>{face}</View>;
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden' },
  face: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 },
  imageLayer: {position:'absolute'},
  photo: { width: '100%', height: '100%' },
  touchRing: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, borderWidth: 3 },
});
