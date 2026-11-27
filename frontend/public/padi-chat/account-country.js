// Country is account profile data. Older installations kept the choice only
// in device preferences, so seed an empty profile once from the existing session.
export async function syncCountry({
  session, api, currentSession, readPreferences, savePreferences, freshLogin = false, beforeChat = false,
}) {
  const owner = session.user.id;
  let prefs = await readPreferences();
  const code = prefs.countryCode;
  const pending = prefs.countrySyncPending;
  const mine = prefs.countryOwner === owner;
  if (beforeChat && mine && !pending && (prefs.onboarded || !code)) return code;
  const unclaimed = !prefs.countryOwner;
  const legacy = unclaimed && !freshLogin && prefs.onboarded && !pending;
  const upload = /^[A-Z]{2}$/.test(code || '') &&
    (pending && (mine || unclaimed) || legacy);

  if ((await currentSession())?.token !== session.token) return;
  if (freshLogin && unclaimed && !pending && code) {
    prefs = {...prefs, countryCode:null, countryOwner:owner, countrySyncPending:false};
    await savePreferences(prefs);
  }
  if (upload && unclaimed) {
    // Claim before doing network I/O. An offline sign-out must not give this
    // choice to the next account. A pre-sign-in choice seeds only an empty profile.
    prefs = {...prefs, countryOwner: owner, countrySyncPending: 'import'};
    await savePreferences(prefs);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  let saved;
  try {
    const response = await fetch(api + '/v1/account/country', {
      method: upload ? 'PATCH' : 'GET',
      headers: {Authorization: 'Bearer ' + session.token, ...(upload && {'Content-Type': 'application/json'})},
      body: upload ? JSON.stringify({country_code: code, only_if_missing: prefs.countrySyncPending === 'import'}) : undefined,
      signal: controller.signal, cache: 'no-store', redirect: 'error',
    });
    if (!response.ok) throw new Error();
    saved = (await response.json()).country_code;
    if (typeof saved !== 'string' || (saved && !/^[A-Z]{2}$/.test(saved))) throw new Error();
  } catch {
    throw new Error('Your country could not sync. Check your connection and try again.');
  } finally {
    clearTimeout(timeout);
  }
  const latest = await readPreferences();
  if ((await currentSession())?.token !== session.token || latest.countryCode !== prefs.countryCode ||
      latest.countryOwner !== prefs.countryOwner || latest.countrySyncPending !== prefs.countrySyncPending) return;
  // A different account may have an unsent choice on this device.
  if (latest.countryOwner && latest.countryOwner !== owner && latest.countrySyncPending) return saved;
  if (latest.countryOwner !== owner || (latest.countryCode || '') !== saved || latest.countrySyncPending || (saved && !latest.onboarded)) {
    await savePreferences({...latest, countryCode: saved || null, countryOwner: owner, countrySyncPending: false, ...(saved && {onboarded:true})});
  }
  return saved;
}

// Serialize account switches and Settings edits in the same browser origin.
let pendingSync = Promise.resolve();
export function withCountryLock(work) {
  if (globalThis.navigator?.locks) return navigator.locks.request('padi.account.country', work);
  const next = pendingSync.then(work);
  pendingSync = next.catch(() => {});
  return next;
}
