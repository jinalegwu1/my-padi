import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { fonts, radius, shadow, spacing, useColors, useType } from '@/constants/theme';

type Props = {
  onSend: (text: string) => void;
  onOpenVoice: () => void;
  placeholder: string;
  sendLabel: string;
  voiceLabel: string;
  disabled?: boolean;
};

/**
 * Message composer: text field, send button and the voice activation button.
 * Voice is only ever started by the user tapping the microphone.
 */
export function Composer({
  onSend,
  onOpenVoice,
  placeholder,
  sendLabel,
  voiceLabel,
  disabled,
}: Props) {
  const colors = useColors();
  const type = useType();
  const [text, setText] = useState('');
  const canSend = text.trim().length > 0 && !disabled;

  const handleSend = () => {
    if (!canSend) return;
    onSend(text);
    setText('');
  };

  return (
    <View
      style={[
        styles.wrap,
        { backgroundColor: colors.background, borderTopColor: colors.border },
      ]}>
      <View
        style={[
          styles.field,
          { backgroundColor: colors.inputBackground, borderColor: colors.border },
        ]}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          accessibilityLabel={placeholder}
          multiline
          maxLength={2000}
          onSubmitEditing={handleSend}
          blurOnSubmit={false}
          style={[
            styles.input,
            { color: colors.text, fontSize: type.body, fontFamily: fonts.regular },
          ]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={sendLabel}
          accessibilityState={{ disabled: !canSend }}
          disabled={!canSend}
          onPress={handleSend}
          hitSlop={6}
          style={({ pressed }) => [
            styles.sendButton,
            {
              backgroundColor: canSend ? colors.primary : colors.borderStrong,
              opacity: pressed ? 0.8 : 1,
            },
          ]}>
          <Ionicons name="arrow-up" size={20} color={canSend ? colors.onPrimary : colors.card} />
        </Pressable>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={voiceLabel}
        accessibilityHint="Opens the voice conversation screen"
        onPress={onOpenVoice}
        style={({ pressed }) => [
          styles.voiceButton,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            opacity: pressed ? 0.8 : 1,
          },
        ]}>
        <Ionicons name="mic" size={22} color={colors.primary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.base,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingStart: spacing.base,
    paddingEnd: spacing.xs,
    paddingVertical: spacing.xs,
    minHeight: 50,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  voiceButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.card,
  },
});
