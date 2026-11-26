import { Redirect } from 'expo-router';

import { usePreferences } from '@/hooks/use-preferences';

/** Open chat directly once the user has chosen a country. */
export default function Index() {
  const { preferences } = usePreferences();
  return <Redirect href={preferences.onboarded ? '/(tabs)/chat' : '/onboarding/welcome'} />;
}
