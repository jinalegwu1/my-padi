const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTS } = require('./helpers/load-ts.cjs');
const api = loadTS('src/lib/api.ts', { '@/lib/config': { API_URL: 'https://padi.test' } });

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
