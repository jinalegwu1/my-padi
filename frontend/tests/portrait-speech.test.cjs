const test=require('node:test');
const assert=require('node:assert/strict');
const {loadTS}=require('./helpers/load-ts.cjs');
const {speechEnvelope,portraitSpeech,subscribePortraitSpeech}=loadTS('src/lib/portrait-speech.ts');
const {wavAudio}=loadTS('src/lib/voice-activity.ts');

test('mouth energy follows voiced PCM, stays closed for silence, and stops at the clip end',()=>{
  const pcm=new Uint8Array(16000*2);
  const view=new DataView(pcm.buffer);
  for(let sample=4000;sample<12000;sample++)view.setInt16(sample*2,sample%2?9000:-9000,true);
  const wave=wavAudio({pcm,sampleRate:16000});
  const envelope=speechEnvelope(Buffer.from(wave).toString('base64'));
  assert.equal(envelope.levelAt(.1),0);
  assert.ok(envelope.levelAt(.5)>.8);
  assert.equal(envelope.levelAt(.9),0);
  assert.equal(envelope.levelAt(1),0);
  assert.equal(envelope.levelAt(NaN),0);
});

test('a cancelled older clip cannot clear the face speaking the new reply',()=>{
  let latest;
  const close=subscribePortraitSpeech(value=>{latest=value;});
  const old=portraitSpeech('ada');old.report(.8);
  const next=portraitSpeech('chidi');next.report(.6);
  old.stop();
  assert.equal(latest.voiceId,'chidi');assert.equal(latest.level,.6);
  next.stop();assert.equal(latest.voiceId,null);assert.equal(latest.level,0);
  close();
});
