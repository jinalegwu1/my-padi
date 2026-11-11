import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { spacing, useColors } from '@/constants/theme';

type Props = {
  children: ReactNode;
  scroll?: boolean;
  /** Extra padding at the bottom (e.g. to clear a floating composer). */
  bottomInset?: number;
  contentStyle?: StyleProp<ViewStyle>;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
};

/** Page container: safe-area aware, themed background, optional scrolling. */
export function Screen({
  children,
  scroll = true,
  bottomInset = 0,
  contentStyle,
  edges = ['left', 'right'],
}: Props) {
  const colors = useColors();
  return (
    <SafeAreaView edges={edges} style={[styles.root, { backgroundColor: colors.background }]}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: spacing.base + bottomInset },
            contentStyle,
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      ) : (
        <View style={styles.fill}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fill: { flex: 1 },
  content: { padding: spacing.base, gap: spacing.base },
});
