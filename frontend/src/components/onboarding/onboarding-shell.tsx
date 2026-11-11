import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fonts, radius, spacing, useColors, useType } from '@/constants/theme';

type Props = {
  step: number;
  totalSteps: number;
  stepLabel: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer: ReactNode;
  onBack?: () => void;
  backLabel?: string;
};

/**
 * Shared frame for the four onboarding steps: progress indicator, heading,
 * scrollable body and a pinned footer with the primary action.
 */
export function OnboardingShell({
  step,
  totalSteps,
  stepLabel,
  title,
  subtitle,
  children,
  footer,
  onBack,
  backLabel,
}: Props) {
  const colors = useColors();
  const type = useType();

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            {onBack ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={backLabel ?? 'Back'}
                onPress={onBack}
                hitSlop={10}
                style={({ pressed }) => [
                  styles.back,
                  { backgroundColor: colors.cardMuted },
                  pressed && { opacity: 0.7 },
                ]}>
                <Ionicons name="arrow-back" size={19} color={colors.textSecondary} />
              </Pressable>
            ) : (
              <View style={styles.back} />
            )}
            <Text style={[styles.stepLabel, { color: colors.muted, fontSize: type.caption }]}>
              {stepLabel}
            </Text>
            <View style={styles.back} />
          </View>

          <View style={styles.progressRow}>
            {Array.from({ length: totalSteps }, (_, i) => (
              <View
                key={i}
                style={[
                  styles.progressBar,
                  {
                    backgroundColor: i < step ? colors.primary : colors.border,
                    flex: i === step - 1 ? 1.6 : 1,
                  },
                ]}
              />
            ))}
          </View>
        </View>

        <View style={styles.body}>
          <Text style={[styles.title, { color: colors.text, fontSize: type.title }]}>{title}</Text>
          {subtitle ? (
            <Text
              style={[
                styles.subtitle,
                { color: colors.textSecondary, fontSize: type.body, lineHeight: type.lineHeight(type.body) },
              ]}>
              {subtitle}
            </Text>
          ) : null}
          <View style={styles.content}>{children}</View>
        </View>

        <View style={[styles.footer, { borderTopColor: colors.border }]}>{footer}</View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: spacing.base, paddingTop: spacing.sm, gap: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepLabel: { fontFamily: fonts.semibold, letterSpacing: 0.4 },
  progressRow: { flexDirection: 'row', gap: spacing.xs },
  progressBar: { height: 4, borderRadius: 2 },
  body: { flex: 1, paddingHorizontal: spacing.base, paddingTop: spacing.lg, gap: spacing.sm },
  title: { fontFamily: fonts.extrabold, letterSpacing: -0.4 },
  subtitle: { fontFamily: fonts.regular },
  content: { flex: 1, marginTop: spacing.md },
  footer: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
  },
});
