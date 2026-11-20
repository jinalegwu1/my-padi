const test=require('node:test');
const assert=require('node:assert/strict');
const {loadTS}=require('./helpers/load-ts.cjs');
const activity=loadTS('src/lib/voice-activity.ts');
const {HandsfreeSession}=loadTS('src/lib/handsfree-session.ts',{'@/lib/voice-activity':activity});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const tick=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function frame(level=0,duration=50){const data=new ArrayBuffer(16000*duration/1000*2);const view=new DataView(data);for(let offset=0;offset<data.byteLength;offset+=2)view.setInt16(offset,Math.round(32767*level*(offset%4?1:-1)),true);return {data,sampleRate:16000,channels:1};}
function fixture(overrides={}){
  let feed,snapshot;const calls=[],delivered=[];
  const deps={
    readSession:async()=>({token:'token-a',user:{id:'a'}}),
    capture:callback=>{feed=callback;return {start:async()=>{calls.push('microphone');},stop:async()=>{calls.push('closed');}};},
    transcribe:async()=>{calls.push('transcribed');return 'Hello PADI';},
    send:async text=>{calls.push(['chat',text]);return {status:'sent',reply:'Hello! How are you?',messageID:'reply-1'};},
    speak:async (text,signal,start,completed)=>{calls.push('speech');start();completed('Hello!');completed('How are you?');},
    delivered:(...args)=>delivered.push(args),changed:next=>{snapshot=next;},...overrides,
  };
  return {session:new HandsfreeSession(deps),calls,delivered,get snapshot(){return snapshot;},voice:()=>{for(let i=0;i<8;i++)feed(frame(0.03));},quiet:()=>{for(let i=0;i<24;i++)feed(frame());},frame:value=>feed(value)};
}

test('hands-free voice automatically responds after speech ends and keeps listening',async()=>{
  const f=fixture();await f.session.start();
  for(let i=0;i<80;i++)f.frame(frame());await tick();assert.deepEqual(f.calls,['microphone']);
  f.voice();f.quiet();await tick();
  assert.equal(f.calls.filter(x=>Array.isArray(x)&&x[0]==='chat').length,1);
  assert.equal(f.snapshot.connected,true);assert.equal(f.snapshot.phase,'listening');
  assert.equal(f.snapshot.userText,'Hello PADI');
  await f.session.cancel();assert.ok(f.calls.includes('closed'));
});

test('starting to speak interrupts playback and records only fully delivered speech',async()=>{
  const playing=deferred();let stopped=false;
  const f=fixture({speak:async (_text,signal,start,completed)=>{start();completed('Hello!');start();signal.addEventListener('abort',()=>{stopped=true;playing.resolve();},{once:true});await playing.promise;}});
  await f.session.start();f.voice();f.quiet();await tick();assert.equal(f.snapshot.phase,'speaking');
  f.voice();await tick();assert.equal(stopped,true);assert.equal(f.snapshot.phase,'listening');
  assert.ok(f.delivered.some(([id,words,interrupted])=>id==='reply-1'&&words==='Hello!'&&interrupted));
  await f.session.cancel();
});

test('interrupting an in-flight AI request retains the prior user words for the next turn',async()=>{
  let sends=0;const pending=deferred();const received=[];
  const f=fixture({send:async (text,_id,signal)=>{received.push(text);if(++sends===1){signal.addEventListener('abort',()=>pending.resolve({status:'ignored'}),{once:true});return pending.promise;}return {status:'sent',reply:'Okay',messageID:'reply-2'};},speak:async()=>{}});
  await f.session.start();f.voice();f.quiet();await tick();assert.equal(f.snapshot.phase,'thinking');
  f.voice();await tick();f.quiet();await tick();
  assert.deepEqual(received,['Hello PADI','Hello PADI\nHello PADI']);
  await f.session.cancel();
});

test('account change discards queued speech and fences late transcription',async()=>{
  const pending=deferred();const f=fixture({transcribe:()=>pending.promise});
  await f.session.start();f.voice();f.quiet();await tick();
  await f.session.cancel(null,true);pending.resolve('Old private words');await tick();
  assert.equal(f.snapshot.userText,undefined);assert.equal(f.snapshot.padiText,'');
  assert.equal(f.calls.some(x=>Array.isArray(x)&&x[0]==='chat'),false);
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

test('connecting plays a greeting first and resumes without repeating it',async()=>{
  let greetings=0;
  const f=fixture({greet:async (_signal,text,start)=>{greetings++;text('Hey! How are you?');start();}});
  await f.session.start();await tick();
  assert.equal(greetings,1);assert.equal(f.snapshot.padiText,'Hey! How are you?');
  assert.equal(f.snapshot.connected,true);assert.equal(f.snapshot.phase,'listening');
  assert.equal(f.calls.some(x=>Array.isArray(x)&&x[0]==='chat'),false,'Greeting must not invent user input');
  await f.session.cancel();await f.session.start({greet:false});await tick();
  assert.equal(greetings,1);await f.session.cancel();
});

test('speaking interrupts the opening greeting and receives a real reply',async()=>{
  let interrupted=false;
  const greeting=deferred();
  const f=fixture({greet:async (signal,text,start)=>{
    text('How are you?');start();
    signal.addEventListener('abort',()=>{interrupted=true;greeting.resolve();},{once:true});
    await greeting.promise;
  }});
  await f.session.start();await tick();assert.equal(f.snapshot.phase,'speaking');
  f.voice();await tick();assert.equal(interrupted,true);
  f.quiet();await tick();
  assert.equal(f.snapshot.phase,'listening');
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
  await f.session.start();await tick();
  await f.session.reactToTouch();await tick();
  assert.equal(greetings,2);
  assert.equal(f.calls.filter(value=>value==='microphone').length,1);
  assert.equal(f.snapshot.connected,true);assert.equal(f.snapshot.phase,'listening');
  await f.session.cancel();
});
