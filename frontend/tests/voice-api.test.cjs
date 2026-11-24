const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTS } = require('./helpers/load-ts.cjs');
const api = loadTS('src/lib/api.ts', { '@/lib/config': { API_URL: 'https://padi.test' } });

test('greeting metadata uses the existing text chat endpoint without altering ordinary sends', async () => {
  const previous = global.fetch;
  const bodies = [];
  global.fetch = async (url, request) => {
    assert.equal(url, 'https://padi.test/v1/chat');
    bodies.push(JSON.parse(request.body));
    return { ok: true, status: 200, text: async () => JSON.stringify({ reply: 'Hey!', memory_revision: 0 }) };
  };
  try {
    const messages = [{ role: 'user', content: 'Greet me briefly.' }];
    await api.sendChat('token', messages, 0, undefined, 'text', undefined, 'en-NG', true);
    await api.sendChat('token', messages, 0);
    assert.equal(bodies[0].greeting, true);
    assert.equal(Object.hasOwn(bodies[1], 'greeting'), false);
    assert.equal(bodies[0].delivery, 'text');
  } finally { global.fetch = previous; }
});

test('personal speech carries the selected voice, pace and Pidgin language behind authentication', async () => {
  const previous = global.fetch;
  global.fetch = async (url, request) => {
    assert.equal(url, 'https://padi.test/v1/voice/speak');
    assert.equal(request.headers.Authorization, 'Bearer test-token');
    assert.deepEqual(JSON.parse(request.body), { text: 'How you dey?', style: 'tunde', rate: 1.15, language: 'pcm-NG' });
    return { ok: true, status: 200, text: async () => JSON.stringify({ audio_base64: 'generated-audio', mime_type: 'audio/wav' }) };
  };
  try { await api.synthesiseSpeech('test-token', 'How you dey?', 'tunde', 1.15, new AbortController().signal, 'pcm-NG'); }
  finally { global.fetch = previous; }
});

test('voice upload sends authenticated multipart without overriding the boundary', async () => {
  const previous = global.fetch;
  const form = new FormData();
  form.append('audio', new Blob(['RIFF0000WAVEdata']), 'recording.wav');
  global.fetch = async (url, request) => {
    assert.equal(url, 'https://padi.test/v1/voice/transcribe');
    assert.equal(request.body, form);
    assert.equal(request.headers.Authorization, 'Bearer test-token');
    assert.equal(request.headers['Content-Type'], undefined);
    return { ok: true, status: 200, text: async () => JSON.stringify({ text: ' Hello PADI ' }) };
  };
  try { assert.equal(await api.transcribeAudio('test-token', form, new AbortController().signal), 'Hello PADI'); }
  finally { global.fetch = previous; }
});

test('external cancellation aborts both transcription and chat requests', async () => {
  const previous = global.fetch;
  global.fetch = async (_url, request) => new Promise((_resolve, reject) => {
    const aborted = () => reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' }));
    request.signal.addEventListener('abort', aborted, { once: true });
    if (request.signal.aborted) aborted();
  });
  try {
    for (const send of [signal => api.transcribeAudio('token', new FormData(), signal),
      signal => api.sendChat('token', [{ role: 'user', content: 'Hello' }], 0, signal)]) {
      const controller = new AbortController();
      const request = send(controller.signal);
      controller.abort();
      await assert.rejects(request, { name: 'AbortError', message: 'Cancelled' });
    }
  } finally { global.fetch = previous; }
});

test('live speech remains compatible with existing servers and enables routing only when advertised',async()=>{
  const previous=global.fetch;
  let supported=false;
  let body;
  global.fetch=async (url,request)=>{
    const value=url.endsWith('/v1/voice/config')?{enabled:true,max_seconds:60,natural_speech:true,...(supported?{live_speech:true}:{})}:{audio_base64:'generated',mime_type:'audio/wav'};
    if(url.endsWith('/v1/voice/speak'))body=JSON.parse(request.body);
    return {ok:true,status:200,text:async()=>JSON.stringify(value)};
  };
  try {
    await api.getVoiceConfiguration();
    await api.synthesiseSpeech('token','Hello','ada',1,new AbortController().signal,'en-NG',true);
    assert.equal(body.live,undefined);
    supported=true;await api.getVoiceConfiguration();
    await api.synthesiseSpeech('token','Hello','ada',1,new AbortController().signal,'en-NG',true);
    assert.equal(body.live,true);
  } finally {global.fetch=previous;}
});

