const test=require('node:test');
const assert=require('node:assert/strict');
const {loadTS}=require('./helpers/load-ts.cjs');

test('natural voice preview uses the selected Python style and cleans cached audio on interruption',async()=>{
  let removed=0,released=0,started=0,callback,received;
  const player={addListener:(_name,fn)=>{callback=fn;return {remove(){}};},play(){callback({playing:true});},pause(){},release(){released++;}};
  const preview=loadTS('src/lib/voice-preview.ts',{
    'expo-audio':{createAudioPlayer:()=>player},
    'expo-file-system':{Paths:{cache:'cache'},File:class{exists=true;uri='file://preview.wav';create(){}write(value,options){assert.equal(value,'generated-audio');assert.equal(options.encoding,'base64');}delete(){removed++;}}},
    'react-native':{Platform:{OS:'android'}},
    '@/lib/api':{synthesiseSpeech:async(...args)=>{received=args;return {audio_base64:'generated-audio'};}},
    '@/lib/session':{readSession:async()=>({token:'test-token'})},
    '@/lib/voice-playback':{playVoice(){assert.fail('preview must not open native microphone playback');}},
  });
  const controller=new AbortController();
  const playing=preview.previewVoice('Hello','ada',1,controller.signal,()=>{started++;});
  for(let index=0;index<10;index++)await Promise.resolve();
  assert.equal(started,1);assert.equal(received[2],'ada');
  controller.abort();await playing;
  assert.equal(removed,1);assert.equal(released,1);
});
