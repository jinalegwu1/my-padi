import { Redirect } from 'expo-router';

import { usePreferences } from '@/hooks/use-preferences';

/**
 * Entry route. Sends first-time users through onboarding and everyone else
 * straight to the conversation.
 */
export default function Index() {
  const { preferences } = usePreferences();
  return <Redirect href={preferences.onboarded ? '/(tabs)/chat' : '/onboarding/country'} />;
}
