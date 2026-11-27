const test = require('node:test');
const assert = require('node:assert/strict');
const { loadJS } = require('./helpers/load-ts.cjs');
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

function fixture() {
  const requests = [], audio = [];
  const { createSpeechStream, trimSpeechPadding } = loadJS('src/lib/streaming-speech.js', {
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
  return { requests, audio, controller, trimSpeechPadding, speech: createSpeechStream('ada', 1, 'en-NG', controller.signal, () => {}, () => {}) };
}

test('TTS prepares ahead with bounded concurrency and audio retains text order', async () => {
  const f = fixture();
  ['One.', 'Two.', 'Three.', 'Four.', 'Five.'].forEach(text => f.speech.enqueue(text));
  const finished = f.speech.finish(); await tick();
  assert.equal(f.requests.length, 2);
  assert.ok(f.requests.every(request => request.args[6] === true && request.args[7] === false), 'Every request uses the configured Python engine without forcing a cloud TTS provider.');
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

test('neural audio plays before synthesis finishes and credits only a fully played phrase', async () => {
  const clips=[], spoken=[], finishPhrase=[];
  const wordsByClip = new Map();
  const packet = label => {
    const wave = Buffer.alloc(44 + 24000, wordsByClip.size + 1).toString('base64');
    wordsByClip.set(wave,label);
    return wave;
  };
  const { createSpeechStream }=loadJS('src/lib/streaming-speech.js',{
    '@/lib/api':{streamSpeechAudio:async(_token,words,_style,_rate,_language,_signal,chunk)=>{
      chunk(packet(words + ' first')); await new Promise(resolve=>finishPhrase.push(resolve)); chunk(packet(words + ' last'));
    }},
    '@/lib/session':{readSession:async()=>({token:'a'})}, '@/lib/spoken-text':{spokenText:text=>text},
    '@/lib/voice-playback':{createVoiceQueue:()=>({
      enqueue:(wave)=>new Promise(resolve=>clips.push({audio:wordsByClip.get(wave),resolve})),finish:async()=>{},
    })},
  });
  const speech=createSpeechStream('ada',1,'pcm-NG',new AbortController().signal,()=>{},text=>spoken.push(text),true);
  speech.enqueue('I hear you.'); speech.enqueue('Take your time.'); await tick();
  assert.deepEqual(clips.map(item=>item.audio),['I hear you. first']);
  finishPhrase.shift()(); await tick();
  assert.deepEqual(clips.map(item=>item.audio),['I hear you. first','I hear you. last','Take your time. first']);
  assert.deepEqual(spoken,[]);
  clips[0].resolve(); clips[1].resolve(); await tick(); assert.deepEqual(spoken,['I hear you.']);
  finishPhrase.shift()(); await tick(); clips.slice(2).forEach(item=>item.resolve()); await speech.finish();
  assert.deepEqual(spoken,['I hear you.','Take your time.']);
});

test('a slow completed phrase plays while the next buffers and interruption discards pending audio', async () => {
  const wave = Buffer.alloc(44 + 4800).toString('base64');
  for (const interrupt of [false, true]) {
    const controller = new AbortController();
    const heard = [], credited = [];
    let finishSecond;
    const { createSpeechStream } = loadJS('src/lib/streaming-speech.js', {
      '@/lib/api': {streamSpeechAudio: async (_token, text, _style, _rate, _lang, _signal, chunk) => {
        chunk(wave);
        if (text === 'Two.') await new Promise(resolve => { finishSecond = resolve; });
      }},
      '@/lib/session': {readSession: async () => ({token:'a'})},
      '@/lib/spoken-text': {spokenText: text => text},
      '@/lib/voice-playback': {createVoiceQueue: () => ({
        enqueue: async audio => { heard.push(audio); }, finish: async () => {},
      })},
    });
    const speech = createSpeechStream('ada',1,'en-NG',controller.signal,() => {}, text => credited.push(text),true);
    speech.enqueue('One.'); speech.enqueue('Two.'); await tick();
    assert.deepEqual(credited, ['One.']);
    assert.equal(heard.length, 1);
    if (interrupt) controller.abort();
    finishSecond();
    await speech.finish();
    assert.equal(heard.length, interrupt ? 1 : 2);
    assert.deepEqual(credited, interrupt ? ['One.'] : ['One.', 'Two.']);
  }
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
  const { takeReadySpeech }=loadJS('src/lib/voice-audio.js',{'react-native':{Platform:{OS:'web'}},'expo-file-system':{}});
  const text=Array.from({length:80},(_,i)=>`word${i}`).join(' ');
  const first=takeReadySpeech(text);
  assert.equal(first.sentences.length,1);assert.ok(first.sentences[0].length<=56);
  assert.equal(first.sentences[0]+' '+first.remainder,text);
  assert.deepEqual(takeReadySpeech('Ada, tell me what happened.'), {sentences:['Ada,'], remainder:'tell me what happened.'});
});
