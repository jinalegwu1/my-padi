import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CountryPicker } from '@/components/onboarding/country-picker';
import { LanguagePicker } from '@/components/onboarding/language-picker';
import { VoicePicker } from '@/components/settings/voice-picker';
import { MemoryConsentDialog } from '@/components/memory/memory-consent-dialog';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { SectionHeader, SettingRow, SettingsGroup, SwitchRow } from '@/components/ui/rows';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Sheet } from '@/components/ui/sheet';
import { fonts, radius, spacing, useColors, useType } from '@/constants/theme';
import { findCountry } from '@/data/countries';
import { findVoice, languageLabel } from '@/data/languages';
import { useMemory } from '@/hooks/use-memory';
import { useCheckInPreferences } from '@/hooks/use-check-in-preferences';
import { usePersonalityPreferences } from '@/hooks/use-personality-preferences';
import { usePreferences } from '@/hooks/use-preferences';
import { useTranslation } from '@/hooks/use-translation';
import { formatTimeLabel, timeSlots } from '@/lib/date';
import type { AppearanceMode, CheckInPreferences, CheckInPreferencesPatch } from '@/types';

type CheckInTimeTarget = 'morning_time' | 'afternoon_time' | 'evening_time' | 'quiet_hours_start' | 'quiet_hours_end';

function checkInTimePatch(target: CheckInTimeTarget, time: string, preferences: CheckInPreferences): CheckInPreferencesPatch {
  switch (target) {
    case 'morning_time': return { morning_time: time };
    case 'afternoon_time': return { afternoon_time: time };
    case 'evening_time': return { evening_time: time };
    case 'quiet_hours_start': return { quiet_hours_start: time, quiet_hours_end: preferences.quiet_hours_end };
    case 'quiet_hours_end': return { quiet_hours_start: preferences.quiet_hours_start, quiet_hours_end: time };
  }
}

/**
 * Settings: device preferences stay local; memory, personality, and check-ins
 * are account-scoped and synchronized with the backend.
 */
