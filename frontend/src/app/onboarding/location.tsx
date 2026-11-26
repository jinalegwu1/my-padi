import { Redirect } from 'expo-router';
import { usePreferences } from '@/hooks/use-preferences';

/** Resolve links saved by earlier releases into the two-screen flow. */
export default function LegacyOnboardingRoute() {
  const { preferences } = usePreferences();
  return <Redirect href={preferences.onboarded ? '/(tabs)/chat' : '/onboarding/country'} />;
}
