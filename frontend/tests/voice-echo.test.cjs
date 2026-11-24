const test=require('node:test');
const assert=require('node:assert/strict');
const {loadTS}=require('./helpers/load-ts.cjs');

function fixture(){
  const echo=loadTS('src/lib/voice-echo.ts');
  const samples=new Float32Array(32000);
  for(let i=0;i<samples.length;i++)samples[i]=.08*Math.sin(i*2*Math.PI*440/16000)+.03*Math.sin(i*2*Math.PI*700/16000);
  let position=.8;
  const stop=echo.preparePlaybackReference(samples,16000)(()=>position);
  const frame=(user=false)=>{
    const data=new ArrayBuffer(1600),view=new DataView(data);
    const start=Math.round((position-.05-.03)*16000);
    for(let i=0;i<800;i++)view.setInt16(i*2,Math.round(32768*(samples[start+i]+(user?.035*Math.sin(i*2*Math.PI*230/16000):0))),true);
    return {data,sampleRate:16000,channels:1};
  };
  return {...echo,frame,stop,advance:value=>{position+=value;}};
}

test('delayed speaker PCM is rejected without muting unrelated user speech',()=>{
  const f=fixture();
  const own=f.suppressPlaybackEcho(f.frame());
  assert.equal(own.voiceLevel,-140);assert.ok(new Uint8Array(own.data).every(value=>value===0));
  const user=f.suppressPlaybackEcho(f.frame(true));
  const view=new DataView(user.data);let energy=0;
  for(let i=0;i<800;i++){const value=view.getInt16(i*2,true)/32768;energy+=value*value;}
  assert.ok(Math.sqrt(energy/800)>.015,'Genuine double-talk remains available to the detector');
  assert.ok((user.voiceLevel??0)>-48);
  f.stop();f.advance(1);f.suppressPlaybackEcho({data:new ArrayBuffer(1600),sampleRate:16000,channels:1});
});

test('speaker-only PCM cannot start a turn, while speech over it triggers onset',()=>{
  const f=fixture();const {VoiceActivity}=loadTS('src/lib/voice-activity.ts');
  let began=0;
  const activity=new VoiceActivity(()=>began++,()=>{}, {onsetMs:120,silenceMs:1400});
  for(let i=0;i<6;i++){activity.feed(f.suppressPlaybackEcho(f.frame()));f.advance(.05);}
  assert.equal(began,0);
  for(let i=0;i<4;i++){activity.feed(f.suppressPlaybackEcho(f.frame(true)));f.advance(.05);}
  assert.equal(began,1);f.stop();
});

test('a weak far-end match cannot rewrite the consonants of an interruption',()=>{
  const f=fixture();
  const data=new ArrayBuffer(1600),view=new DataView(data);
  const base=new DataView(f.frame().data);
  for(let i=0;i<800;i++)view.setInt16(i*2,Math.round(base.getInt16(i*2,true)*.25+9000*Math.sin(i*2*Math.PI*230/16000)),true);
  const original=new Uint8Array(data).slice();
  const result=f.suppressPlaybackEcho({data,sampleRate:16000,channels:1});
  assert.deepEqual(new Uint8Array(result.data),original,'Uncertain correlation must leave genuine speech samples untouched');
  f.stop();
});

test('late worklet delivery aligns echo to capture time rather than callback time',()=>{
  const f=fixture();
  const frame=f.frame();
  const capturedAt=performance.now()/1000;
  f.advance(.85);
  const output=f.suppressPlaybackEcho({...frame,capturedAt:capturedAt-.85});
  assert.equal(output.voiceLevel,-140,'Queued microphone frames still match the original played samples');
  f.stop();
});
