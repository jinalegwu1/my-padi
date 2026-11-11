import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CountryPicker } from '@/components/onboarding/country-picker';
import { LanguagePicker } from '@/components/onboarding/language-picker';
import { VoicePicker } from '@/components/settings/voice-picker';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { SectionHeader, SettingRow, SettingsGroup, SwitchRow } from '@/components/ui/rows';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Sheet } from '@/components/ui/sheet';
import { fonts, radius, spacing, useColors, useType } from '@/constants/theme';
import { findCountry } from '@/data/countries';
import { findVoice, languageLabel } from '@/data/languages';
import { useMemory } from '@/hooks/use-memory';
import { usePreferences } from '@/hooks/use-preferences';
import { useTranslation } from '@/hooks/use-translation';
import { formatTimeLabel, timeSlots } from '@/lib/date';
import type { AppearanceMode } from '@/types';

/**
 * Settings: language, voice, appearance, memory, notifications, daily check-in
 * and accessibility. Every control is a frontend preference stored on the phone.
 */
export default function SettingsScreen() {
  const router = useRouter();
  const colors = useColors();
  const type = useType();
  const { t } = useTranslation();
  const { preferences, update, reset } = usePreferences();
  const { counts } = useMemory();

  const [languageOpen, setLanguageOpen] = useState(false);
  const [countryOpen, setCountryOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  const country = findCountry(preferences.countryCode);
  const voice = findVoice(preferences.voiceId);

  const appearanceOptions: { value: AppearanceMode; label: string }[] = [
    { value: 'system', label: t('settings.appearance.system') },
    { value: 'light', label: t('settings.appearance.light') },
    { value: 'dark', label: t('settings.appearance.dark') },
  ];

  return (
    <SafeAreaView
      style={[styles.root, { backgroundColor: colors.background }]}
      edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text, fontSize: type.title }]}>
            {t('settings.title')}
          </Text>
          <Text style={[styles.subtitle, { color: colors.muted, fontSize: type.caption }]}>
            {preferences.displayName
              ? `PADI calls you ${preferences.displayName}.`
              : 'Everything here is stored on this phone.'}
          </Text>
        </View>

        {/* Language and region */}
        <SectionHeader title={t('settings.language')} subtitle={t('settings.language.hint')} />
        <SettingsGroup>
          <SettingRow
            icon="language-outline"
            title={t('settings.language')}
            value={languageLabel(preferences.languageCode)}
            onPress={() => setLanguageOpen(true)}
          />
          <SettingRow
            icon="globe-outline"
            title="Country"
            value={country ? `${country.flag} ${country.name}` : 'Not set'}
            onPress={() => setCountryOpen(true)}
          />
        </SettingsGroup>

        {/* Voice */}
        <SectionHeader title={t('settings.voice')} subtitle={t('settings.voice.hint')} />
        <SettingsGroup>
          <SettingRow
            icon="mic-outline"
            title={t('settings.voice')}
            subtitle={`${voice.name} · ${voice.accent}`}
            value={voice.gender === 'female' ? 'Female' : 'Male'}
            onPress={() => setVoiceOpen(true)}
          />
          <SwitchRow
            icon="text-outline"
            title="Show words during voice"
            subtitle="Display what PADI says as text while speaking."
            value={preferences.showVoiceTranscript}
            onValueChange={(value) => update({ showVoiceTranscript: value })}
          />
        </SettingsGroup>

        {/* Appearance */}
        <SectionHeader title={t('settings.appearance')} />
        <View
          style={[
            styles.appearanceCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}>
          <SegmentedControl
            options={appearanceOptions}
            value={preferences.appearance}
            onChange={(value) => update({ appearance: value })}
            accessibilityLabel={t('settings.appearance')}
          />
          <View style={styles.swatches}>
            {(['light', 'dark'] as const).map((scheme) => (
              <View key={scheme} style={styles.swatchItem}>
                <View
                  style={[
                    styles.swatch,
                    {
                      backgroundColor: scheme === 'light' ? '#F8FAFC' : '#0A0F1E',
                      borderColor: colors.border,
                    },
                  ]}>
                  <View
                    style={[
                      styles.swatchBubble,
                      { backgroundColor: scheme === 'light' ? '#536DFE' : '#7C8CFF' },
                    ]}
                  />
                  <View
                    style={[
                      styles.swatchBubble,
                      styles.swatchBubbleAlt,
                      { backgroundColor: scheme === 'light' ? '#E4E8F2' : '#25304A' },
                    ]}
                  />
                </View>
                <Text style={[styles.swatchLabel, { color: colors.muted, fontSize: type.micro }]}>
                  {scheme === 'light' ? t('settings.appearance.light') : t('settings.appearance.dark')}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Memory */}
        <SectionHeader title={t('settings.memory')} subtitle={t('settings.memory.hint')} />
        <SettingsGroup>
          <SwitchRow
            icon="sparkles-outline"
            title="Let PADI remember with permission"
            subtitle="PADI only keeps something when you say yes."
            value={preferences.memoryEnabled}
            onValueChange={(value) => update({ memoryEnabled: value })}
            accent
          />
          <SettingRow
            icon="albums-outline"
            title="Review remembered information"
            subtitle={`${counts.active} in use · ${counts.paused} paused`}
            onPress={() => router.push('/memory')}
          />
        </SettingsGroup>

        {/* Notifications and check-in */}
        <SectionHeader title={t('settings.notifications')} subtitle={t('settings.notifications.hint')} />
        <SettingsGroup>
          <SwitchRow
            icon="notifications-outline"
            title={t('settings.notifications')}
            subtitle="Reminder and message alerts. Not switched on yet."
            value={preferences.notificationsEnabled}
            onValueChange={(value) => update({ notificationsEnabled: value })}
          />
          <SwitchRow
            icon="sunny-outline"
            title={t('settings.checkIn')}
            subtitle={t('settings.checkIn.hint')}
            value={preferences.dailyCheckIn}
            onValueChange={(value) => update({ dailyCheckIn: value })}
          />
          <SettingRow
            icon="time-outline"
            title={t('settings.checkIn.time')}
            value={formatTimeLabel(preferences.checkInTime)}
            onPress={() => setCheckInOpen(true)}
          />
        </SettingsGroup>

        {/* Accessibility */}
        <SectionHeader title={t('settings.accessibility')} />
        <SettingsGroup>
          <View style={styles.textSizeRow}>
            <View style={styles.textSizeHeader}>
              <View style={[styles.iconChip, { backgroundColor: colors.primarySoft }]}>
                <Ionicons name="resize-outline" size={18} color={colors.primary} />
              </View>
              <Text style={[styles.textSizeLabel, { color: colors.text, fontSize: type.body }]}>
                {t('settings.accessibility.textSize')}
              </Text>
              <Text style={[styles.textSizeValue, { color: colors.muted, fontSize: type.caption }]}>
                {Math.round(preferences.textScale * 100)}%
              </Text>
            </View>
            <View style={styles.textSizeButtons}>
              {[
                { label: 'A', scale: 0.9, size: 13 },
                { label: 'A', scale: 1, size: 16 },
                { label: 'A', scale: 1.15, size: 19 },
                { label: 'A', scale: 1.3, size: 22 },
              ].map((option) => {
                const selected = Math.abs(preferences.textScale - option.scale) < 0.01;
                return (
                  <Pressable
                    key={option.scale}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Text size ${Math.round(option.scale * 100)} percent`}
                    onPress={() => update({ textScale: option.scale })}
                    style={({ pressed }) => [
                      styles.textSizeButton,
                      {
                        backgroundColor: selected ? colors.primary : colors.cardMuted,
                        borderColor: selected ? colors.primary : colors.border,
                        opacity: pressed ? 0.8 : 1,
                      },
                    ]}>
                    <Text
                      style={{
                        color: selected ? colors.onPrimary : colors.textSecondary,
                        fontSize: option.size,
                        fontFamily: fonts.semibold,
                      }}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <SwitchRow
            icon="eye-outline"
            title={t('settings.accessibility.highContrast')}
            subtitle={t('settings.accessibility.highContrast.hint')}
            value={preferences.highContrast}
            onValueChange={(value) => update({ highContrast: value })}
          />
          <SwitchRow
            icon="pause-circle-outline"
            title={t('settings.accessibility.reduceMotion')}
            subtitle={t('settings.accessibility.reduceMotion.hint')}
            value={preferences.reduceMotion}
            onValueChange={(value) => update({ reduceMotion: value })}
          />
        </SettingsGroup>

        {/* About */}
        <SectionHeader title={t('settings.about')} />
        <View
          style={[styles.aboutCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text
            style={[
              styles.aboutText,
              { color: colors.textSecondary, fontSize: type.bodySmall, lineHeight: type.lineHeight(type.bodySmall) },
            ]}>
            {t('settings.about.body')}
          </Text>
          <Text style={[styles.aboutVersion, { color: colors.muted, fontSize: type.micro }]}>
            My PADI · version 1.0.0
          </Text>
        </View>

        <Button
          title={t('settings.reset')}
          variant="ghost"
          icon="refresh-outline"
          onPress={() => setResetOpen(true)}
        />
        <Text style={[styles.resetHint, { color: colors.muted, fontSize: type.micro }]}>
          {t('settings.reset.hint')}
        </Text>
      </ScrollView>

      {/* Language sheet */}
      <Sheet
        visible={languageOpen}
        title={t('settings.language')}
        subtitle={t('settings.language.hint')}
        onClose={() => setLanguageOpen(false)}
        scroll={false}>
        <View style={styles.pickerSheet}>
          <LanguagePicker
            selectedCode={preferences.languageCode}
            onSelect={(language) => {
              update({ languageCode: language.code });
              setLanguageOpen(false);
            }}
            featuredLabel={t('onboarding.language.featured')}
            othersLabel={t('onboarding.language.others')}
          />
        </View>
      </Sheet>

      {/* Country sheet */}
      <Sheet
        visible={countryOpen}
        title="Country"
        subtitle="Used for time, dates and local context."
        onClose={() => setCountryOpen(false)}
        scroll={false}>
        <View style={styles.pickerSheet}>
          <CountryPicker
            selectedCode={preferences.countryCode}
            onSelect={(selected) => {
              update({ countryCode: selected.code });
              setCountryOpen(false);
            }}
            searchPlaceholder={t('onboarding.country.search')}
          />
        </View>
      </Sheet>

      {/* Voice sheet */}
      <Sheet
        visible={voiceOpen}
        title={t('settings.voice')}
        subtitle={t('settings.voice.hint')}
        onClose={() => setVoiceOpen(false)}>
        <VoicePicker
          labels={{
            female: t('settings.voice.female'),
            male: t('settings.voice.male'),
            preview: t('settings.voice.preview'),
            stop: t('settings.voice.stop'),
            speed: t('settings.voice.speed'),
            simulated: 'Voice previews are simulated in the app — no speech service is connected.',
          }}
        />
      </Sheet>

      {/* Check-in time sheet */}
      <Sheet
        visible={checkInOpen}
        title={t('settings.checkIn.time')}
        onClose={() => setCheckInOpen(false)}>
        <View style={styles.timeGrid}>
          {timeSlots().map((slot) => {
            const selected = slot === preferences.checkInTime;
            return (
              <Pressable
                key={slot}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={formatTimeLabel(slot)}
                onPress={() => {
                  update({ checkInTime: slot });
                  setCheckInOpen(false);
                }}
                style={({ pressed }) => [
                  styles.timeChip,
                  {
                    backgroundColor: selected ? colors.primary : colors.card,
                    borderColor: selected ? colors.primary : colors.border,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}>
                <Text
                  style={[
                    styles.timeChipText,
                    {
                      color: selected ? colors.onPrimary : colors.textSecondary,
                      fontSize: type.caption,
                    },
                  ]}>
                  {formatTimeLabel(slot)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Sheet>

      <ConfirmDialog
        visible={resetOpen}
        title={t('settings.reset')}
        message={t('settings.reset.hint')}
        confirmTitle={t('common.delete')}
        cancelTitle={t('common.cancel')}
        destructive
        onCancel={() => setResetOpen(false)}
        onConfirm={() => {
          reset();
          setResetOpen(false);
          router.replace('/onboarding/country');
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: spacing.base, paddingBottom: spacing.xxxl, gap: spacing.sm },
  header: { gap: 2, marginBottom: spacing.sm },
  title: { fontFamily: fonts.extrabold, letterSpacing: -0.4 },
  subtitle: { fontFamily: fonts.regular },
  appearanceCard: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.base,
    gap: spacing.base,
  },
  swatches: { flexDirection: 'row', gap: spacing.base },
  swatchItem: { flex: 1, gap: spacing.xs, alignItems: 'center' },
  swatch: {
    width: '100%',
    height: 62,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.sm,
    gap: spacing.xs,
    justifyContent: 'center',
  },
  swatchBubble: { height: 12, width: '62%', borderRadius: 6 },
  swatchBubbleAlt: { width: '42%' },
  swatchLabel: { fontFamily: fonts.medium },
  textSizeRow: { paddingHorizontal: spacing.base, paddingVertical: spacing.md, gap: spacing.md },
  textSizeHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconChip: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textSizeLabel: { flex: 1, fontFamily: fonts.medium },
  textSizeValue: { fontFamily: fonts.semibold },
  textSizeButtons: { flexDirection: 'row', gap: spacing.sm },
  textSizeButton: {
    flex: 1,
    height: 44,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aboutCard: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.base,
    gap: spacing.sm,
  },
  aboutText: { fontFamily: fonts.regular },
  aboutVersion: { fontFamily: fonts.medium },
  resetHint: { fontFamily: fonts.regular, textAlign: 'center', marginTop: -spacing.xs },
  pickerSheet: { height: 440 },
  timeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  timeChip: {
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  timeChipText: { fontFamily: fonts.medium },
});
