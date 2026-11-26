const test=require('node:test');
const assert=require('node:assert/strict');
const {loadTS}=require('./helpers/load-ts.cjs');
const activity=loadTS('src/lib/voice-activity.ts');
const voiceAudio=loadTS('src/lib/voice-audio.ts',{'react-native':{Platform:{OS:'web'}},'expo-file-system':{}});
const {HandsfreeSession}=loadTS('src/lib/handsfree-session.ts',{'@/lib/voice-activity':activity,'@/lib/voice-audio':voiceAudio});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const tick=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const settle=async()=>{await tick();await new Promise(resolve=>setTimeout(resolve,400));await tick();};
function frame(level=0,duration=50){const data=new ArrayBuffer(16000*duration/1000*2);const view=new DataView(data);for(let offset=0;offset<data.byteLength;offset+=2)view.setInt16(offset,Math.round(32767*level*(offset%4?1:-1)),true);return {data,sampleRate:16000,channels:1};}
function fixture(overrides={}){
  let feed,snapshot;const calls=[],delivered=[];
  const deps={
    readSession:async()=>({token:'token-a',user:{id:'a'}}),
    capture:callback=>{feed=callback;return {start:async()=>{calls.push('microphone');},stop:async()=>{calls.push('closed');}};},
    transcribe:async()=>{calls.push('transcribed');return 'Hello PADI.';},
    send:async (text,_id,_signal,onDelta,onStart)=>{calls.push(['chat',text]);onStart?.('reply-1');onDelta?.('Hello! ');onDelta?.('How are you?');return {status:'sent',reply:'Hello! How are you?',messageID:'reply-1'};},
    speak:async (text,signal,start,completed)=>{calls.push('speech');start();completed(text);},
    delivered:(...args)=>delivered.push(args),changed:next=>{snapshot=next;},...overrides,
  };
  return {session:new HandsfreeSession(deps),calls,delivered,get snapshot(){return snapshot;},voice:()=>{for(let i=0;i<8;i++)feed(frame(0.03));},echo:()=>{for(let i=0;i<8;i++)feed({...frame(),voiceLevel:-140});},quiet:()=>{for(let i=0;i<32;i++)feed(frame());},frame:value=>feed(value)};
}

test('hands-free voice automatically responds after speech ends and keeps listening',async()=>{
  const f=fixture();await f.session.start();
  for(let i=0;i<80;i++)f.frame(frame());await tick();assert.deepEqual(f.calls,['microphone']);
  f.voice();f.quiet();await settle();
  assert.equal(f.calls.filter(x=>Array.isArray(x)&&x[0]==='chat').length,1);
  assert.equal(f.snapshot.connected,true);assert.equal(f.snapshot.phase,'listening');
  assert.equal(f.snapshot.userText,'Hello PADI.');
  await f.session.cancel();assert.ok(f.calls.includes('closed'));
});

test('silence sends unpunctuated speech immediately and the next turn reuses the microphone',async()=>{
  const transcripts=['Can you help me','Thanks'];let index=0;
  const f=fixture({transcribe:async()=>transcripts[index++]});
  await f.session.start();f.voice();
  for(let i=0;i<14;i++)f.frame(frame());await tick();
  assert.equal(index,0,'A brief pause is still the same turn');
  for(let i=0;i<14;i++)f.frame(frame());await tick();
  assert.deepEqual(f.calls.filter(value=>Array.isArray(value)),[['chat','Can you help me']]);
  await settle();
  f.voice();f.quiet();await settle();
  assert.deepEqual(f.calls.filter(value=>Array.isArray(value)),[['chat','Can you help me'],['chat','Thanks']]);
  assert.equal(f.calls.filter(value=>value==='microphone').length,1);
  assert.equal(f.snapshot.phase,'listening');assert.equal(f.snapshot.connected,true);
  await f.session.cancel();
});

test('ambiguous bare Start cannot restart speech and explicit end stops capture',async()=>{
  const words=['Start.','Can we discuss dinner?','End voice mode.'];let index=0;
  const f=fixture({transcribe:async()=>words[index++]});
  await f.session.start();f.voice();f.quiet();await settle();
  assert.equal(f.calls.filter(Array.isArray).length,0);
  assert.match(f.snapshot.error,/say what you would like to start/);
  assert.equal(f.snapshot.connected,true);
  f.voice();f.quiet();await settle();
  assert.equal(f.calls.filter(Array.isArray).length,1);
  f.voice();f.quiet();await settle();
  assert.equal(f.snapshot.connected,false);assert.ok(f.calls.includes('closed'));
});

