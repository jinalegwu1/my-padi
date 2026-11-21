import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from 'expo-audio';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Sheet } from '@/components/ui/sheet';
import { SectionHeader, SettingRow, SettingsGroup, SwitchRow } from '@/components/ui/rows';
import { TextField } from '@/components/ui/text-field';
import { fonts, radius, spacing, useColors, useType } from '@/constants/theme';
import { usePreferences } from '@/hooks/use-preferences';
import { answerIncomingCall, observeIncomingCalls, openDeviceAction, type DeviceActionKind } from '@/lib/device-actions';

type PendingAction =
  | { kind: 'call'; phone: string }
  | { kind: 'sms'; phone: string; body: string }
  | { kind: 'email'; recipient: string; subject: string; body: string }
  | { kind: 'whatsapp'; phone: string; body: string }
  | { kind: 'facebook'; recipient: string; body: string }
  | { kind: 'music'; query: string }
  | { kind: 'video'; query: string };

export default function DeviceActionsScreen() {
  const colors = useColors();
  const type = useType();
  const router = useRouter();
  const { preferences, update } = usePreferences();
  const [permissionNotice, setPermissionNotice] = useState<string | null>(null);
  const [permissionStatus, setPermissionStatus] = useState('Checking…');
  const [pendingKind, setPendingKind] = useState<DeviceActionKind | null>(null);
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [recipient, setRecipient] = useState('');
  const [subject, setSubject] = useState('');
  const [query, setQuery] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [incomingCall, setIncomingCall] = useState<{ incomingNumber: string } | null>(null);
  const [answerConfirmOpen, setAnswerConfirmOpen] = useState(false);

  useEffect(() => {
    void refreshStatus();
    const subscription = observeIncomingCalls((event) => {
      if (event.state === 'ringing') setIncomingCall({ incomingNumber: event.incomingNumber });
      if (event.state === 'idle' || event.state === 'offhook') setIncomingCall(null);
    });
    return () => subscription?.remove();
  }, []);

  async function refreshStatus() {
    const [microphone, notification, location] = await Promise.all([
      getRecordingPermissionsAsync(),
      Notifications.getPermissionsAsync(),
      Location.getForegroundPermissionsAsync(),
    ]);
    setPermissionStatus([
      `Microphone ${microphone.granted ? 'allowed' : 'off'}`,
      `Notifications ${notification.granted ? 'allowed' : 'off'}`,
      `Location ${location.granted ? 'allowed' : 'off'}`,
    ].join(' · '));
  }

  async function requestMicrophone() {
    const result = await requestRecordingPermissionsAsync();
    setPermissionNotice(result.granted ? 'Microphone permission granted.' : 'Microphone permission was not granted.');
    await refreshStatus();
  }

  async function requestNotifications() {
    const result = await Notifications.requestPermissionsAsync();
    setPermissionNotice(result.granted ? 'Notification permission granted.' : 'Notification permission was not granted.');
    await refreshStatus();
  }

  async function requestLocation() {
    const result = await Location.requestForegroundPermissionsAsync();
    setPermissionNotice(result.granted ? 'Location permission granted.' : 'Location permission was not granted.');
    await refreshStatus();
  }

  function prepareAction(kind: DeviceActionKind) {
    setPendingKind(kind);
    setPhone('');
    setMessage('');
    setRecipient('');
    setSubject('');
    setQuery('');
  }

  function createPendingAction(): PendingAction | null {
    if (pendingKind === 'call') return phone.trim() ? { kind: 'call', phone } : null;
    if (pendingKind === 'sms') return phone.trim() ? { kind: 'sms', phone, body: message } : null;
    if (pendingKind === 'email') return recipient.trim() ? { kind: 'email', recipient, subject, body: message } : null;
    if (pendingKind === 'whatsapp') return phone.trim() ? { kind: 'whatsapp', phone, body: message } : null;
    if (pendingKind === 'facebook') return recipient.trim() ? { kind: 'facebook', recipient, body: message } : null;
    if (pendingKind === 'music' && query.trim()) return { kind: 'music', query };
    if (pendingKind === 'video' && query.trim()) return { kind: 'video', query };
    return null;
  }

  function reviewAction() {
    const action = createPendingAction();
    if (!action) {
      setPermissionNotice('Complete the required information first.');
      return;
    }
    setPendingAction(action);
  }

  async function confirmAction() {
    if (!pendingAction) return;
    setBusy(true);
    try {
      await openDeviceAction(pendingAction);
      setPendingKind(null);
      setPendingAction(null);
      setPermissionNotice('PADI handed the action to the selected device app.');
    } catch (error) {
      setPermissionNotice(error instanceof Error ? error.message : 'The device action could not be opened.');
    } finally {
      setBusy(false);
    }
  }

  const actionsEnabled = preferences.deviceActionsEnabled;
  const categoryDisabled = (enabled: boolean) => !actionsEnabled || !enabled;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Button title="Back" variant="secondary" onPress={() => router.back()} />
          <Text style={[styles.title, { color: colors.text, fontSize: type.title }]}>Device actions</Text>
          <Text style={[styles.subtitle, { color: colors.muted, fontSize: type.caption }]}>
            PADI only hands work to device apps after you confirm it. No action is silent or automatic.
          </Text>
        </View>

        {permissionNotice ? (
          <Text accessibilityRole="alert" style={[styles.notice, { color: colors.primary, fontSize: type.bodySmall }]}>
            {permissionNotice}
          </Text>
        ) : null}

        <SectionHeader title="Master control" subtitle="Turn off here to disable every PADI device action." />
        <SettingsGroup>
          <SwitchRow
            icon="shield-checkmark-outline"
            title="Allow PADI device actions"
            subtitle="Category switches remain available for fine control."
            value={actionsEnabled}
            onValueChange={(deviceActionsEnabled) => update({ deviceActionsEnabled })}
            accent
          />
        </SettingsGroup>

        <SectionHeader title="App permissions" subtitle={permissionStatus} />
        <SettingsGroup>
          <SettingRow icon="mic-outline" title="Microphone" subtitle="Voice conversations" onPress={() => void requestMicrophone()} />
          <SettingRow icon="notifications-outline" title="Notifications" subtitle="Check-ins and alerts" onPress={() => void requestNotifications()} />
          <SettingRow icon="location-outline" title="Location" subtitle="Weather and local context" onPress={() => void requestLocation()} />
        </SettingsGroup>

        <SectionHeader title="Communication" subtitle="Calls and messages open the device app for final approval." />
        <SettingsGroup>
          <SwitchRow
            icon="call-outline"
            title="Phone calls"
            subtitle="Open the dialer with a number"
            value={preferences.devicePhoneCallsEnabled}
            disabled={!actionsEnabled}
            onValueChange={(devicePhoneCallsEnabled) => update({ devicePhoneCallsEnabled })}
          />
          <SettingRow
            icon="chatbubble-outline"
            title="Compose a text"
            subtitle="Opens your messages app"
            disabled={categoryDisabled(preferences.deviceMessagesEnabled)}
            onPress={() => prepareAction('sms')}
          />
          <SwitchRow
            icon="mail-outline"
            title="Text messages"
            subtitle="Allow PADI to prepare SMS drafts"
            value={preferences.deviceMessagesEnabled}
            disabled={!actionsEnabled}
            onValueChange={(deviceMessagesEnabled) => update({ deviceMessagesEnabled })}
          />
          <SettingRow
            icon="mail-unread-outline"
            title="Compose email"
            subtitle="Opens your email app"
            disabled={categoryDisabled(preferences.deviceEmailEnabled)}
            onPress={() => prepareAction('email')}
          />
          <SettingRow
            icon="logo-whatsapp"
            title="Open WhatsApp"
            subtitle="Prepare a WhatsApp chat or message"
            disabled={!actionsEnabled}
            onPress={() => prepareAction('whatsapp')}
          />
          <SettingRow
            icon="logo-facebook"
            title="Open Facebook Messenger"
            subtitle="Prepare a Messenger reply"
            disabled={!actionsEnabled}
            onPress={() => prepareAction('facebook')}
          />
          <SwitchRow
            icon="at-outline"
            title="Email"
            subtitle="Allow PADI to prepare email drafts"
            value={preferences.deviceEmailEnabled}
            disabled={!actionsEnabled}
            onValueChange={(deviceEmailEnabled) => update({ deviceEmailEnabled })}
          />
        </SettingsGroup>

        <SectionHeader title="Media" subtitle="PADI searches and opens media apps; it cannot start hidden playback." />
        <SettingsGroup>
          <SwitchRow
            icon="musical-notes-outline"
            title="Music"
            value={preferences.deviceMusicEnabled}
            disabled={!actionsEnabled}
            onValueChange={(deviceMusicEnabled) => update({ deviceMusicEnabled })}
          />
          <SettingRow
            icon="headset-outline"
            title="Search music"
            subtitle="Open YouTube Music search"
            disabled={categoryDisabled(preferences.deviceMusicEnabled)}
            onPress={() => prepareAction('music')}
          />
          <SwitchRow
            icon="videocam-outline"
            title="Videos"
            value={preferences.deviceVideosEnabled}
            disabled={!actionsEnabled}
            onValueChange={(deviceVideosEnabled) => update({ deviceVideosEnabled })}
          />
          <SettingRow
            icon="play-circle-outline"
            title="Search videos"
            subtitle="Open YouTube search"
            disabled={categoryDisabled(preferences.deviceVideosEnabled)}
            onPress={() => prepareAction('video')}
          />
        </SettingsGroup>

        {preferences.devicePhoneCallsEnabled && actionsEnabled ? (
          <SettingRow
            icon="call-outline"
            title="Prepare a phone call"
            subtitle="The dialer stays in control"
            onPress={() => prepareAction('call')}
          />
        ) : null}

        {incomingCall ? (
          <View style={[styles.incomingCard, { backgroundColor: colors.primarySoft, borderColor: colors.primary }]}>
            <Text style={[styles.incomingTitle, { color: colors.text, fontSize: type.body }]}>Incoming call</Text>
            <Text style={[styles.incomingNumber, { color: colors.textSecondary, fontSize: type.bodySmall }]}>
              {incomingCall.incomingNumber || 'Unknown caller'}
            </Text>
            <Button title="Review and answer" onPress={() => setAnswerConfirmOpen(true)} icon="call-outline" />
          </View>
        ) : null}
      </ScrollView>

      <Sheet
        visible={!!pendingKind && !pendingAction}
        title={
          pendingKind === 'call' ? 'Prepare a call'
            : pendingKind === 'sms' ? 'Compose a text'
            : pendingKind === 'email' ? 'Compose an email'
            : pendingKind === 'whatsapp' ? 'Open WhatsApp'
            : pendingKind === 'facebook' ? 'Open Facebook Messenger'
            : pendingKind === 'music' ? 'Search music'
            : 'Search videos'
        }
        subtitle="Enter the details, then review before opening another app."
        onClose={() => setPendingKind(null)}
        footer={<Button title="Review" onPress={reviewAction} />}
      >
        {pendingKind ? (
          pendingKind === 'call' || pendingKind === 'sms' ? (
            <View style={styles.sheetFields}>
              <TextField label="Phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
              {pendingKind === 'sms' ? (
                <TextField label="Message" value={message} onChangeText={setMessage} multiline />
              ) : null}
            </View>
          ) : pendingKind === 'email' ? (
            <View style={styles.sheetFields}>
              <TextField label="Recipient" value={recipient} onChangeText={setRecipient} keyboardType="email-address" autoCapitalize="none" />
              <TextField label="Subject" value={subject} onChangeText={setSubject} />
              <TextField label="Message" value={message} onChangeText={setMessage} multiline />
            </View>
          ) : pendingKind === 'whatsapp' ? (
            <View style={styles.sheetFields}>
              <TextField label="WhatsApp phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
              <TextField label="Message" value={message} onChangeText={setMessage} multiline />
            </View>
          ) : pendingKind === 'facebook' ? (
            <View style={styles.sheetFields}>
              <TextField label="Facebook username or profile link" value={recipient} onChangeText={setRecipient} autoCapitalize="none" autoCorrect={false} />
              <TextField label="Message" value={message} onChangeText={setMessage} multiline />
            </View>
          ) : (
            <View style={styles.sheetFields}>
              <TextField label={pendingKind === 'music' ? 'Song or artist' : 'Video title or topic'} value={query} onChangeText={setQuery} />
            </View>
          )
        ) : null}
      </Sheet>

      <ConfirmDialog
        visible={!!pendingAction}
        title="Open device app?"
        message="PADI will only open the system app. You remain in control of sending or playing."
        confirmTitle="Open app"
        cancelTitle="Cancel"
        busy={busy}
        onCancel={() => setPendingAction(null)}
        onConfirm={() => void confirmAction()}
      />

      <ConfirmDialog
        visible={answerConfirmOpen}
        title="Answer incoming call?"
        message="PADI will answer this call only because you confirmed it."
        confirmTitle="Answer"
        cancelTitle="Decline"
        busy={busy}
        onCancel={() => setAnswerConfirmOpen(false)}
        onConfirm={() => {
          setBusy(true);
          void answerIncomingCall()
            .then(() => {
              setPermissionNotice('PADI answered the confirmed incoming call.');
              setAnswerConfirmOpen(false);
            })
            .catch((error) => {
              setPermissionNotice(error instanceof Error ? error.message : 'The incoming call could not be answered.');
              setAnswerConfirmOpen(false);
            })
            .finally(() => setBusy(false));
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: spacing.base, gap: spacing.sm, paddingBottom: spacing.xl },
  header: { gap: spacing.sm, marginBottom: spacing.sm },
  title: { fontFamily: fonts.bold },
  subtitle: { fontFamily: fonts.regular, lineHeight: 18 },
  notice: { fontFamily: fonts.medium, lineHeight: 18 },
  sheetFields: { gap: spacing.md },
  incomingCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.base,
    gap: spacing.sm,
  },
  incomingTitle: { fontFamily: fonts.semibold },
  incomingNumber: { fontFamily: fonts.regular },
});
