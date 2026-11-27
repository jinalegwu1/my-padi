const test = require('node:test');
const assert = require('node:assert/strict');
const {createVoiceOutput} = require('../public/padi-chat/voice-output.js');
const {prepareVoicePackets, playbackPhrases} = require('../public/padi-chat/phrase-playback.js');

function wav(sample) {
  const data = Buffer.alloc(44 + 4800);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(24000, 24); data.writeUInt32LE(48000, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36);
  data.writeUInt32LE(data.length - 44, 40);
  for (let at = 44; at < data.length; at += 2) data.writeInt16LE(sample, at);
  return data.toString('base64');
}
function environment(t, blocked = false) {
  const nodes = [];
  const button = {hidden:true};
  const page = {documentElement:{dataset:{}},getElementById:()=>button};
  const original = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  let context, allow;
  class Audio {
    constructor() { context = this; this.currentTime = 2; this.sampleRate = 48000; this.state = 'suspended'; }
    async resume() {
      if (blocked) await new Promise(resolve => { allow = resolve; });
      this.state = 'running'; this.onstatechange?.();
    }
    async suspend() { this.state = 'suspended'; this.onstatechange?.(); }
    createBuffer(channels, size, rate) {
      const samples = new Float32Array(size);
      return {getChannelData:()=>samples,sampleRate:rate,duration:size/rate};
    }
    createBufferSource() {
      const node = {connect(){},disconnect(){},start(at){this.at = at;},stop(){this.stopped = true;}};
      nodes.push(node); return node;
    }
  }
  Object.defineProperty(globalThis,'AudioContext',{value:Audio,configurable:true});
  t.after(()=>{if(original)Object.defineProperty(globalThis,'AudioContext',original);else delete globalThis.AudioContext;});
  return {output:createVoiceOutput({document:page}), nodes, button, context:()=>context,
    enable(){blocked=false;allow?.();}};
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('one document audio clock plays ordered PCM and keeps queued packets paused until Resume',async t=>{
  const {output,nodes,context} = environment(t);
  await output.unlock();
  const turn = new AbortController(), player = output.queue(turn.signal,'ada');
  const done = [];
  const a=player.enqueue(wav(1234),undefined,()=>done.push('first'));
  await tick();
  await output.pause();
  const b=player.enqueue(wav(-5000),undefined,()=>done.push('second'));
  const finished=player.finish();
  await tick();
  assert.equal(context().state,'suspended');
  assert.equal(nodes.length,2);
  assert.equal(nodes[0].buffer.getChannelData(0)[0],1234/32768);
  assert.equal(nodes[1].buffer.getChannelData(0)[0],-5000/32768);
  assert.equal(nodes[1].at,nodes[0].at+nodes[0].buffer.duration);
  await output.resume();
  for(const node of nodes) node.onended();
  await Promise.all([a,b,finished]);
  assert.deepEqual(done,['first','second']);
});

test('a locked speaker offers a gesture and an interrupted reply never plays late',async t=>{
  const {output,button,nodes,enable} = environment(t,true);
  const turn=new AbortController(), player=output.queue(turn.signal,'ada');
  const part=player.enqueue(wav(80),()=>assert.fail('cancelled audio started'));
  await tick(); assert.equal(button.hidden,false);
  turn.abort(); await Promise.all([part,player.finish()]); enable(); await tick();
  assert.equal(nodes.length,0);assert.equal(button.hidden,true);
});

test('an explicit Enable sound gesture releases the pending reply once',async t=>{
  const {output,button,nodes,enable} = environment(t,true);
  const player=output.queue(new AbortController().signal,'ada');
  const heard=player.enqueue(wav(500));
  await tick(); assert.equal(button.hidden,false);
  enable();button.onclick();await tick();
  assert.equal(nodes.length,1);nodes[0].onended();await heard;await player.finish();
  assert.equal(button.hidden,true);
});

test('a replay uses only complete phrases for the same account and voice settings',async()=>{
  const live = new AbortController(), played=[];
  const emit=wave=>played.push(wave);
  const supply=async listener=>listener(wav(1));
  await prepareVoicePackets('A','voice-a/Hi',live.signal,supply,emit);
  await prepareVoicePackets('A','voice-a/Hi',live.signal,()=>assert.fail('re-synthesized'),emit);
  await prepareVoicePackets('B','voice-a/Hi',live.signal,async listener=>listener(wav(2)),emit);
  await assert.rejects(prepareVoicePackets('B','voice-b/Hi',live.signal,async listener=>{
    listener(wav(3));throw Error('disconnected');
  },emit));
  let retried=false;
  await prepareVoicePackets('B','voice-b/Hi',live.signal,async listener=>{retried=true;listener(wav(4));},emit);
  assert.ok(retried);
  assert.deepEqual(played,[wav(1),wav(1),wav(2),wav(3),wav(4)]);
});
test('short useful opening phrases preserve the full reply and stay below the speech endpoint limit',()=>{
  const text='Hello, James. How are you feeling today? I am here to listen.';
  const phrases=playbackPhrases(text);
  assert.equal(phrases[0],'Hello, James.');assert.equal(phrases.join(' '),text);
  assert.ok(playbackPhrases('a'.repeat(1800)).every(words=>words.length<=650));
});

test('a newer reply replaces previously scheduled document audio without crediting it',async t=>{
  const {output,nodes}=environment(t);
  await output.unlock();
  const prior=output.queue(new AbortController().signal,'ada');
  const heard=prior.enqueue(wav(1),undefined,()=>assert.fail('replaced clip counted as delivered'));
  await tick();
  const next=output.queue(new AbortController().signal,'ada');
  assert.equal(await heard,false);
  assert.equal(nodes[0].stopped,true);
  await prior.finish();
  const current=next.enqueue(wav(2));await tick();nodes[1].onended();
  assert.equal(await current,true);await next.finish();
});

test('the mobile host credits a phrase only after its own HTML player acknowledges playback',async()=>{
  const {loadTS}=require('./helpers/load-ts.cjs');
  const {createDocumentVoice}=loadTS('src/lib/document-voice.js',{
    '@/lib/session':{readSession:async()=>({token:'fixture',user:{id:'frame-owner'}})},
    '@/lib/api':{streamSpeechAudio:async(token,text,style,rate,language,signal,packet)=>{
      assert.equal(token,'fixture');assert.equal(style,'baby');packet(wav(2500));
    }},
    '@/lib/spoken-text':{spokenText:text=>text},
    '@/lib/voice-echo':{prepareWaveReference:()=>()=>()=>{}},
  });
  const output=createDocumentVoice(),commands=[],delivered=[];
  output.attach(p=>commands.push(p));
  const options={owner:'frame-owner',languageCode:'en-NG',voiceRate:1,streaming:true,echo:true};
  const signal=new AbortController();
  const speech=output.stream(options,signal.signal,()=>delivered.push('started'),text=>delivered.push(text));
  speech.enqueue('Good morning.');const finished=speech.finish();
  await tick();const packet=commands.find(p=>p.action==='clip');
  assert.ok(packet);assert.equal(commands.some(p=>JSON.stringify(p).includes('fixture')),false);
  output.receive({id:packet.id+1,clip:packet.clip,state:'ended'});assert.deepEqual(delivered,[]);
  output.receive({...packet,state:'playing'});output.receive({...packet,state:'ended'});
  await finished;assert.deepEqual(delivered,['started','Good morning.']);
  const aborted=output.stream(options,signal.signal,()=>{},()=>assert.fail('cancelled phrase credited'));
  aborted.enqueue('Good morning.');const stopped=aborted.finish();
  await tick();signal.abort();await stopped;
  assert.equal(commands.at(-1).action,'stop');output.detach();
});
