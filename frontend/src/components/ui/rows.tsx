import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { fonts, radius, spacing, useColors, useType } from '@/constants/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

type SettingRowProps = {
  icon?: IconName;
  title: string;
  subtitle?: string;
  value?: string;
  onPress?: () => void;
  right?: ReactNode;
  /** Tints the icon chip with the accent colour instead of the primary colour. */
  accent?: boolean;
  destructive?: boolean;
  accessibilityHint?: string;
};

/** One line in a settings group: icon, title, optional value, chevron. */
export function SettingRow({
  icon,
  title,
  subtitle,
  value,
  onPress,
  right,
  accent,
  destructive,
  accessibilityHint,
}: SettingRowProps) {
  const colors = useColors();
  const type = useType();
  const tint = destructive ? colors.danger : accent ? colors.accent : colors.primary;

  const content = (
    <View style={styles.rowInner}>
      {icon ? (
        <View style={[styles.iconChip, { backgroundColor: destructive ? colors.dangerSoft : accent ? colors.accentSoft : colors.primarySoft }]}>
          <Ionicons name={icon} size={18} color={tint} />
        </View>
      ) : null}
      <View style={styles.rowText}>
        <Text
          style={[
            styles.rowTitle,
            { color: destructive ? colors.danger : colors.text, fontSize: type.body },
          ]}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.rowSubtitle, { color: colors.muted, fontSize: type.caption }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text
          numberOfLines={1}
          style={[styles.rowValue, { color: colors.muted, fontSize: type.bodySmall }]}>
          {value}
        </Text>
      ) : null}
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={colors.muted} /> : null)}
    </View>
  );

  if (!onPress) {
    return <View style={styles.row}>{content}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.65 }]}>
      {content}
    </Pressable>
  );
}

type SwitchRowProps = {
  icon?: IconName;
  title: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  accent?: boolean;
};

/** Settings line with a switch. */
export function SwitchRow({
  icon,
  title,
  subtitle,
  value,
  onValueChange,
  disabled,
  accent,
}: SwitchRowProps) {
  const colors = useColors();
  const type = useType();
  return (
    <View style={styles.row}>
      <View style={styles.rowInner}>
        {icon ? (
          <View
            style={[
              styles.iconChip,
              { backgroundColor: accent ? colors.accentSoft : colors.primarySoft },
            ]}>
            <Ionicons name={icon} size={18} color={accent ? colors.accent : colors.primary} />
          </View>
        ) : null}
        <View style={styles.rowText}>
          <Text style={[styles.rowTitle, { color: colors.text, fontSize: type.body }]}>{title}</Text>
          {subtitle ? (
            <Text style={[styles.rowSubtitle, { color: colors.muted, fontSize: type.caption }]}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <Switch
          accessibilityLabel={title}
          value={value}
          onValueChange={onValueChange}
          disabled={disabled}
          trackColor={{ false: colors.borderStrong, true: colors.primary }}
          thumbColor="#FFFFFF"
        />
      </View>
    </View>
  );
}

type SectionHeaderProps = {
  title: string;
  subtitle?: string;
  action?: ReactNode;
};

export function SectionHeader({ title, subtitle, action }: SectionHeaderProps) {
  const colors = useColors();
  const type = useType();
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionText}>
        <Text style={[styles.sectionTitle, { color: colors.text, fontSize: type.subheading }]}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.sectionSubtitle, { color: colors.muted, fontSize: type.caption }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {action}
    </View>
  );
}

/** Groups rows into a rounded card with hairline separators. */
export function SettingsGroup({ children }: { children: ReactNode }) {
  const colors = useColors();
  const items = Array.isArray(children) ? children.filter(Boolean) : [children];
  return (
    <View style={[styles.group, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {items.map((child, index) => (
        <View key={index}>
          {index > 0 ? (
            <View style={[styles.separator, { backgroundColor: colors.border }]} />
          ) : null}
          {child}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: spacing.base, paddingVertical: spacing.md },
  rowInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconChip: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontFamily: fonts.medium },
  rowSubtitle: { fontFamily: fonts.regular, lineHeight: 17 },
  rowValue: { fontFamily: fonts.medium, maxWidth: 130, textAlign: 'right' },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  sectionText: { flex: 1, gap: 2 },
  sectionTitle: { fontFamily: fonts.semibold },
  sectionSubtitle: { fontFamily: fonts.regular, lineHeight: 17 },
  group: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  separator: { height: StyleSheet.hairlineWidth, marginStart: spacing.base + 36 + spacing.md },
});
