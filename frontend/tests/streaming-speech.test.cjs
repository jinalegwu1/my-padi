const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTS } = require('./helpers/load-ts.cjs');
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

function fixture() {
  const requests = [], audio = [];
  const { createGroqSpeechStream, trimSpeechPadding } = loadTS('src/lib/streaming-speech.ts', {
    '@/lib/api': { synthesiseSpeech: (...args) => new Promise((resolve, reject) => {
      requests.push({ args, resolve: value => resolve({ audio_base64: value }) });
      args[4].addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
    }) },
    '@/lib/session': { readSession: async () => ({ token: 'token' }) },
    '@/lib/spoken-text': { spokenText: text => text },
    '@/lib/voice-playback': { createVoiceQueue: () => ({ enqueue: async (value, start, complete) => {
      audio.push(value); start(); complete();
    }, finish: async () => {} }) },
  });
  const controller = new AbortController();
  return { requests, audio, controller, trimSpeechPadding, speech: createGroqSpeechStream('ada', 1, 'en-NG', controller.signal, () => {}, () => {}) };
}

test('TTS prepares ahead with bounded concurrency and audio retains text order', async () => {
  const f = fixture();
  ['One.', 'Two.', 'Three.', 'Four.', 'Five.'].forEach(text => f.speech.enqueue(text));
  const finished = f.speech.finish(); await tick();
  assert.equal(f.requests.length, 2);
  assert.ok(f.requests.every(request => request.args[7] === true), 'Every request is Groq-only.');
  f.requests[1].resolve('second'); await tick();
  assert.equal(f.requests.length, 3); assert.deepEqual(f.audio, []);
  assert.equal(f.requests[2].args[1], 'Three. Four. Five.');
  f.requests[0].resolve('first'); await tick();
  f.requests[2].resolve('tail'); await finished;
  assert.deepEqual(f.audio, ['first', 'second', 'tail']);
});

test('exit aborts synthesis, discards waiting text and prevents late playback', async () => {
  const f = fixture(); ['One.', 'Two.', 'Three.'].forEach(text => f.speech.enqueue(text));
  await tick(); f.controller.abort(); await f.speech.finish();
  assert.equal(f.requests.length, 2); assert.deepEqual(f.audio, []);
});

test('outer PCM padding is trimmed while every voiced sample remains intact', () => {
  const f=fixture();
  const bytes=Buffer.alloc(44+48000*2);
  bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);
  bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);
  bytes.writeUInt32LE(24000,24);bytes.writeUInt32LE(48000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);
  bytes.write('data',36);bytes.writeUInt32LE(bytes.length-44,40);
  for(let i=12000;i<36000;i++)bytes.writeInt16LE(Math.round(3000*Math.sin(i*.2)),44+i*2);
  const trimmed=Buffer.from(f.trimSpeechPadding(bytes.toString('base64')),'base64');
  assert.ok(trimmed.length<bytes.length);
  assert.equal(trimmed.readUInt32LE(4),trimmed.length-8);
  assert.deepEqual(trimmed.subarray(44+1440*2,44+(1440+24000)*2),bytes.subarray(44+12000*2,44+36000*2));
});

test('a long unfinished first sentence releases usable text without losing words', () => {
  const { takeReadySpeech }=loadTS('src/lib/voice-audio.ts',{'react-native':{Platform:{OS:'web'}},'expo-file-system':{}});
  const text=Array.from({length:80},(_,i)=>`word${i}`).join(' ');
  const first=takeReadySpeech(text);
  assert.equal(first.sentences.length,1);assert.ok(first.sentences[0].length<=160);
  assert.equal(first.sentences[0]+' '+first.remainder,text);
});