test('completed Groq response sentences are spoken before later text arrives',async()=>{
  const firstPlayed=deferred(),continueStream=deferred();const spoken=[];
  const f=fixture({
    send:async(_text,_id,_signal,onDelta,onStart)=>{
      onStart('reply-1');onDelta('First sentence. ');onDelta('Unfinished');
      await continueStream.promise;
      onDelta(' sentence.');
      return {status:'sent',reply:'First sentence. Unfinished sentence.',messageID:'reply-1'};
    },
    speak:async(text,_signal,start,completed)=>{spoken.push(text);start();completed(text);firstPlayed.resolve();},
  });
  await f.session.start();f.voice();f.quiet();await tick();
  await firstPlayed.promise;
  assert.deepEqual(spoken,['First sentence.']);
  assert.equal(f.snapshot.padiText,'First sentence. Unfinished');
  continueStream.resolve();await settle();
  assert.deepEqual(spoken,['First sentence.','Unfinished sentence.']);
  assert.equal(f.snapshot.phase,'listening');
  await f.session.cancel();
});

test('echo is ignored but genuine speech immediately stops playback and queued speech',async()=>{
  const playing=deferred();let stopped=false;
  const f=fixture({speak:async (text,signal,start,completed)=>{start();signal.addEventListener('abort',()=>{stopped=true;playing.resolve();},{once:true});await playing.promise;completed(text);}});
  await f.session.start();f.voice();f.quiet();await tick();assert.equal(f.snapshot.phase,'speaking');
  f.echo();f.quiet();await tick();assert.equal(stopped,false);assert.equal(f.snapshot.phase,'speaking');
  assert.equal(f.calls.filter(value=>value==='transcribed').length,1);
  f.voice();await tick();assert.equal(stopped,true);assert.equal(f.snapshot.phase,'listening');
  assert.equal(f.calls.filter(value=>value==='transcribed').length,1,'Interruption does not prematurely upload a partial thought');
  f.quiet();await settle();
  assert.equal(f.calls.filter(value=>Array.isArray(value)).length,2,'The completed new user turn gets a response');
  await f.session.cancel();
});

test('new user speech cancels an in-flight response and replaces unsent words',async()=>{
  const pending=deferred();const received=[];
  const f=fixture({send:async (text,_id,signal)=>{received.push(text);if(received.length===1){signal.addEventListener('abort',()=>pending.resolve({status:'ignored'}),{once:true});return pending.promise;}return {status:'sent',reply:'New answer.'};},speak:async()=>{}});
  await f.session.start();f.voice();f.quiet();await tick();assert.equal(f.snapshot.phase,'thinking');
  f.voice();await tick();f.quiet();await tick();
  assert.deepEqual(received,['Hello PADI.','Hello PADI.']);
  assert.equal(f.snapshot.phase,'listening');
  await f.session.cancel();
});

test('account change discards queued speech and fences late transcription',async()=>{
  const pending=deferred();const f=fixture({transcribe:()=>pending.promise});
  await f.session.start();f.voice();f.quiet();await tick();
  await f.session.cancel(null,true);pending.resolve('Old private words');await tick();
  assert.equal(f.snapshot.userText,undefined);assert.equal(f.snapshot.padiText,'');
  assert.equal(f.calls.some(x=>Array.isArray(x)&&x[0]==='chat'),false);
});

test('wake mode only activates for PADI at the start and strips the wake phrase',async()=>{
  const transcripts=['I am PADI, I am not going to be a fan','Hey PADI hello.','PADI how are you?'];
  let index=0;
  const f=fixture({transcribe:async()=>transcripts[index++]});
  await f.session.start({greet:false,wake:true});
  f.voice();f.quiet();await tick();
  assert.equal(f.calls.filter(x=>Array.isArray(x)&&x[0]==='chat').length,0);
  f.voice();f.quiet();await tick();
  assert.deepEqual(f.calls.filter(x=>Array.isArray(x)&&x[0]==='chat'),[['chat','hello.']]);
  await settle();f.voice();f.quiet();await settle();
  assert.deepEqual(f.calls.filter(x=>Array.isArray(x)&&x[0]==='chat'),[['chat','hello.'],['chat','how are you?']]);
  await f.session.cancel();
});

test('voice activity ignores clicks and creates correctly framed WAV speech',()=>{
  let starts=0,utterance;const detector=new activity.VoiceActivity(()=>{starts++;},audio=>{utterance=audio;});
  detector.feed(frame(0.1,50));for(let i=0;i<30;i++)detector.feed(frame());assert.equal(starts,0);
  for(let i=0;i<8;i++)detector.feed(frame(0.04));for(let i=0;i<24;i++)detector.feed(frame());
  assert.equal(starts,1);assert.ok(utterance.pcm.length>0);
  const wav=activity.wavAudio(utterance);assert.equal(Buffer.from(wav.subarray(0,4)).toString(),'RIFF');assert.equal(new DataView(wav.buffer).getUint32(24,true),16000);
});

