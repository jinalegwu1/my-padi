import { requireOptionalNativeModule } from 'expo';
import { Linking, PermissionsAndroid, Platform } from 'react-native';

export type DeviceActionKind = 'call' | 'sms' | 'email' | 'whatsapp' | 'facebook' | 'music' | 'video';

export type DeviceAction =
  | { kind: 'call'; phone: string }
  | { kind: 'sms'; phone: string; body: string }
  | { kind: 'email'; recipient: string; subject: string; body: string }
  | { kind: 'whatsapp'; phone: string; body: string }
  | { kind: 'facebook'; recipient: string; body: string }
  | { kind: 'music'; query: string }
  | { kind: 'video'; query: string };

type PadiDeviceModule = {
  dial(phone: string): Promise<void>;
  answerIncomingCall(): Promise<void>;
  playMedia(query: string): Promise<void>;
  addListener(name: string, callback: (event: { state: 'ringing' | 'offhook' | 'idle'; incomingNumber: string }) => void): { remove(): void };
};

const padiDevice = requireOptionalNativeModule<PadiDeviceModule>('PadiVoice');

function cleanPhone(value: string): string {
  const trimmed = value.trim();
  if (!/^\+?[0-9][0-9 ()-.]{3,}$/.test(trimmed)) {
    throw new Error('Enter a valid phone number, including country code when possible.');
  }
  return trimmed.replace(/[^+\d]/g, '');
}

export function deviceActionUrl(action: DeviceAction): string {
  if (action.kind === 'call') {
    return `tel:${cleanPhone(action.phone)}`;
  }
  if (action.kind === 'sms') {
    const phone = cleanPhone(action.phone);
    const separator = Platform.OS === 'ios' ? '&' : '?';
    return `sms:${phone}${action.body.trim() ? `${separator}body=${encodeURIComponent(action.body.trim())}` : ''}`;
  }
  if (action.kind === 'email') {
    const recipient = action.recipient.trim();
    if (!recipient || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient)) {
      throw new Error('Enter a valid email address.');
    }
    const params: string[] = [];
    if (action.subject.trim()) params.push(`subject=${encodeURIComponent(action.subject.trim())}`);
    if (action.body.trim()) params.push(`body=${encodeURIComponent(action.body.trim())}`);
    return `mailto:${recipient}${params.length ? `?${params.join('&')}` : ''}`;
  }
  if (action.kind === 'whatsapp') {
    const phone = cleanPhone(action.phone);
    const text = action.body.trim();
    return `https://wa.me/${phone.replace(/^\+/, '')}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
  }
  if (action.kind === 'facebook') {
    const recipient = action.recipient.trim();
    if (!recipient) throw new Error('Enter a Facebook username or profile link.');
    const profile = recipient.includes('facebook.com') || recipient.includes('messenger.com')
      ? recipient
      : `https://www.messenger.com/t/${encodeURIComponent(recipient.replace(/^@/, ''))}`;
    return action.body.trim()
      ? `${profile}${profile.includes('?') ? '&' : '?'}text=${encodeURIComponent(action.body.trim())}`
      : profile;
  }
  if (!action.query.trim()) throw new Error('Enter something to search for.');
  const query = encodeURIComponent(action.query.trim());
  if (action.kind === 'music') {
    if (Platform.OS === 'ios') return `https://music.apple.com/us/search?term=${query}`;
    return `https://music.youtube.com/search?q=${query}`;
  }
  return `https://www.youtube.com/results?search_query=${query}`;
}

export async function openDeviceAction(action: DeviceAction): Promise<void> {
  if (action.kind === 'call' && Platform.OS === 'android') {
    if (!padiDevice) throw new Error('Direct calling needs the PADI development build.');
    const callPermission = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CALL_PHONE, {
      title: 'Allow PADI to place calls?',
      message: 'PADI will open the dialer and place the call only after you confirm.',
      buttonPositive: 'Allow',
      buttonNegative: 'Not now',
    });
    if (callPermission !== PermissionsAndroid.RESULTS.GRANTED) {
      throw new Error('Phone call permission was not granted.');
    }
    await padiDevice.dial(cleanPhone(action.phone));
    return;
  }
  if (action.kind === 'music' && Platform.OS === 'android' && padiDevice) {
    await padiDevice.playMedia(action.query);
    return;
  }
  const url = deviceActionUrl(action);
  if (!(await Linking.canOpenURL(url))) {
    throw new Error(action.kind === 'call' || action.kind === 'sms'
      ? 'No phone app is available to complete this action.'
      : action.kind === 'email'
        ? 'No email app is available to complete this action.'
        : 'No browser or media app is available to complete this action.');
  }
  await Linking.openURL(url);
}

export async function answerIncomingCall(): Promise<void> {
  if (Platform.OS !== 'android' || !padiDevice) {
    throw new Error('iOS cellular calls cannot be answered by third-party apps. Accept the incoming call on the iPhone.');
  }
  const permission = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ANSWER_PHONE_CALLS, {
    title: 'Allow PADI to answer confirmed calls?',
    message: 'PADI will answer only after you approve each incoming call.',
    buttonPositive: 'Allow',
    buttonNegative: 'Not now',
  });
  if (permission !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new Error('Incoming-call answering permission was not granted.');
  }
  await padiDevice.answerIncomingCall();
}

export function observeIncomingCalls(
  callback: (event: { state: 'ringing' | 'offhook' | 'idle'; incomingNumber: string }) => void,
): { remove(): void } | null {
  if (Platform.OS !== 'android' || !padiDevice) return null;
  return padiDevice.addListener('callState', callback);
}
