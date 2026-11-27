import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { createElement, useEffect, useRef, useState } from 'react';
import { WebView } from 'react-native-webview';

const origin = 'https://padi.invalid/';
const local = url => url === origin || url === 'about:blank';
let bundled;

async function loadFrame() {
  const asset = await Asset.fromModule(require('../../../chat-web/generated/chat.html')).downloadAsync();
  return {html: await new File(asset.localUri || asset.uri).text(), baseUrl: origin};
}

// The document receives display state. Credentials, HTTP and device APIs stay
// in the host. Only local, length-bounded actions reach the controller.
export function PortraitFrame({state, voice, recorder, onAction, onFailed, subscribeLevel}) {
  const frame = useRef(null);
  const alive = useRef(false);
  const [ready, setReady] = useState(false);
  const [source, setSource] = useState(null);
  function publish(type, data) {
    if (!alive.current) return;
    frame.current?.injectJavaScript('window.padiChatReceive(' + JSON.stringify(type) + ',' + JSON.stringify(data ?? null) + ');true;');
  }
  useEffect(() => {
    alive.current = true;
    bundled ??= loadFrame().catch(error => { bundled = undefined; throw error; });
    bundled.then(value => { if (alive.current) setSource(value); }).catch(() => { if (alive.current) onFailed(); });
    return () => { alive.current = false; };
  }, [onFailed]);
  useEffect(() => { if (ready) publish('state', state); }, [ready, state]);
  useEffect(() => { if (ready && voice) publish('voice', voice); }, [ready, voice]);
  useEffect(() => { if (ready && recorder) publish('recorder', recorder); }, [ready, recorder]);
  useEffect(() => {
    if (ready && state.owner && state.mode !== 'text') return subscribeLevel(level => publish('level', {...level, voiceId:'ada'}));
  }, [ready, state.owner, state.mode, subscribeLevel]);
  async function receive({nativeEvent}) {
    if (!local(nativeEvent.url) || typeof nativeEvent.data !== 'string' || nativeEvent.data.length > 11000) return;
    let packet;
    try { packet = JSON.parse(nativeEvent.data); } catch { return; }
    if (!packet || !Number.isSafeInteger(packet.id) || packet.id <= 0 || typeof packet.action !== 'string') return;
    if (packet.action === 'open') setReady(true);
    const result = await onAction(packet.action, packet.value);
    publish('result', {id:packet.id, result:result ?? null});
  }
  return source && createElement(WebView, {
    ref:frame, source, onMessage:receive, style:{flex:1, backgroundColor:'#123c32'},
    originWhitelist:['*'], incognito:true, domStorageEnabled:false,
    allowFileAccess:false, allowFileAccessFromFileURLs:false, allowUniversalAccessFromFileURLs:false,
    mixedContentMode:'never', javaScriptCanOpenWindowsAutomatically:false, setSupportMultipleWindows:false,
    mediaCapturePermissionGrantType:'deny', webviewDebuggingEnabled:false, dataDetectorTypes:'none',
    onShouldStartLoadWithRequest:request=>local(request.url),
    onError:onFailed, onContentProcessDidTerminate:onFailed, onRenderProcessGone:onFailed,
  });
}
