import { chatApiBase } from './web-config.js';

const query = new URLSearchParams(location.search);
const route = query.get('route') || '/onboarding/welcome';
const routes = /^\/(?:onboarding\/(?:welcome|country)|auth)\/?(?:\?|$)/;
history.replaceState(history.state, '', routes.test(route) ? route : '/onboarding/welcome');
const view = JSON.parse(sessionStorage.getItem('padi.entry.view.v1') || 'null');
if (!view) location.replace(location.pathname + location.search);
const mode = new URLSearchParams(location.search).get('mode');
const chat = ({text:'/chat?mode=text',call:'/voice',transcribe:'/voice?mode=transcribe'})[mode] || '/chat';
const modeQuery = ['text','call','transcribe'].includes(mode) ? '?mode=' + mode : '';
const preferenceKey = 'app:v1:preferences';
const sessionKey = 'padi.auth.session.v1';
const api = chatApiBase();

async function request(path, body) {
  if (!api) throw new Error('The PADI backend address is missing from this build.');
  const response = await fetch(api + path, {
    method: body ? 'POST' : 'GET', headers: body ? {'Content-Type':'application/json'} : {},
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000),
    cache: 'no-store', redirect: 'error',
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'PADI could not complete that request.');
  return data;
}

function continueToChat(session) {
  if (session) {
    if (!session.user?.id || !session.token || !Number.isFinite(Date.parse(session.expires_at))) throw new Error('PADI could not open that session.');
    sessionStorage.setItem(sessionKey, JSON.stringify(session));
    sessionStorage.setItem('padi.country.login', session.user.id);
  }
  location.replace('/padi-chat.html?route=' + encodeURIComponent(chat));
}

window.padiEntryAction = async (action, value) => {
  if (action === 'open') return view;
  if (action === 'start') return location.assign('/onboarding/country' + modeQuery);
  if (action === 'back') return location.replace(view.screen === 'country' ? '/onboarding/welcome' + modeQuery : chat);
  if (action === 'country' && view.countries.some(country => country.code === value)) {
    const prefs = JSON.parse(localStorage.getItem(preferenceKey) || sessionStorage.getItem('padi.entry.defaults.v1') || '{}');
    const session = JSON.parse(sessionStorage.getItem(sessionKey) || 'null');
    const owner = session && Date.parse(session.expires_at) > Date.now() ? session.user.id : null;
    localStorage.setItem(preferenceKey, JSON.stringify({...prefs, countryCode:value, countryOwner:owner,countrySyncPending:true,onboarded:true}));
    return continueToChat();
  }
  if (view.screen !== 'auth') throw new Error('Open sign-in to continue.');
  if (action === 'authConfig') {
    const result = await request('/v1/auth/config');
    if (typeof result.otp_required !== 'boolean') throw new Error('PADI could not load sign-in settings.');
    return result;
  }
  if (['register','login','verify'].includes(action)) {
    const result = await request('/v1/auth/' + action, value);
    if (action === 'verify' || result.session) return continueToChat(result.session || result);
    if (!result.challenge_id) throw new Error('PADI could not open phone verification.');
    return {challenge_id:result.challenge_id,message:result.message};
  }
  throw new Error('This action is unavailable.');
};
