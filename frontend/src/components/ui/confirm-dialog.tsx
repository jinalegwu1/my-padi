import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { fonts, radius, spacing, useColors, useType } from '@/constants/theme';

import { Button } from './button';

type Props = {
  visible: boolean;
  title: string;
  message?: string;
  confirmTitle: string;
  cancelTitle: string;
  /** Red confirm button for deletes and other actions that cannot be undone. */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * In-app confirmation. Use it instead of Alert.alert, which does nothing in the web
 * preview, so the preview behaves like the app.
 */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmTitle,
  cancelTitle,
  destructive,
  onConfirm,
  onCancel,
}: Props) {
  const colors = useColors();
  const type = useType();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable
        style={[styles.backdrop, { backgroundColor: colors.overlay }]}
        accessibilityViewIsModal
        onPress={onCancel}>
        {/* Swallow taps inside the panel so they do not close the dialog. */}
        <Pressable
          style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => {}}>
          <Text style={[styles.title, { color: colors.text, fontSize: type.heading }]}>{title}</Text>
          {message ? (
            <Text style={[styles.message, { color: colors.textSecondary, fontSize: type.body }]}>
              {message}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <View style={styles.action}>
              <Button title={cancelTitle} variant="secondary" onPress={onCancel} />
            </View>
            <View style={styles.action}>
              <Button
                title={confirmTitle}
                variant={destructive ? 'danger' : 'primary'}
                onPress={onConfirm}
              />
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  panel: {
    width: '100%',
    maxWidth: 420,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: { fontFamily: fonts.bold },
  message: { fontFamily: fonts.regular, lineHeight: 22 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  action: { flex: 1 },
});
