const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTS } = require('./helpers/load-ts.cjs');
const speechMotion=loadTS('src/lib/portrait-speech.ts');

test('one tap unlocks subsequent audio replies and interruption stops the current source',async()=>{
  const original=global.AudioContext;
  const contexts=[], sources=[];
  global.AudioContext=class {
    state='suspended';destination={};
    constructor(){contexts.push(this);}
    async resume(){this.state='running';}
    async decodeAudioData(){return {};}
    createBufferSource(){
      const source={connect(){},disconnect(){this.disconnected=true;},start(){this.started=true;},stop(){this.stopped=true;this.onended?.();}};
      sources.push(source);return source;
    }
  };
  try {
    const {playVoice,unlockVoicePlayback}=loadTS('src/lib/voice-playback.web.ts',{'@/lib/portrait-speech':speechMotion});
    await unlockVoicePlayback();
    let started=0;
    const controller=new AbortController();
    const playing=playVoice('AAAA',controller.signal,()=>started++);
    await new Promise(setImmediate);
    assert.equal(started,1);assert.equal(contexts.length,1);
    controller.abort();await playing;
    assert.equal(sources[0].stopped,true);assert.equal(sources[0].disconnected,true);
    const next=playVoice('AAAA',new AbortController().signal,()=>started++);
    await new Promise(setImmediate);sources[1].onended();await next;
    assert.equal(started,2);assert.equal(contexts.length,1);
  } finally {global.AudioContext=original;}
});

test('cancelled decoding never starts a stale audio reply',async()=>{
  const original=global.AudioContext;
  let decode,played=false;
  global.AudioContext=class {
    state='running';
    decodeAudioData(){return new Promise(resolve=>{decode=resolve;});}
    createBufferSource(){played=true;throw new Error('Must not play stale audio');}
  };
  try {
    const {playVoice}=loadTS('src/lib/voice-playback.web.ts',{'@/lib/portrait-speech':speechMotion});
    const controller=new AbortController();
    const promise=playVoice('AAAA',controller.signal,()=>assert.fail('Cancelled audio started'));
    await new Promise(setImmediate);controller.abort();decode({});await promise;
    assert.equal(played,false);
  } finally {global.AudioContext=original;}
});
