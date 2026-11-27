// Keep the bundled, offline WebView on the same audio implementation as the web page.
import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../frontend/', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');
const html = 'chat-web/generated/chat.html';
const [document, output, frame, css] = await Promise.all([read(html), read('public/padi-chat/voice-output.js'),
  read('public/padi-chat/voice-frame.js'), read('public/padi-chat/voice-output.css')]);
const code = output.replace('export function createVoiceOutput', 'function createVoiceOutput') + '\n' +
  frame.replace("import { createVoiceOutput } from './voice-output.js';", '').replace('export function connectFrameVoice', 'function connectFrameVoice');
const addon = `<!-- document audio -->\n<style>${css}</style>\n<script>(() => {\n${code}
window.padiFrameAudio = connectFrameVoice(value => window.ReactNativeWebView.postMessage(JSON.stringify({action:'audioEvent', value})),
  level => window.padiChatReceive('level', level));
})();</script>\n<!-- end document audio -->`;
const result = document.replace(/<!-- document audio -->[\s\S]*?<!-- end document audio -->\n?/,'').replace('</body>', addon+'\n</body>');
if (result !== document) await writeFile(new URL(html, root), result);
