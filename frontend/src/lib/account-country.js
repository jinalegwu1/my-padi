import { syncCountry, withCountryLock } from '../../public/padi-chat/account-country';
import { API_URL } from '@/lib/config';
import { readSession } from '@/lib/session';
import { readJSON, writeJSON } from '@/lib/storage';

const readPreferences = () => readJSON('preferences', {});
const savePreferences = values => writeJSON('preferences', values);
const sync = (session, freshLogin, beforeChat) => syncCountry({
  session, api: API_URL, currentSession: readSession, readPreferences, savePreferences, freshLogin, beforeChat,
});

export function syncAccountCountry(session, freshLogin = false, beforeChat = false) {
  return withCountryLock(() => sync(session, freshLogin, beforeChat));
}

export async function selectAccountCountry(code, onboarding = false) {
  // Capture the owner at the tap, before waiting for an earlier request.
  const session = await readSession();
  return withCountryLock(async () => {
    if ((await readSession())?.token !== session?.token) return;
    const prefs = await readPreferences();
    await savePreferences({...prefs, countryCode: code, countryOwner: session?.user.id || null,
      countrySyncPending: true, ...(onboarding && {onboarded: true})});
    return session ? await sync(session, false) : code;
  });
}