test('expired transcription credentials stop the microphone and clear private captions',async()=>{
  const f=fixture({transcribe:async()=>{throw Object.assign(new Error('Expired'),{status:401});}});
  await f.session.start();f.voice();f.quiet();await tick();
  assert.equal(f.snapshot.connected,false);assert.equal(f.snapshot.userText,undefined);assert.ok(f.calls.includes('closed'));
});

test('chat opening plays while microphone permission is pending and survives denial', async () => {
  let deny;
  const permission = new Promise((_resolve, reject) => { deny = reject; });
  const spoken = deferred();
  const f = fixture({
    capture: () => ({ start: () => permission, stop: async () => {} }),
    greet: async (_signal, text, start) => { text('My padi!'); start(); await spoken.promise; },
  });
  const opening = f.session.start({ greetBeforeCapture: true });
  await tick();
  assert.equal(f.snapshot.phase, 'speaking');
  assert.equal(f.snapshot.connected, false);
  deny(new Error('Microphone permission denied'));
  await tick();
  assert.equal(f.snapshot.phase, 'speaking');
  spoken.resolve();
  await opening;
  assert.equal(f.snapshot.padiText, 'My padi!');
  assert.match(f.snapshot.error, /permission denied/);
});

test('each call greets before listening, including a resumed conversation',async()=>{
  let greetings=0;
  const f=fixture({greet:async (_signal,text,start)=>{greetings++;text('Hey! How are you?');start();}});
  await f.session.start();await settle();
  assert.equal(greetings,1);assert.equal(f.snapshot.padiText,'Hey! How are you?');
  assert.equal(f.snapshot.connected,true);assert.equal(f.snapshot.phase,'listening');
  assert.equal(f.calls.some(x=>Array.isArray(x)&&x[0]==='chat'),false,'Greeting must not invent user input');
  await f.session.cancel();await f.session.start();await settle();
  assert.equal(greetings,2);await f.session.cancel();
});

test('greeting echo is ignored and a user can interrupt the greeting',async()=>{
  let interrupted=false;
  const greeting=deferred();
  const f=fixture({greet:async (signal,text,start)=>{
    text('How are you?');start();
    signal.addEventListener('abort',()=>{interrupted=true;greeting.resolve();},{once:true});
    await greeting.promise;
  }});
  await f.session.start();await tick();assert.equal(f.snapshot.phase,'speaking');
  f.echo();f.quiet();await tick();assert.equal(interrupted,false);
  assert.equal(f.calls.includes('transcribed'),false);
  f.voice();await tick();assert.equal(interrupted,true);assert.equal(f.snapshot.phase,'listening');
  f.quiet();await settle();
  assert.equal(f.calls.filter(x=>Array.isArray(x)&&x[0]==='chat').length,1);
  await f.session.cancel();
});

test('a late greeting cannot play after ending or changing accounts',async()=>{
  const ready=deferred();
  const f=fixture({greet:async (_signal,text,start)=>{await ready.promise;text('Late greeting');start();}});
  await f.session.start();await tick();await f.session.cancel(null,true);
  ready.resolve();await tick();assert.equal(f.snapshot.connected,false);
  assert.equal(f.snapshot.padiText,'');assert.equal(f.snapshot.phase,'idle');
});

test('touching the active portrait speaks hello again without starting another microphone',async()=>{
  let greetings=0;
  const f=fixture({greet:async(_signal,text,start)=>{greetings++;text('Hi! Welcome back.');start();}});
  await f.session.start();await settle();
  await f.session.reactToTouch();await tick();
  assert.equal(greetings,2);
  assert.equal(f.calls.filter(value=>value==='microphone').length,1);
  assert.equal(f.snapshot.connected,true);assert.equal(f.snapshot.phase,'listening');
  await f.session.cancel();
});

test('permission denial shows a clear error, never greets, and can be retried',async()=>{
  let deny=true,greetings=0;
  const f=fixture({capture:()=>({start:async()=>{if(deny)throw new Error('Microphone permission was denied.');},stop:async()=>{}}),
    greet:async(_signal,text,start)=>{greetings++;text('Hi');start();}});
  await f.session.start();
  assert.match(f.snapshot.error,/permission was denied/);assert.equal(f.snapshot.connected,false);assert.equal(greetings,0);
  deny=false;await f.session.start();await settle();
  assert.equal(greetings,1);assert.equal(f.snapshot.phase,'listening');assert.equal(f.snapshot.error,null);
  await f.session.cancel();
});

