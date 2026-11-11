import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { fonts, spacing, useColors, useType } from '@/constants/theme';

import { Button } from './button';

type Props = {
  icon?: ComponentProps<typeof Ionicons>['name'];
  title: string;
  message?: string;
  actionTitle?: string;
  onAction?: () => void;
};

/** What a list or screen shows when there is nothing yet, or when loading failed. */
export function EmptyState({
  icon = 'file-tray-outline',
  title,
  message,
  actionTitle,
  onAction,
}: Props) {
  const colors = useColors();
  const type = useType();
  return (
    <View style={styles.wrap}>
      <View style={[styles.iconWrap, { backgroundColor: colors.primarySoft }]}>
        <Ionicons name={icon} size={30} color={colors.primary} />
      </View>
      <Text style={[styles.title, { color: colors.text, fontSize: type.subheading }]}>{title}</Text>
      {message ? (
        <Text style={[styles.message, { color: colors.muted, fontSize: type.bodySmall }]}>
          {message}
        </Text>
      ) : null}
      {actionTitle && onAction ? (
        <View style={styles.action}>
          <Button title={actionTitle} onPress={onAction} variant="soft" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  title: { fontFamily: fonts.semibold, textAlign: 'center' },
  message: { fontFamily: fonts.regular, textAlign: 'center', lineHeight: 21 },
  action: { alignSelf: 'stretch', marginTop: spacing.sm },
});
