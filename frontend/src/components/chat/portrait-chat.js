import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused, useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { useChat } from '@/hooks/use-chat';
import { DEFAULT_PREFERENCES, usePreferences } from '@/hooks/use-preferences';
import { useTranscriptionSession } from '@/hooks/use-transcription-session';
import { useVoiceSession } from '@/hooks/use-voice-session';
import { clearSession, readSession, subscribeSession } from '@/lib/session';
import { syncAccountCountry } from '@/lib/account-country';
import { revokeSession } from '@/lib/api';
import { unregisterCurrentPushDevice } from '@/lib/push-notifications';
import { visibleChatMessages } from '@/lib/chat-context';
import { createDocumentVoice } from '@/lib/document-voice';
import { takeReadySpeech } from '@/lib/voice-audio';
import { fetchWeatherForCoordinates } from '@/lib/weather';
import { latestPreferenceID } from '../../../public/padi-chat/preference-review';
import { PortraitFrame } from './portrait-frame';

const routes = {text:'/chat?mode=text', voice:'/chat?mode=voice', call:'/voice', record:'/voice?mode=transcribe'};
const destinations = ['/settings','/memory','/reminders','/device-actions','/weather'];
const ratings = ['helpful','not_helpful','liked_humour','unwanted_humour'];

function Recorder({reference, changed}) {
  const {session, configurationError, ...snapshot} = useTranscriptionSession();
  useEffect(() => { reference.current = session; return () => { reference.current = null; }; }, [reference, session]);
  useEffect(() => { changed({...snapshot, error:snapshot.error || configurationError}); },
    [snapshot.phase, snapshot.ready, snapshot.error, snapshot.transcript, snapshot.recording,
      snapshot.progress, snapshot.totalMs, snapshot.uploadMs, configurationError, changed]);
  return null;
}

