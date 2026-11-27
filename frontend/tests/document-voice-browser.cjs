// Exercise the actual offline HTML that ships inside the mobile WebView.
const {readFileSync} = require('node:fs');
const {resolve} = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require('playwright-core');

async function verify() {
  const root = resolve(__dirname, '../..');
  const recording = readFileSync(resolve(root, 'docs/voice-samples/signature/greeting.wav'));
  const wave = Buffer.from(recording.subarray(0, 44 + 24000));
  wave.writeUInt32LE(wave.length - 8, 4);
  wave.writeUInt32LE(wave.length - 44, 40);
  const packet = wave.toString('base64');
  const browser = await chromium.launch({headless:true, executablePath:process.env.PADI_VOICE_BROWSER_EXECUTABLE || '/usr/bin/google-chrome'});
  try {
    const page = await browser.newPage();
    const errors=[]; page.on('pageerror', error=>errors.push(error.message));
    await page.evaluate(()=>{
      window.events=[]; window.scheduled=[];
      window.ReactNativeWebView={postMessage:raw=>window.events.push(JSON.parse(raw))};
      const start=AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start=function(at,...args) {
        window.scheduled.push({at,length:this.buffer.duration});
        if(!window.meter) window.meter=this.context.createAnalyser();
        this.connect(window.meter);
        return start.call(this,at,...args);
      };
    });
    await page.setContent(readFileSync(resolve(root,'frontend/chat-web/generated/chat.html'),'utf8'));
    await page.waitForFunction(()=>typeof window.padiFrameAudio==='function');
    await page.evaluate(wave=>{
      window.padiFrameAudio({id:1,action:'begin'});
      for(const clip of [1,2]) window.padiFrameAudio({id:1,action:'clip',clip,wave});
      window.padiFrameAudio({id:1,action:'finish'});
    }, packet);
    await page.locator('#enable-voice-audio').evaluate(el=>{el.hidden=false;});
    await page.locator('#enable-voice-audio').click();
    await page.waitForFunction(()=>{
      if(!window.meter) return false;
      const pcm=new Float32Array(window.meter.fftSize);
      window.meter.getFloatTimeDomainData(pcm);
      return pcm.some(value=>Math.abs(value)>.01);
    });
    await page.waitForFunction(()=>window.events.filter(e=>e.value?.state==='ended').length===2);
    const {events,scheduled}=await page.evaluate(()=>({events:window.events,scheduled:window.scheduled}));
    assert.equal(scheduled.length,2);
    assert.ok(Math.abs(scheduled[1].at-scheduled[0].at-scheduled[0].length)<.0001);
    assert.deepEqual(events.filter(e=>e.action==='audioEvent').map(e=>[e.value.clip,e.value.state]),
      [[1,'playing'],[1,'ended'],[2,'playing'],[2,'ended']]);
    await page.evaluate(wave=>{
      window.padiFrameAudio({id:2,action:'begin'});
      window.padiFrameAudio({id:2,action:'clip',clip:1,wave});
    },packet);
    await page.waitForFunction(()=>window.events.some(e=>e.value?.id===2&&e.value.state==='playing'));
    await page.evaluate(()=>window.padiFrameAudio({id:2,action:'stop'}));
    await page.waitForFunction(()=>document.documentElement.dataset.voiceOutput==='idle');
    assert.equal(await page.evaluate(()=>window.events.some(e=>e.value?.id===2&&e.value.state==='ended')),false);
    assert.deepEqual(errors,[]);
    console.log('PASS bundled WebView HTML unlock, non-silent Web Audio, contiguous clips, ordered acknowledgements and interruption.');
  } finally { await browser.close(); }
}
verify().catch(error=>{console.error(error.message);process.exitCode=1;});