test('a transcription failure returns to listening and the next utterance succeeds',async()=>{
  let attempt=0;
  const f=fixture({transcribe:async()=>{if(++attempt===1)throw new Error('Recognition unavailable');return 'Try again';}});
  await f.session.start();f.voice();f.quiet();await tick();
  assert.match(f.snapshot.error,/Recognition unavailable/);assert.equal(f.snapshot.phase,'listening');assert.equal(f.snapshot.connected,true);
  assert.equal(f.calls.some(value=>Array.isArray(value)),false);
  f.voice();f.quiet();await settle();assert.equal(attempt,2);assert.equal(f.snapshot.error,null);
  assert.equal(f.snapshot.phase,'listening');await f.session.cancel();
});

test('empty recognition and silence keep listening without inventing a conversation turn',async()=>{
  const f=fixture({transcribe:async()=>''});await f.session.start();f.voice();f.quiet();await tick();
  assert.equal(f.snapshot.phase,'listening');assert.equal(f.snapshot.connected,true);
  for(let i=0;i<2000;i++)f.frame(frame());await tick();
  assert.equal(f.calls.some(value=>Array.isArray(value)),false);assert.equal(f.calls.includes('closed'),false);
  await f.session.cancel();
});

test('a stream failure stops queued speech before returning to listening',async()=>{
  const failed=deferred(),playing=deferred();let stopped=false;
  const f=fixture({send:async(_text,_id,_signal,delta)=>{delta('First sentence. ');await failed.promise;throw new Error('Stream failed');},
    speak:async(_text,signal,start)=>{start();signal.addEventListener('abort',()=>{stopped=true;playing.resolve();},{once:true});await playing.promise;}});
  await f.session.start();f.voice();f.quiet();await tick();assert.equal(f.snapshot.phase,'speaking');
  failed.resolve();await tick();assert.equal(stopped,true);
  f.echo();f.quiet();await tick();assert.equal(f.calls.filter(value=>value==='transcribed').length,1);
  await settle();assert.match(f.snapshot.error,/Stream failed/);assert.equal(f.snapshot.phase,'listening');
  await f.session.cancel();
});

test('a 700 ms pause and continuation produce one complete user turn',async()=>{
  let uploaded;
  const f=fixture({transcribe:async(_token,wav)=>{uploaded=wav;return 'Please help me plan dinner tomorrow.';}});
  await f.session.start();f.voice();for(let i=0;i<14;i++)f.frame(frame());await tick();
  assert.equal(uploaded,undefined);
  f.voice();for(let i=0;i<26;i++)f.frame(frame());await tick();assert.equal(uploaded,undefined);
  for(let i=0;i<2;i++)f.frame(frame());await tick();
  assert.ok(uploaded.length>=44+2900/1000*32000);
  assert.deepEqual(f.calls.filter(value=>Array.isArray(value)),[['chat','Please help me plan dinner tomorrow.']]);
  await f.session.cancel();
});

test('Stop interrupts repeatedly without restarting old queued audio',async()=>{
  let transcript=0,speaking=0;
  const f=fixture({transcribe:async()=>++transcript%2?'A new question.':'Stop.',
    speak:async(_text,signal,start)=>{speaking++;start();await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));}});
  await f.session.start();
  for(let i=0;i<3;i++){
    f.voice();f.quiet();await tick();assert.equal(f.snapshot.phase,'speaking');
    f.voice();await tick();assert.equal(f.snapshot.phase,'listening');
    f.quiet();await tick();assert.equal(f.snapshot.userText,'Stop.');assert.equal(f.snapshot.phase,'listening');
    assert.equal(speaking,i+1,'Cancelled queued sentences must never start');
  }
  assert.equal(f.calls.filter(value=>Array.isArray(value)).length,3,'Stop is handled without another AI request');
  await f.session.cancel();
});

test('leaving during playback stops speech and capture and fences late callbacks',async()=>{
  const playing=deferred();let stopped=false;
  const f=fixture({speak:async(text,signal,start,completed)=>{start();signal.addEventListener('abort',()=>{stopped=true;playing.resolve();},{once:true});await playing.promise;completed(text);start();}});
  await f.session.start();f.voice();f.quiet();await tick();
  await f.session.cancel();await tick();assert.equal(stopped,true);assert.equal(f.snapshot.phase,'idle');assert.equal(f.snapshot.connected,false);
  assert.ok(f.calls.includes('closed'));
  assert.equal(f.delivered.some(([_id,text,interrupted])=>!!text&&!interrupted),false);
});
