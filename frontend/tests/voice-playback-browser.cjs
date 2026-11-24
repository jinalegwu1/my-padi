// Focused real-app playback measurement. Recognition uses a public fixture;
// greetings, Groq conversation, and reply TTS use the actual services.
const assert = require('node:assert/strict');
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { createServer } = require('node:http');
const { chromium } = require('playwright-core');

exports.verify = async (mode, sessionFile) => {
  const frontend = process.env.PADI_VOICE_FRONTEND_URL || 'http://localhost:8081';
  const session = JSON.parse(readFileSync(sessionFile, 'utf8'));
  const audio = readFileSync(join(__dirname, 'fixtures/please-continue.wav')).toString('base64');
  const folder = join(tmpdir(), `my-padi-playback-${mode}`);
  mkdirSync(folder, { recursive: true });
  const progress=stage=>writeFileSync(join(folder,'progress.json'),JSON.stringify({stage,at:Date.now()}));
  progress('launching browser');
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-fake-device-for-media-stream'] });
  let page;
  let slowServer;
  try {
    const context = await browser.newContext({ viewport: { width: 430, height: 900 } });
    await context.grantPermissions(['microphone'], { origin: frontend });
    await context.addInitScript(({ session }) => {
      sessionStorage.setItem('padi.auth.session.v1', JSON.stringify(session));
      localStorage.setItem('app:v1:preferences', JSON.stringify({ onboarded: true, voiceId: 'ada', voiceRate: 1,
        languageCode: 'en-NG', countryCode: 'NG', appearance: 'light', reduceMotion: true, wakeWordEnabled: false,
        notificationsEnabled: false, dailyCheckIn: false, textScale: 1, displayName:'Playback check',
        checkInTime:'08:00',showVoiceTranscript:false }));
      localStorage.setItem('app:v1:chat-messages', '[]');
      const audit = window.__playback = { requests: [], clips: [], deltas: [], contexts: [], tracks: [], recording: false };
      const Context = window.AudioContext;
      window.AudioContext = class extends Context {
        constructor(...args) {
          super(...args); audit.contexts.push(this);
        }
      };
      navigator.mediaDevices.getUserMedia = async constraints => {
        // Playback is the focus of this check. Supply deterministic public
        // microphone audio; hardware permission gates have separate coverage.
        const input = new Context({ sampleRate: 48000 });
        const destination = input.createMediaStreamDestination(); await input.resume();
        audit.input = input; audit.destination = destination;
        audit.tracks.push(...destination.stream.getTracks());
        destination.stream.getTracks().forEach(track => {
          const stop = track.stop.bind(track);
          track.stop = () => { stop(); void input.close(); };
        });
        return destination.stream;
      };
      audit.say = async encoded => {
        const buffer = await audit.input.decodeAudioData(Uint8Array.from(atob(encoded), c => c.charCodeAt(0)).buffer);
        const source = audit.input.createBufferSource(); source.buffer = buffer; source.connect(audit.destination);
        await new Promise(resolve => { source.onended = resolve; source.start(); });
      };
      const fetch = window.fetch;
      window.fetch = async (...args) => {
        if (!String(args[0]).includes('/v1/voice/speak')) return fetch(...args);
        const request = { text: JSON.parse(args[1].body).text, body: JSON.parse(args[1].body), at: Date.now() };
        audit.requests.push(request);
        const result = await fetch(...args);
        request.headersAt = Date.now();
        const text = result.text.bind(result);
        result.text = async () => { const raw = await text(); const body=JSON.parse(raw);
          request.readyAt = Date.now(); request.status = result.status;
          request.audio = body.audio_base64; return raw; };
        return result;
      };
      const open = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (method, url, ...args) {
        if (String(url).endsWith('/v1/chat')) {
          let offset = 0, pending = '';
          const progress = () => {
            pending += this.responseText.slice(offset); offset = this.responseText.length;
            const blocks = pending.split(/\r?\n\r?\n/); pending = blocks.pop();
            for (const block of blocks) {
              const event = block.match(/^event:\s*(.+)$/m)?.[1];
              const data = block.match(/^data:\s*(.+)$/m)?.[1];
              if (event === 'delta' && data) audit.deltas.push({ at: Date.now(), text: JSON.parse(data).text });
              if (event === 'done') audit.doneAt = Date.now();
            }
          };
          this.addEventListener('progress', progress); this.addEventListener('load', progress);
        }
        return open.call(this, method, url, ...args);
      };
      const start = AudioBufferSourceNode.prototype.start;
      const stop = AudioBufferSourceNode.prototype.stop;
      const echoes=new WeakMap();
      AudioBufferSourceNode.prototype.start = function (when = 0, ...args) {
        if(this.context!==audit.input)audit.output=this.context;
        if (this.context === audit.input || !audit.recording) return start.call(this, when, ...args);
        this.connect(audit.recordDestination);
        const scheduled = Math.max(this.context.currentTime, when);
        const clip = { calledAt: Date.now(), startsAt: Date.now() + (scheduled - this.context.currentTime) * 1000,
          scheduled, duration: this.buffer.duration, endedAt: null, context: audit.contexts.indexOf(this.context) };
        audit.clips.push(clip);
        this.addEventListener('ended', () => { clip.endedAt = Date.now(); });
        const result=start.call(this,when,...args);
        // Feed the scheduled spoken reply into the real microphone worklet.
        const echo = audit.input.createBufferSource(); echo.buffer = this.buffer; echo.connect(audit.destination);
        echoes.set(this,echo);
        start.call(echo, audit.input.currentTime + Math.max(0, scheduled - this.context.currentTime));
        return result;
      };
      AudioBufferSourceNode.prototype.stop = function (...args) {
        try{if(echoes.has(this))stop.call(echoes.get(this));}catch{}
        return stop.apply(this, args);
      };
      audit.finishRecording = async () => {
        await new Promise(resolve => { audit.recorder.onstop = resolve; audit.recorder.stop(); });
        const bytes = new Uint8Array(await new Blob(audit.audioChunks).arrayBuffer());
        let text = ''; for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768));
        return btoa(text);
      };
      audit.beginRecording=()=>{
        audit.audioChunks=[];
        audit.recordDestination=audit.output.createMediaStreamDestination();
        audit.recorder=new MediaRecorder(audit.recordDestination.stream);
        audit.recorder.ondataavailable=event=>audit.audioChunks.push(event.data);
        audit.recorder.start();audit.recording=true;
      };
    }, { session });
    page = await context.newPage(); page.setDefaultTimeout(30000); page.setDefaultNavigationTimeout(120000);
    const headers = { 'Access-Control-Allow-Origin': new URL(frontend).origin };
    await page.route('**/v1/voice/call?*', route => route.fulfill({ status: 200, contentType: 'application/json', headers,
      body: JSON.stringify({ audio_base64: audio, mime_type: 'audio/wav', text: 'Hi.' }) }));
    await page.route('**/v1/voice/speak', route => {
      if (route.request().method() === 'OPTIONS') return route.continue();
      const body = route.request().postDataJSON();
      if (!body.groq_only) return route.fulfill({ status: 503, contentType: 'application/json', headers,
        body: JSON.stringify({ error: 'speech_unavailable', message: 'Non-Groq TTS blocked for playback verification.' }) });
      return route.continue();
    });
    let turns = 0;
    await page.route('**/v1/voice/transcribe*', route => {
      if (route.request().method() === 'OPTIONS') return route.continue();
      turns++;
      return route.fulfill({ status: 200, contentType: 'application/json', headers,
        body: JSON.stringify({ text: 'For this voice check, repeat these sentences exactly: Rinse the rice in cool water. Add the rice to a pot. Pour in enough fresh water. Bring the pot to a boil. Cover it and lower the heat. Serve the rice when it is tender.' }) });
    });
    await page.goto(`${frontend}/voice`);progress('voice screen loaded');
    await page.getByRole('button', { name: /portrait, PADI idle$/ }).click();
    await page.getByRole('button', { name: /portrait, PADI listening$/ }).waitFor({ timeout: 65000 });
    progress('greeting finished');
    await page.evaluate(() => { __playback.requests = []; __playback.deltas = []; __playback.doneAt = null; __playback.beginRecording(); });
    await page.evaluate(encoded => __playback.say(encoded), audio);
    await page.waitForFunction(() => __playback.clips.length || document.querySelector('[role="alert"]')?.textContent, null, { timeout: 65000 });
    progress('response playback started');
    await page.getByRole('button', { name: /portrait, PADI listening$/ }).waitFor({ timeout: 155000 });
    assert.ok(await page.evaluate(() => __playback.clips.length >= 3), 'The real response must exercise multiple audio segments.');
    const result = await page.evaluate(async () => ({ requests: __playback.requests, clips: __playback.clips,
      deltas: __playback.deltas, doneAt: __playback.doneAt,
      messages: JSON.parse(localStorage.getItem('app:v1:chat-messages')), recording: await __playback.finishRecording() }));
    assert.ok(result.clips.length >= 3, 'The real response must exercise multiple audio segments.');
    assert.equal(turns, 1, 'PADI must not transcribe its own audio.');
    writeFileSync(join(folder, 'playback.webm'), Buffer.from(result.recording, 'base64'));
    result.requests.forEach((request, i) => {
      if (request.audio) writeFileSync(join(folder, `segment-${i + 1}.wav`), Buffer.from(request.audio, 'base64'));
      delete request.audio;
    });
    delete result.recording;
    result.gapsMs = result.clips.slice(1).map((clip, i) => (clip.scheduled - result.clips[i].scheduled - result.clips[i].duration) * 1000);
    progress('full response recorded');
    result.firstTextToAudioMs = result.clips[0].startsAt - result.deltas[0].at;
    result.audioBeforeStreamDone = result.clips[0].startsAt < result.doneAt;
    writeFileSync(join(folder, 'timings.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ mode, firstTextToAudioMs: result.firstTextToAudioMs,
      audioBeforeStreamDone: result.audioBeforeStreamDone, gapsMs: result.gapsMs,
      ttsMs: result.requests.map(r => r.readyAt - r.at), artifacts: folder }));
    if (mode === 'fixed') assert.ok(result.gapsMs.every(gap => Math.abs(gap)<1), 'Prepared segments have no gaps or overlap.');
    console.log('PASS: complete real speech played, response text retained, echo blocked, and listening resumed.');
    const reply=result.messages.filter(message=>message.role==='padi').at(-1);
    const normalize=text=>text.replace(/\s+/g,' ').trim();
    assert.equal(normalize(reply.text),normalize(result.deltas.map(delta=>delta.text).join('')));
    assert.equal(normalize(reply.voiceSpokenText),normalize(reply.text),'Every word of the response was delivered.');
    if(mode==='fixed') {
      // A real Groq response often finishes faster than its TTS round trip.
      // Replay its text through a deliberately slow local SSE transport to
      // verify early playback and exiting while audio is actually playing.
      const first=reply.text.match(/^[\s\S]*?[.!?](?=\s|$)/)[0];
      const remaining=reply.text.slice(first.length);
      slowServer=createServer((request,response)=>{
        request.resume();
        response.setHeader('Access-Control-Allow-Origin',new URL(frontend).origin);
        response.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');
        if(request.method==='OPTIONS'){response.writeHead(204);response.end();return;}
        response.setHeader('Content-Type','text/event-stream');
        response.write(`event: delta\ndata: ${JSON.stringify({text:first+' '})}\n\n`);
        const timer=setTimeout(()=>{
          response.write(`event: delta\ndata: ${JSON.stringify({text:remaining.trimStart()})}\n\n`);
          response.end(`event: done\ndata: ${JSON.stringify({reply:first+' '+remaining.trimStart(),memory_revision:0})}\n\n`);
        },8000);
        response.on('close',()=>clearTimeout(timer));
      });
      await new Promise(resolve=>slowServer.listen(0,'127.0.0.1',resolve));
      await page.route('**/v1/chat',route=>route.continue({url:`http://127.0.0.1:${slowServer.address().port}/chat`}));
      await page.evaluate(()=>{
        __playback.requests=[];__playback.clips=[];__playback.deltas=[];delete __playback.doneAt;
        __playback.beginRecording();
      });
      await page.evaluate(encoded=>__playback.say(encoded),audio);
      progress('slower stream running');
      await page.waitForFunction(()=>__playback.clips.length>0,null,{timeout:20000});
      await page.waitForFunction(()=>Date.now()>__playback.clips[0].startsAt+250&&!__playback.clips[0].endedAt);
      const early=await page.evaluate(()=>({startedBeforeDone:!__playback.doneAt,requests:__playback.requests.length,
        clip:__playback.clips[0]}));
      assert.equal(early.startedBeforeDone,true,'Real TTS playback starts before the slower stream finishes.');
      await page.getByRole('button',{name:'Switch to text',exact:true}).click();
      await page.waitForFunction(()=>__playback.tracks.every(track=>track.readyState==='ended')&&__playback.clips.every(clip=>clip.endedAt));
      writeFileSync(join(folder,'early-playback-and-exit.json'),JSON.stringify(early,null,2));
      console.log('PASS: slower SSE fixture started real Groq audio before completion; exit stopped active playback and capture.');
      progress('checks passed');
    } else {
      await page.getByRole('button', { name: 'Switch to text', exact: true }).click();
      await page.waitForFunction(() => __playback.tracks.every(track => track.readyState === 'ended'));
    }
  } catch (error) {
    if (page) console.error(await page.evaluate(() => ({ alerts: [...document.querySelectorAll('[role="alert"]')].map(el => el.textContent),
      requests: __playback.requests.map(({ audio, ...r }) => r), clips: __playback.clips })).catch(() => ({})));
    throw error;
  } finally {
    if(slowServer){slowServer.closeAllConnections();await new Promise(resolve=>slowServer.close(resolve));}
    await browser.close();
  }
};
