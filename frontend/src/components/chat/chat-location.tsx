import Ionicons from '@expo/vector-icons/Ionicons';
import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { fonts, spacing, useColors, useType } from '@/constants/theme';
import { usePreferences } from '@/hooks/use-preferences';
import { useTranslation } from '@/hooks/use-translation';
import { fetchWeatherForCoordinates } from '@/lib/weather';

async function requestPosition() {
  if (Platform.OS === 'web') {
    // Asking for the position triggers the browser's own permission dialog.
    return new Promise<GeolocationCoordinates | null>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        position => resolve(position.coords),
        error => error.code === 1 ? resolve(null) : reject(error),
        { maximumAge: 300000, timeout: 15000 },
      );
    });
  }
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) return null;
  return (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low })).coords;
}

export function ChatLocation() {
  const { preferences, update } = usePreferences();
  const { t } = useTranslation();
  const colors = useColors();
  const type = useType();
  const [expanded, setExpanded] = useState(false);
  const [notice, setNotice] = useState('');
  const requested = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function allow() {
    if (requested.current) return;
    requested.current = true;
    setNotice(t('location.loading'));
    update({ chatLocationPromptHandled: true });
    try {
      const coords = await requestPosition();
      if (!mounted.current) return;
      if (!coords) {
        setNotice('');
        return;
      }
      const report = await fetchWeatherForCoordinates(coords, '');
      const hour = Number(report.localTime.slice(11, 13));
      const greeting = hour < 5 || hour >= 17 ? 'location.evening' : hour < 12 ? 'location.morning' : 'location.afternoon';
      if (mounted.current) setNotice(t(greeting, { temp: Math.round(report.temperature) }));
    } catch {
      if (mounted.current) setNotice(t('location.error'));
    }
  }

  if (preferences.chatLocationPromptHandled && !notice) return null;
  const text = { color: colors.text, fontFamily: fonts.medium, fontSize: type.bodySmall };
  return (
    <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {notice ? <Text accessibilityLiveRegion="polite" style={[text, styles.notice]}>{notice}</Text> : <>
        <Pressable accessibilityRole="button" accessibilityLabel={t('location.toggle')}
          aria-expanded={expanded} accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)}
          style={styles.toggle}>
          <Ionicons name="location-outline" color={colors.textSecondary} size={18} />
          <Text style={[text, styles.label]}>{t('location.toggle')}</Text>
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} color={colors.muted} size={16} />
        </Pressable>
        {expanded && <View style={styles.details}>
          <Text style={[text, { color: colors.textSecondary, fontFamily: fonts.regular }]}>{t('location.help')}</Text>
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" onPress={allow} style={[styles.action, { backgroundColor: colors.text }]}>
              <Text style={[text, { color: colors.card }]}>{t('location.allow')}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => update({ chatLocationPromptHandled: true })} style={styles.action}>
              <Text style={text}>{t('location.later')}</Text>
            </Pressable>
          </View>
        </View>}
      </>}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.base },
  toggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  label: { flex: 1 },
  details: { paddingBottom: spacing.md, gap: spacing.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  action: { minHeight: 44, justifyContent: 'center', borderRadius: 12, paddingHorizontal: spacing.md },
  notice: { paddingVertical: spacing.sm },
});
