import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { usePreferences } from '@/hooks/use-preferences';
import { getAuthConfiguration, requestLogin, requestRegistration, verifyCode } from '@/lib/api';
import { selectAccountCountry, syncAccountCountry } from '@/lib/account-country';
import { saveSession } from '@/lib/session';
import { entryData } from './entry-data';

const origin = 'https://padi.invalid/';
const local = url => url === origin || url === 'about:blank';
let bundled;

async function file(asset) {
  const loaded = await Asset.fromModule(asset).downloadAsync();
  return new File(loaded.localUri || loaded.uri);
}
async function loadDocument() {
  let html = await (await file(require('../../../public/padi-entry.html'))).text();
  html = html.replace('<head>', '<head><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; script-src &#39;unsafe-inline&#39;; style-src &#39;unsafe-inline&#39;; img-src data:; font-src data:; form-action &#39;none&#39;; base-uri &#39;none&#39;">');
  const media = [
    ['gold-knot-7ZCF5SZY.png','image/png',require('../../../public/padi-chat/media/gold-knot-7ZCF5SZY.png')],
    ['ada-KDZYEDLK.jpg','image/jpeg',require('../../../public/padi-chat/media/ada-KDZYEDLK.jpg')],
    ['PlusJakartaSans_400Regular-MJLHH3MY.ttf','font/ttf',require('../../../public/padi-chat/media/PlusJakartaSans_400Regular-MJLHH3MY.ttf')],
    ['PlusJakartaSans_700Bold-6TV34UFS.ttf','font/ttf',require('../../../public/padi-chat/media/PlusJakartaSans_700Bold-6TV34UFS.ttf')],
  ];
  for (const [name, mime, module] of media) {
    const encoded = await (await file(module)).base64();
    html = html.replaceAll('/padi-chat/media/' + name, 'data:' + mime + ';base64,' + encoded);
  }
  return {html,baseUrl:origin};
}

export default function EntryScreen() {
  const path = usePathname(), {mode} = useLocalSearchParams(), router = useRouter();
  const {preferences} = usePreferences();
  const frame = useRef(null), active = useRef(false);
  const [source, setSource] = useState(null), [error, setError] = useState('');
  useEffect(() => {
    active.current = true;
    bundled ??= loadDocument().catch(e => { bundled = null; throw e; });
    bundled.then(doc => { if (active.current) setSource(doc); }).catch(() => { if (active.current) setError('PADI could not load this screen.'); });
    return () => { active.current = false; };
  }, []);
  const onMessage = useCallback(async ({nativeEvent}) => {
    if (!local(nativeEvent.url) || typeof nativeEvent.data !== 'string' || nativeEvent.data.length > 2048) return;
    let id;
    const answer = (value, message) => {
      if (active.current) frame.current?.injectJavaScript('window.padiEntryResult(' + [id,value ?? null,message ?? null].map(v=>JSON.stringify(v)).join(',') + ');true;');
    };
    try {
      const event = JSON.parse(nativeEvent.data); id = event.id;
      if (!Number.isSafeInteger(id) || id < 1) return;
      const {action,value} = event, data = entryData(path,preferences);
      const chat = mode === 'call' ? '/voice' : mode === 'transcribe' ? '/voice?mode=transcribe' : mode === 'text' ? '/chat?mode=text' : '/chat';
      if (action === 'open') return answer(data);
      if (action === 'back') return router.replace(data.screen === 'country' ? '/onboarding/welcome' : chat);
      if (data.screen === 'welcome' && action === 'start') return router.push({pathname:'/onboarding/country',params:{mode}});
      if (data.screen === 'country' && action === 'country' && data.countries.some(c => c.code === value)) {
        await selectAccountCountry(value, true); return router.replace(chat);
      }
      if (data.screen !== 'auth') return;
      if (action === 'authConfig') return answer(await getAuthConfiguration());
      let result;
      if (action === 'login' && typeof value?.phone_number === 'string') result = await requestLogin(value.phone_number);
      else if (action === 'register' && ['phone_number','full_name','date_of_birth'].every(k => typeof value?.[k] === 'string')) {
        result = await requestRegistration({phone_number:value.phone_number,full_name:value.full_name,date_of_birth:value.date_of_birth});
      } else if (action === 'verify' && typeof value?.challenge_id === 'string' && /^\d{6}$/.test(value.code)) {
        result = {session:await verifyCode(value.challenge_id,value.code)};
      } else return;
      if (!active.current) return;
      if (result.session) {
        await saveSession(result.session);
        // Sign-in has succeeded even if the country upload is temporarily offline.
        // The conversation gate can retry the claimed selection with this session.
        await syncAccountCountry(result.session, true).catch(() => {});
        if (active.current) router.replace(chat);
      }
      else answer({challenge_id:result.challenge_id,message:result.message});
    } catch(e) { if (Number.isSafeInteger(id)) answer(null,e.message || 'PADI could not finish that request.'); }
  }, [path, preferences, mode, router]);
  return createElement(SafeAreaView, {style:{flex:1,backgroundColor:'#102e29'}},
    error ? createElement(Text,{style:{color:'#faf8f1'}},error) : source && createElement(WebView,{
      ref:frame,source,onMessage,style:{backgroundColor:'#102e29'}, incognito:true,originWhitelist:['*'],
      allowFileAccess:false,allowUniversalAccessFromFileURLs:false,allowFileAccessFromFileURLs:false,
      domStorageEnabled:false,javaScriptCanOpenWindowsAutomatically:false,setSupportMultipleWindows:false,
      onShouldStartLoadWithRequest:request=>local(request.url),mediaCapturePermissionGrantType:'deny',mixedContentMode:'never',
    }));
}