test('voice chat sends authenticated Groq-stream request and exposes deltas before completion',async()=>{
  const previous=global.XMLHttpRequest;
  const chunks=[
    'event: delta\ndata: {"text":"Hello "}\n\n',
    'event: delta\ndata: {"text":"there."}\n\n',
    'event: done\ndata: {"reply":"Hello there.","memory_revision":7}\n\n',
  ];
  let request;
  global.XMLHttpRequest=class {
    responseText='';status=0;timeout=0;headers={};
    open(method,url){this.method=method;this.url=url;}
    setRequestHeader(name,value){this.headers[name]=value;}
    getResponseHeader(){return 'text/event-stream; charset=utf-8';}
    send(body){
      this.body=JSON.parse(body);request=this;
      for(const chunk of chunks){this.responseText+=chunk;this.onprogress();}
      this.status=200;this.onload();
    }
    abort(){this.onabort?.();}
  };
  const received=[];
  try {
    const result=await api.streamVoiceChat('session-token',[{role:'user',content:'Hello'}],7,new AbortController().signal,text=>received.push(text));
    assert.equal(request.url,'https://padi.test/v1/chat');
    assert.equal(request.method,'POST');
    assert.equal(request.headers.Authorization,'Bearer session-token');
    assert.equal(request.body.delivery,'voice');assert.equal(request.body.stream,true);
    assert.deepEqual(received,['Hello ','there.']);
    assert.deepEqual(result,{reply:'Hello there.',memory_revision:7});
    assert.equal(Object.hasOwn(request.body,'greeting'),false);
    await api.streamVoiceChat('session-token',[{role:'user',content:'Greet me briefly.'}],7,new AbortController().signal,()=>{},undefined,'en-NG',true);
    assert.equal(request.body.greeting,true);
  } finally {global.XMLHttpRequest=previous;}
});

test('selected voice language travels to transcription, chat and previews when supported',async()=>{
  const previous=global.fetch;
  let supported=false;
  const calls=[];
  global.fetch=async(url,request)=>{
    calls.push({url,request});
    const value=url.endsWith('/v1/voice/config')?{enabled:true,max_seconds:60,natural_speech:true,language_selection:supported}
      :url.includes('/voice/preview')?{audio_base64:'audio',mime_type:'audio/wav',text:'Hello'}
      :url.includes('/voice/transcribe')?{text:'Hello'}:{reply:'Hello',memory_revision:0};
    return {ok:true,status:200,text:async()=>JSON.stringify(value)};
  };
  try {
    await api.getVoiceConfiguration();
    await api.sendChat('token',[{role:'user',content:'Bonjour'}],0,undefined,'voice',undefined,'en-GB');
    assert.equal(JSON.parse(calls.at(-1).request.body).language,undefined,'Older servers keep their request format');
    supported=true;await api.getVoiceConfiguration();
    const form=new FormData();
    await api.transcribeAudio('token',form,new AbortController().signal,'en-GB');
    assert.equal(calls.at(-1).url,'https://padi.test/v1/voice/transcribe?language=en-GB');
    assert.equal(calls.at(-1).request.body,form);
    await api.sendChat('token',[{role:'user',content:'Bonjour'}],0,undefined,'voice',undefined,'en-GB');
    assert.equal(JSON.parse(calls.at(-1).request.body).language,'en-GB');
    await api.fetchVoiceSample('preview','tunde','en-GB',1,new AbortController().signal);
    assert.ok(calls.at(-1).url.endsWith('&language=en-GB'));
    supported=false;await api.getVoiceConfiguration();
  }finally{global.fetch=previous;}
});
