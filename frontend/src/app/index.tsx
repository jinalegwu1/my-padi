import { Redirect } from 'expo-router';

import { usePreferences } from '@/hooks/use-preferences';

/**
 * Entry route. First-time users meet PADI; returning users get a local greeting
 * before entering the conversation.
 */
export default function Index() {
  const { preferences } = usePreferences();
  return <Redirect href={preferences.onboarded ? '/(tabs)/chat' : '/onboarding/welcome'} />;
}
