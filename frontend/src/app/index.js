import { Redirect } from 'expo-router';
import { createElement, useEffect, useState } from 'react';
import { usePreferences } from '@/hooks/use-preferences';
import { readSession } from '@/lib/session';
import { syncAccountCountry } from '@/lib/account-country';

export default function Index() {
  const {preferences} = usePreferences();
  const [route, setRoute] = useState(null);
  useEffect(() => {
    if (preferences.onboarded) return;
    let active = true;
    async function resume() {
      const session = await readSession();
      const country = session && await syncAccountCountry(session);
      if (active) setRoute(country ? '/chat' : '/onboarding/welcome');
    }
    void resume().catch(() => { if (active) setRoute('/onboarding/welcome'); });
    return () => { active = false; };
  }, [preferences.onboarded]);
  const href = preferences.onboarded ? '/chat' : route;
  return href ? createElement(Redirect, {href}) : null;
}