export default function SettingsScreen() {
  const router = useRouter();
  const colors = useColors();
  const type = useType();
  const { t } = useTranslation();
  const { preferences, update, reset } = usePreferences();
  const checkIns = useCheckInPreferences(preferences.languageCode);
  const personality = usePersonalityPreferences();
  const { accountID, counts, enabled: memoryEnabled, status: memoryStatus, busy: memoryBusy, error: memoryError, reload, setEnabled } = useMemory();
  const [memoryConsentOpen, setMemoryConsentOpen] = useState(false);
  const [memoryConsentAccount, setMemoryConsentAccount] = useState<string | null>(null);
  useEffect(() => { setMemoryConsentOpen(false); setMemoryConsentAccount(null); }, [accountID]);
  useFocusEffect(useCallback(() => { void reload(); }, [reload]));

  const [languageOpen, setLanguageOpen] = useState(false);
  const [countryOpen, setCountryOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [checkInTimeTarget, setCheckInTimeTarget] = useState<CheckInTimeTarget | null>(null);
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
              : t('settings.storage')}
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

        <SectionHeader
          title="Weather and local context"
          subtitle="PADI uses your location while open for local greetings and weather."
        />
        <SettingsGroup>
          <SettingRow
            icon="partly-sunny-outline"
            title="Check local weather"
            subtitle="View current conditions for your area."
            onPress={() => router.push('/weather')}
          />
        </SettingsGroup>

        <SectionHeader
          title="Device actions"
          subtitle="Let PADI prepare actions that always open with your confirmation."
        />
        <SettingsGroup>
          <SettingRow
            icon="phone-portrait-outline"
            title="Manage device permissions"
            subtitle={preferences.deviceActionsEnabled
              ? 'Device actions are enabled with category controls.'
              : 'Device actions are off.'}
            value={preferences.deviceActionsEnabled ? 'Enabled' : 'Off'}
            onPress={() => router.push('/device-actions')}
            accent
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
          <SwitchRow
            icon="volume-high-outline"
            title="Speak chat replies automatically"
            subtitle="Play written PADI replies aloud. You can still play any reply manually when this is off."
            value={preferences.autoSpeakReplies ?? false}
            onValueChange={(autoSpeakReplies) => update({ autoSpeakReplies })}
          />
          <SwitchRow
            icon="radio-outline"
            title="Listen for Hey PADI or PADI"
            subtitle="Keeps PADI voice listening while the app is active. Android can continue with a foreground notification."
            value={preferences.wakeWordEnabled}
            onValueChange={(wakeWordEnabled) => update({ wakeWordEnabled })}
            accent
          />
        </SettingsGroup>

        <SectionHeader
          title={t('settings.personality')}
          subtitle={t('settings.personality.hint')}
        />
        <SettingsGroup>
          {personality.status === 'ready' && personality.preferences ? (
            <>
              <View style={styles.personalityControl}>
                <Text style={[styles.personalityLabel, { color: colors.text, fontSize: type.body }]}>
                  {t('settings.personality.humour')}
                </Text>
                <SegmentedControl
                  accessibilityLabel={t('settings.personality.humour')}
                  value={personality.preferences.humour}
                  options={[
                    { value: 'off', label: t('settings.personality.humour.off') },
                    { value: 'subtle', label: t('settings.personality.humour.subtle') },
                    { value: 'occasional', label: t('settings.personality.humour.occasional') },
                    { value: 'frequent', label: t('settings.personality.humour.frequent') },
                  ]}
                  disabled={personality.saving}
                  onChange={(humour) => { void personality.update({ humour }); }}
                />
              </View>
              <View style={styles.personalityControl}>
                <Text style={[styles.personalityLabel, { color: colors.text, fontSize: type.body }]}>
                  {t('settings.personality.tone')}
                </Text>
                <SegmentedControl
                  accessibilityLabel={t('settings.personality.tone')}
                  value={personality.preferences.tone}
                  options={[
                    { value: 'adaptive', label: t('settings.personality.tone.adaptive') },
                    { value: 'playful', label: t('settings.personality.tone.playful') },
                    { value: 'gentle', label: t('settings.personality.tone.gentle') },
                    { value: 'direct', label: t('settings.personality.tone.direct') },
                    { value: 'serious', label: t('settings.personality.tone.serious') },
                  ]}
                  disabled={personality.saving}
                  onChange={(tone) => { void personality.update({ tone }); }}
                />
              </View>
              <SwitchRow
                icon="sparkles-outline"
                title={t('settings.personality.learn')}
                subtitle={t('settings.personality.learn.hint')}
                value={personality.preferences.learn_from_feedback}
                disabled={personality.saving}
                onValueChange={(learn_from_feedback) => { void personality.update({ learn_from_feedback }); }}
              />
            </>
          ) : personality.status === 'loading' ? (
            <Text style={[styles.personalityMessage, { color: colors.muted, fontSize: type.caption }]}>
              {t('common.loading')}
            </Text>
          ) : (
            <Text
              accessibilityRole={personality.status === 'error' ? 'alert' : undefined}
              style={[styles.personalityMessage, { color: personality.status === 'error' ? colors.danger : colors.muted, fontSize: type.caption }]}>
              {personality.error ?? 'Sign in to manage your conversation style.'}
            </Text>
          )}
          {personality.error && personality.status === 'ready' ? (
            <Text accessibilityRole="alert" style={[styles.personalityMessage, { color: colors.danger, fontSize: type.caption }]}>
              {personality.error}
            </Text>
          ) : null}
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
            subtitle={memoryStatus === 'unauthorized' ? 'Sign in to manage your account memory.' : 'Only explicitly approved facts are stored in your account.'}
            value={memoryEnabled}
            disabled={memoryBusy || memoryStatus !== 'ready'}
            onValueChange={(value) => { if (value) { setMemoryConsentAccount(accountID); setMemoryConsentOpen(true); } else void setEnabled(false); }}
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
        {memoryError ? <Text accessibilityRole="alert" style={{ color: colors.danger }}>{memoryError}</Text> : null}
        <SectionHeader title={t('settings.notifications')} subtitle={t('settings.notifications.hint')} />
        <SettingsGroup>
          {checkIns.status === 'ready' && checkIns.preferences ? (
            <>
              {([
                ['morning', 'morning_enabled', 'morning_time'],
                ['afternoon', 'afternoon_enabled', 'afternoon_time'],
                ['evening', 'evening_enabled', 'evening_time'],
              ] as const).map(([slot, enabledKey, timeKey]) => (
                <View key={slot}>
                  <SwitchRow
                    icon={slot === 'morning' ? 'sunny-outline' : slot === 'afternoon' ? 'partly-sunny-outline' : 'moon-outline'}
                    title={t(`settings.checkIn.${slot}`)}
                    value={checkIns.preferences![enabledKey]}
                    disabled={checkIns.saving}
                    onValueChange={(value) => { void checkIns.update({ [enabledKey]: value }); }}
                  />
                  <SettingRow
                    icon="time-outline"
                    title={t(`settings.checkIn.${slot}`)}
                    subtitle={t('settings.checkIn.time')}
                    value={formatTimeLabel(checkIns.preferences![timeKey])}
                    disabled={checkIns.saving}
                    onPress={() => setCheckInTimeTarget(timeKey)}
                  />
                </View>
              ))}
              <SwitchRow
                icon="moon-outline"
                title={t('settings.checkIn.quietHours')}
                subtitle={t('settings.checkIn.quietHours.hint')}
                value={checkIns.preferences.quiet_hours_enabled}
                disabled={checkIns.saving}
                onValueChange={(quiet_hours_enabled) => {
                  void checkIns.update({
                    quiet_hours_enabled,
                    quiet_hours_start: checkIns.preferences!.quiet_hours_start,
                    quiet_hours_end: checkIns.preferences!.quiet_hours_end,
                  });
                }}
              />
              {checkIns.preferences.quiet_hours_enabled ? (
                <>
                  <SettingRow
                    icon="time-outline"
                    title={t('settings.checkIn.quietHours.start')}
                    value={formatTimeLabel(checkIns.preferences.quiet_hours_start)}
                    disabled={checkIns.saving}
                    onPress={() => setCheckInTimeTarget('quiet_hours_start')}
                  />
                  <SettingRow
                    icon="time-outline"
                    title={t('settings.checkIn.quietHours.end')}
                    value={formatTimeLabel(checkIns.preferences.quiet_hours_end)}
                    disabled={checkIns.saving}
                    onPress={() => setCheckInTimeTarget('quiet_hours_end')}
                  />
                </>
              ) : null}
              <Text style={[styles.personalityMessage, { color: colors.muted, fontSize: type.caption }]}>
                {t('settings.checkIn.localTime')}: {checkIns.preferences.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time'}
              </Text>
            </>
          ) : checkIns.status === 'loading' ? (
            <Text style={[styles.personalityMessage, { color: colors.muted, fontSize: type.caption }]}>
              {t('common.loading')}
            </Text>
          ) : (
            <Text
              accessibilityRole="alert"
              style={[styles.personalityMessage, { color: checkIns.status === 'error' ? colors.danger : colors.muted, fontSize: type.caption }]}>
              {checkIns.error ?? t('settings.checkIn.signIn')}
            </Text>
          )}
          {checkIns.error && checkIns.status === 'ready' ? (
            <Text accessibilityRole="alert" style={[styles.personalityMessage, { color: colors.danger, fontSize: type.caption }]}>
              {checkIns.error}
            </Text>
          ) : null}
          {checkIns.quietHoursWarning ? (
            <Text accessibilityRole="alert" style={[styles.personalityMessage, { color: colors.muted, fontSize: type.caption }]}>
              {checkIns.quietHoursWarning}
            </Text>
          ) : null}
          {checkIns.deliveryWarning ? (
            <Text accessibilityRole="alert" style={[styles.personalityMessage, { color: colors.warning, fontSize: type.caption }]}>
              {checkIns.deliveryWarning}
            </Text>
          ) : null}
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
          }}
        />
      </Sheet>

      {/* Check-in time sheet */}
      <Sheet
        visible={checkInTimeTarget !== null}
        title={checkInTimeTarget?.startsWith('quiet_hours') ? t('settings.checkIn.quietHours') : t('settings.checkIn.time')}
        onClose={() => setCheckInTimeTarget(null)}>
        <View style={styles.timeGrid}>
          {timeSlots().map((slot) => {
            const selected = checkIns.preferences && checkInTimeTarget
              ? slot === checkIns.preferences[checkInTimeTarget]
              : false;
            return (
              <Pressable
                key={slot}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={formatTimeLabel(slot)}
                onPress={() => {
                  if (checkInTimeTarget && checkIns.preferences) {
                    void checkIns.update(checkInTimePatch(checkInTimeTarget, slot, checkIns.preferences));
                  }
                  setCheckInTimeTarget(null);
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

      <MemoryConsentDialog visible={memoryConsentOpen} accountID={memoryConsentAccount} onClose={() => setMemoryConsentOpen(false)} />
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
          router.replace('/onboarding/welcome');
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
  personalityControl: { paddingHorizontal: spacing.base, paddingVertical: spacing.sm, gap: spacing.sm },
  personalityLabel: { fontFamily: fonts.medium },
  personalityMessage: { padding: spacing.base, fontFamily: fonts.regular },
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
