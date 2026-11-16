import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const SESSION_KEY = 'padi.auth.session.v1';

export type AppSession = {
  token: string;
  expires_at: string;
  user: { id: string; full_name: string };
};

function isSession(value: unknown): value is AppSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<AppSession>;
  return (
    typeof session.token === 'string' &&
    typeof session.expires_at === 'string' &&
    Date.parse(session.expires_at) > Date.now() &&
    !!session.user &&
    typeof session.user.id === 'string' &&
    typeof session.user.full_name === 'string'
  );
}

export async function readSession(): Promise<AppSession | null> {
  const serialized =
    Platform.OS === 'web'
      ? typeof sessionStorage === 'undefined'
        ? null
        : sessionStorage.getItem(SESSION_KEY)
      : await SecureStore.getItemAsync(SESSION_KEY);
  if (!serialized) return null;

  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    await clearSession();
    return null;
  }
  if (!isSession(value)) {
    await clearSession();
    return null;
  }
  return value;
}

export async function saveSession(session: AppSession): Promise<void> {
  const serialized = JSON.stringify(session);
  if (Platform.OS === 'web') {
    if (typeof sessionStorage === 'undefined') {
      throw new Error('Browser session storage is unavailable.');
    }
    sessionStorage.setItem(SESSION_KEY, serialized);
    return;
  }
  await SecureStore.setItemAsync(SESSION_KEY, serialized);
}

export async function clearSession(): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(SESSION_KEY);
    return;
  }
  await SecureStore.deleteItemAsync(SESSION_KEY);
}
