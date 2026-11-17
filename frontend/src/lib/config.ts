import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Runtime configuration. EXPO_PUBLIC_* values are inlined at build time from .env
 * (or the EAS build environment) and are readable by anyone holding the app, so
 * nothing secret may come through here.
 */
const configuredURL = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/+$/, '');

function apiURL(): string {
  if (!__DEV__ || Platform.OS === 'web' || !configuredURL || !Constants.expoConfig?.hostUri) {
    return configuredURL;
  }
  try {
    const url = new URL(configuredURL);
    if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      // A phone reaches the computer running Expo through its LAN address.
      url.hostname = new URL(`http://${Constants.expoConfig.hostUri}`).hostname;
      return url.toString().replace(/\/+$/, '');
    }
  } catch {
    // Preserve explicit configuration so the existing API error handling can
    // report an invalid address; do not silently switch remote environments.
  }
  return configuredURL;
}

export const API_URL = apiURL();

/** True when the app was built without a backend address. */
export const hasBackend = API_URL.length > 0;