export function PortraitChat({fallback}) {
  const router = useRouter(), path = usePathname(), params = useLocalSearchParams();
  const mode = path === '/voice' ? params.mode === 'transcribe' ? 'record' : 'call' : params.mode === 'text' ? 'text' : 'voice';
  const chat = useChat(), {preferences, update} = usePreferences(), focused = useIsFocused();
  const [account, setAccount] = useState(null), [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState(''), [notice, setNotice] = useState(''), [retry, setRetry] = useState(0);
  const [paused, setPaused] = useState(false), [speech, setSpeech] = useState(null);
  const [recording, setRecording] = useState(null), [frameFailed, setFrameFailed] = useState(false);
  const recorder = useRef(null), turn = useRef(null), audio = useRef(null), greeting = useRef('');
  const [output] = useState(createDocumentVoice);
  const [documentReady, setDocumentReady] = useState(false);
  function createOutput(signal, start, delivered, live = false) {
    return output.stream({owner:account?.user.id, languageCode:preferences.languageCode, voiceRate:preferences.voiceRate,
      streaming:voice.configuration?.streaming_speech_languages?.includes(preferences.languageCode), live}, signal, start, delivered);
  }
  const voice = useVoiceSession((signal, start, delivered) => createOutput(signal, start, delivered, true));
  const stopAudio = useCallback(() => {
    audio.current?.controller.abort();
    audio.current = null;
    setSpeech(null);
  }, []);
  const stop = useCallback(() => {
    turn.current?.abort();
    stopAudio();
    void voice.session.cancel();
    void recorder.current?.cancel();
  }, [voice.session, stopAudio]);
  const failed = useCallback(() => { stop(); setFrameFailed(true); }, [stop]);
  useEffect(() => {
    if (!focused) return;
    let generation = 0;
    const load = async () => {
      const current = ++generation;
      stop(); setAccount(null); setFailure(''); setLoading(true);
      try {
        const session = await readSession();
        if (session && current === generation) await syncAccountCountry(session, false, true);
        if (current === generation) setAccount(session);
      } catch (error) { if (current === generation) setFailure(error.message); }
      finally { if (current === generation) setLoading(false); }
    };
    const unsubscribe = subscribeSession(load);
    void load();
    return () => { generation++; unsubscribe(); stop(); };
  }, [focused, retry, stop]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'background') { stop(); setPaused(true); }
    });
    return () => subscription.remove();
  }, [stop]);
  useEffect(() => {
    if (!preferences.autoSpeakReplies && audio.current?.automatic) stopAudio();
  }, [preferences.autoSpeakReplies, stopAudio]);
  useEffect(() => { setPaused(false); setNotice(''); return stop; }, [mode, stop]);
  const owner = account?.user.id;
  const messages = owner ? visibleChatMessages(chat.messages, owner) : [];
  const history = owner ? chat.historyFor(owner) : [];
  const review = latestPreferenceID(messages, owner);
  const opened = useRef('');
  useEffect(() => {
    if (!documentReady || !focused || !owner || loading || frameFailed || chat.status !== 'ready' || paused) return;
    const key = owner + '/' + chat.conversationID + '/' + mode;
    if (mode === 'text' && !messages.length && greeting.current !== key && !chat.isThinking) {
      greeting.current = key;
      void chat.greet(owner, preferences.languageCode);
    }
    if (voice.ready && !chat.isThinking && opened.current !== key &&
        (mode === 'voice' || mode === 'text' && preferences.wakeWordEnabled)) {
      opened.current = key;
      voice.connect(mode === 'voice', mode === 'text', mode === 'voice');
    }
  }, [documentReady, focused, owner, loading, frameFailed, chat.status, paused, mode, chat.conversationID,
    messages.length, chat.isThinking, chat.greet, voice.ready, voice.connect, preferences.languageCode, preferences.wakeWordEnabled]);
  useEffect(() => () => { opened.current = ''; }, [mode, focused]);

  async function send(text) {
    if (mode !== 'text' || typeof text !== 'string' || !text.trim() || text.length > 2000 || turn.current || chat.isThinking) return false;
    stopAudio(); setNotice('');
    const controller = new AbortController();
    turn.current = controller;
    const playback = new AbortController();
    const automatic = preferences.autoSpeakReplies;
    if (automatic) audio.current = {controller:playback, automatic:true};
    const automaticSpeech = automatic && createOutput(playback.signal, () => {
      if (audio.current?.controller !== playback) return;
      audio.current.started = true;
      if (audio.current.id && !audio.current.paused) setSpeech({id:audio.current.id, phase:'speaking'});
    }, () => {});
    let remainder = '', first = true;
    try {
      const result = await chat.sendStreamingText(text, owner, controller.signal, delta => {
        if (!automaticSpeech || playback.signal.aborted) return;
        const ready = takeReadySpeech(remainder + delta, first);
        ready.sentences.forEach(sentence => automaticSpeech.enqueue(sentence));
        if (ready.sentences.length) first = false;
        remainder = ready.remainder;
      });
      if (result.status !== 'sent') { playback.abort(); if (automaticSpeech) void automaticSpeech.finish().catch(() => {}); return false; }
      if (automaticSpeech && !playback.signal.aborted) {
        if (audio.current?.controller === playback) {
          audio.current.id = result.messageID;
          setSpeech({id:result.messageID, phase:audio.current.started ? 'speaking':'loading'});
        }
        if (remainder.trim()) automaticSpeech.enqueue(remainder);
        void automaticSpeech.finish().catch(error => { if (!playback.signal.aborted) setNotice(error.message); })
          .finally(() => { if (audio.current?.controller === playback) { audio.current = null; setSpeech(null); } });
      }
      return true;
    } finally { if (turn.current === controller) turn.current = null; }
  }

  async function action(type, value) {
    try {
      if (!focused || frameFailed) return;
      const authRoute = '/auth' + ({text:'?mode=text', call:'?mode=call',record:'?mode=transcribe'}[mode] || '');
      if (type === 'open') { if (failure) setRetry(n=>n+1); return; }
      if (type === 'navigate' && (value === authRoute || owner && destinations.includes(value))) { stop(); router.push(value); return; }
      if (type === 'end') { stop(); router.replace(routes.text); return; }
      if (!account || (await readSession())?.token !== account.token) return;
      if (type === 'mode' && Object.hasOwn(routes,value)) { stop(); router.replace(routes[value]); }
      else if (type === 'thread' && (!value || history.some(thread=>thread.id===value))) {
        stop(); value ? chat.selectConversation(value) : chat.newChat();
        if (value && mode !== 'text') router.replace(routes.text);
      } else if (type === 'reviewMemory' && review && value === review) { stop(); router.push({pathname:'/memory', params:{message:review}}); }
      else if (type === 'send') return await send(value);
      else if (type === 'cancel') { turn.current?.abort(); stopAudio(); }
      else if (type === 'preference' && ['autoSpeakReplies','showVoiceTranscript','chatLocationPromptHandled'].includes(value?.key) && typeof value.value === 'boolean') update({[value.key]:value.value});
      else if (type === 'voice' && (mode === 'voice' || mode === 'call')) {
        setPaused(false);
        if (voice.connected) await voice.session.reactToTouch();
        else if (voice.ready) voice.connect();
        else setNotice(voice.configurationError || 'Voice is getting ready. Tap PADI again.');
      } else if (type === 'pauseCall') { setPaused(true); await voice.session.cancel(); }
      else if (type === 'record' && mode === 'record' && ['en','pcm-NG','auto'].includes(value)) await recorder.current?.start(value);
      else if (type === 'finishRecord') await recorder.current?.finish();
      else if (type === 'cancelRecord') await recorder.current?.cancel();
      else if (type === 'rate' && ratings.includes(value?.rating) && messages.some(m=>m.id===value.id && m.backendUserID===owner && m.role==='padi')) await chat.rateResponse(value.id,value.rating);
      else if (type === 'stop') stopAudio();
      else if (type === 'pause' || type === 'resume') {
        const active = audio.current;
        if (active?.id === value) { active.paused = type === 'pause'; await output[type](); if (audio.current === active) setSpeech({id:value,phase:type === 'pause'?'paused':'speaking'}); }
      } else if (type === 'play') {
        const message = messages.find(m=>m.id===value && m.backendUserID===owner && m.role==='padi' && m.backendChat);
        if (!message) return;
        stopAudio();
        const controller = new AbortController();
        const player = createOutput(controller.signal, () => {
          if (!controller.signal.aborted && !audio.current?.paused) setSpeech({id:value,phase:'speaking'});
        }, () => {});
        audio.current = {id:value, controller};
        setSpeech({id:value,phase:'loading'});
        player.enqueue(message.text);
        try { await player.finish(); } finally { if (audio.current?.controller === controller) stopAudio(); }
      } else if (type === 'external' && typeof value === 'string' && /^https?:\/\//i.test(value)) await Linking.openURL(value);
      else if (type === 'weather' && (await Location.requestForegroundPermissionsAsync()).granted) {
        const position = await Location.getCurrentPositionAsync({accuracy:Location.Accuracy.Low});
        return await fetchWeatherForCoordinates(position.coords,'');
      } else if (type === 'logout') {
        stop();
        let warning = '';
        try { await unregisterCurrentPushDevice(account.token); } catch { warning = 'Push delivery could not be disabled on this device.'; }
        if ((await readSession())?.token === account.token) await clearSession();
        try { await revokeSession(account.token); } catch { warning = 'The server could not confirm sign-out.'; }
        setNotice(warning);
      }
    } catch (error) { setNotice(error.message || 'That action could not finish. Try again.'); }
  }
  if (frameFailed) return createElement(fallback);
  const gate = loading ? {title:'Opening PADI…',pending:true} : failure ? {title:'Chat could not open',message:failure,retry:true} :
    owner ? null : {title:'Sign in to chat with PADI',message:'Continue with your phone number to open your conversations.'};
  const state = {owner, name:account?.user.full_name, mode, gate, preferences:{...DEFAULT_PREFERENCES,...preferences,voiceId:'ada'},
    thread:chat.conversationID, messages:mode==='text'?messages:[], history, ratings:[], busy:chat.isThinking, speech, paused, review,
    error:notice || chat.sendError || (mode==='record' ? recording?.error : mode!=='text' ? voice.error || voice.configurationError : '') || ''};
  return createElement(SafeAreaView,{style:{flex:1,backgroundColor:'#123c32'}},
    focused && owner && mode === 'record' && createElement(Recorder,{reference:recorder, changed:setRecording}),
    createElement(PortraitFrame,{state, voice:{phase:voice.phase,connected:voice.connected,userText:voice.userText,padiText:voice.padiText},
      recorder:recording,onAction:action,onFailed:failed,output,onReady:setDocumentReady}));
}
