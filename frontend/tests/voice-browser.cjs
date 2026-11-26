// Opt-in integration check. Hardware input uses public/synthetic speech only;
// transcription, chat, speech generation, and playback use the real services.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { randomBytes } = require('node:crypto');
const { join } = require('node:path');
const { chromium } = require('playwright-core');

const frontend = process.env.PADI_VOICE_FRONTEND_URL || 'http://localhost:8081';
const api = process.env.PADI_VOICE_API_URL || 'http://127.0.0.1:8080';
const session = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const publicSpeech = readFileSync(process.env.PADI_VOICE_TEST_AUDIO_PATH).toString('base64');
const continuation = readFileSync(join(__dirname, 'fixtures', 'please-continue.wav')).toString('base64');
const preferences = {
  onboarded: true, countryCode: 'NG', languageCode: 'en-NG', displayName: 'Voice verification',
  appearance: 'light', textScale: 1, reduceMotion: false, highContrast: false,
  voiceId: 'ada', voiceRate: 1, notificationsEnabled: false, dailyCheckIn: false,
  checkInTime: '08:00', showVoiceTranscript: true,
};
const failuresOnly = process.env.PADI_VOICE_BROWSER_FAILURES_ONLY === '1';
let browser;

async function pageFor({ microphone = true, initialMessages = [], voiceId = 'ada', languageCode = 'en-NG' } = {}) {
  const context = await browser.newContext({ viewport: { width: 430, height: 900 } });
  // Playwright scopes the override to this isolated browser context. An empty
  // list rejects microphone permission rather than leaving a pending prompt.
  await context.grantPermissions(microphone ? ['microphone'] : [], { origin: frontend });
  await context.addInitScript(({ session, preferences, initialMessages }) => {
    sessionStorage.setItem('padi.auth.session.v1', JSON.stringify(session));
    localStorage.setItem('app:v1:preferences', JSON.stringify(preferences));
    localStorage.setItem('app:v1:chat-messages', JSON.stringify(initialMessages));
    const state = window.__padiVoiceCheck = { tracks: [], playback: [], playing: 0, activePlayback: 0, ended: 0, paused: 0, deviceSpeech: 0, constraints: null, echoPlayback: true };
    if (window.speechSynthesis) window.speechSynthesis.speak = () => {
      state.deviceSpeech++;
      throw new Error('PADI must not fall back to browser speech.');
    };
    const originalCapture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      // Exercise Chromium's permission gate against its fake hardware, then
      // supply an on-demand public-audio stream to the actual AudioWorklet.
      const permissionProbe = await originalCapture(constraints);
      permissionProbe.getTracks().forEach(track => track.stop());
      const input = new AudioContext({ sampleRate: 16000 });
      const destination = input.createMediaStreamDestination();
      destination.channelCount = 1;
      await input.resume();
      state.input = input;
      state.destination = destination;
      state.constraints = constraints;
      destination.stream.getTracks().forEach(track => {
        state.tracks.push(track);
        const stop = track.stop.bind(track);
        track.stop = () => { stop(); void input.close().catch(() => {}); };
      });
      return destination.stream;
    };
    // Mark the first and last 10 ms blocks above -48 dBFS. The input fixture
    // and returned waveform often have different amounts of edge padding.
    function speechEdges(buffer) {
      const samples = buffer.getChannelData(0);
      const block = Math.max(1, Math.round(buffer.sampleRate / 100));
      let first, last;
      for (let p = 0; p < samples.length; p += block) {
        const count = Math.min(block, samples.length - p);
        let energy = 0;
        for (let i = p; i < p + count; i++) energy += samples[i] * samples[i];
        if (energy / count < 10 ** (-48 / 10)) continue;
        first ??= p / buffer.sampleRate;
        last = (p + count) / buffer.sampleRate;
      }
      return {first, last};
    }
    state.armTiming = () => {
      const turn = state.turn = {armedAt: performance.now()};
      const observer = new MutationObserver(() => {
        const caption = document.querySelector('[data-testid="voice-reply-caption"]');
        if (!caption?.checkVisibility() || !caption.textContent.replace(/^PADI/, '').trim()) return;
        const submit = performance.getEntriesByName('padi.voice.submit').at(-1);
        if (!submit || submit.startTime < turn.armedAt) return;
        observer.disconnect();
        requestAnimationFrame(() => { turn.visibleAt = performance.now(); });
      });
      observer.observe(document.body, {subtree:true, childList:true, characterData:true});
    };
    state.playInput = async encoded => {
      if (!state.input || state.input.state !== 'running') throw new Error('Test microphone is not running.');
      const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
      const buffer = await state.input.decodeAudioData(bytes.buffer);
      const source = state.input.createBufferSource();
      source.buffer = buffer;
      source.connect(state.destination);
      if (state.turn) {
        const {last} = speechEdges(buffer);
        if (last === undefined) throw new Error('The test recording has no audible speech.');
        state.turn.lastWordAt = performance.now() + last * 1000;
      }
      await new Promise(resolve => { source.onended = resolve; source.start(); });
      state.inputEndedAt = performance.now();
    };
    const play = AudioBufferSourceNode.prototype.start;
    const pause = AudioBufferSourceNode.prototype.stop;
    const playing = new WeakSet();
    const echoes = new WeakMap();
    AudioBufferSourceNode.prototype.start = function (...args) {
      if (this.context !== state.input) {
        state.playing++;
        state.activePlayback++;
        const start = Math.max(this.context.currentTime, args[0] || 0);
        const delay = start - this.context.currentTime;
        state.lastPlaybackStarted = performance.now() + delay * 1000;
        state.playback.push({start, end: start + this.buffer.duration});
        if (state.turn && state.turn.audibleAt === undefined) {
          const first = speechEdges(this.buffer).first;
          if (first !== undefined) state.turn.audibleAt = state.lastPlaybackStarted + first * 1000;
        }
        playing.add(this);
        this.addEventListener('ended', () => { if (playing.delete(this)) { state.ended++; state.activePlayback--; } }, { once: true });
        // Route a copy of actual TTS into the test microphone to exercise
        // echo suppression through the real capture worklet, not just flags.
        if (state.echoPlayback && state.input?.state === 'running') {
          const echo = state.input.createBufferSource();
          echo.buffer = this.buffer;
          echo.connect(state.destination);
          play.call(echo, state.input.currentTime + delay);
          echoes.set(this, echo);
        }
      }
      return play.apply(this, args);
    };
    AudioBufferSourceNode.prototype.stop = function (...args) {
      const echo = echoes.get(this);
      if (echo) pause.call(echo);
      if (playing.delete(this)) { state.paused++; state.activePlayback--; }
      return pause.apply(this, args);
    };
  }, { session, preferences: {...preferences, voiceId, languageCode}, initialMessages });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  // A fresh Expo development bundle can take longer than ordinary UI actions.
  page.setDefaultNavigationTimeout(120000);
  const requests = [];
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().endsWith('/v1/chat') && !request.postDataJSON().greeting) requests.push(request.postDataJSON());
  });
  return { context, page, requests };
}

function completedStream(raw) {
  const events = raw.split(/\r?\n\r?\n/).map(block => {
    const event = block.match(/^event:\s*(.+)$/m)?.[1];
    const data = block.match(/^data:\s*(.+)$/m)?.[1];
    return event && data ? { event, data: JSON.parse(data) } : null;
  }).filter(Boolean);
  const deltas = events.filter(item => item.event === 'delta').map(item => item.data.text);
  const done = events.find(item => item.event === 'done')?.data;
  assert.ok(deltas.length > 0, 'Voice chat must stream at least one text delta.');
  assert.ok(done?.reply?.trim(), 'Voice stream must end with a complete reply.');
  assert.equal(deltas.join(''), done.reply, 'Streamed deltas must match the final reply.');
  return done.reply;
}

async function start(page) {
  await page.getByRole('button', { name: /portrait, PADI idle$/ }).click();
  await page.waitForFunction(() => window.__padiVoiceCheck.tracks.some(track => track.readyState === 'live'));
  await listening(page);
}

async function listening(page) {
  await page.getByRole('button', { name: /portrait, PADI listening$/ }).waitFor({ timeout: 155000 });
  assert.equal(await page.evaluate(() => window.__padiVoiceCheck.activePlayback), 0, 'Listening starts after playback finishes.');
}

async function assertClosed(page) {
  await page.waitForFunction(() => window.__padiVoiceCheck.tracks.every(track => track.readyState === 'ended'));
}

async function waitForPlayback(page, count = 0) {
  await page.waitForFunction(count => window.__padiVoiceCheck.playing > count ||
    [...document.querySelectorAll('[role="alert"]')].some(element => element.textContent?.trim()), count, {timeout:65000});
  if (await page.evaluate(count => window.__padiVoiceCheck.playing <= count, count)) {
    throw new Error(await page.getByRole('alert').first().textContent());
  }
}

async function liveCaptions() {
  const { context, page, requests } = await pageFor();
  let stage = 'opening the call';
  try {
    await page.goto(frontend + '/voice');
    await start(page);
    stage = 'receiving a partial transcript';
    const before = await page.evaluate(() => window.__padiVoiceCheck.playing);
    await page.evaluate(() => window.__padiVoiceCheck.armTiming());
    const [sending] = await Promise.all([
      page.waitForRequest(req => req.url().endsWith('/v1/chat') && !req.postDataJSON().greeting),
      page.waitForFunction(() => performance.getEntriesByName('padi.voice.first-caption').length > 0).then(async () => {
        assert.equal(requests.length, 0, 'Captions must appear while the turn is still open');
        await page.getByText('YOU SAID', {exact:true}).waitFor();
      }),
      page.evaluate(encoded => window.__padiVoiceCheck.playInput(encoded), publicSpeech),
    ]);
    const final = sending.postDataJSON().messages.at(-1).content;
    assert.match(final, /terms of payment/i);
    stage = 'displaying and playing the reply';
    await page.getByText('Hello there.', {exact:true}).waitFor();
    await waitForPlayback(page, before);
    await listening(page);
    assert.equal(requests.length, 1);
    const timings = await turnTiming(page, before);
    assert.ok(Object.values(timings).every(Number.isFinite));
    console.log('Local browser timing in milliseconds', JSON.stringify(timings));
    await page.getByRole('button', {name:'Switch to text',exact:true}).click();
    await assertClosed(page);
  } catch(error) {
    const info = await page.evaluate(() => ({
      ui: document.body.innerText.slice(-800), visibility: document.visibilityState,
      input: window.__padiVoiceCheck.input?.state, tracks: window.__padiVoiceCheck.tracks.map(t => t.readyState),
      packets: window.__padiVoiceCheck.playing, paused: window.__padiVoiceCheck.paused,
    }));
    throw new Error(stage + ': ' + error.message + '\n' + JSON.stringify(info));
  } finally { await context.close(); }
}

async function turnTiming(page, firstPacket) {
  return page.evaluate(firstPacket => {
    const state = window.__padiVoiceCheck;
    const clips = state.playback.slice(firstPacket);
    const timings = Object.fromEntries(['first-caption','submit','first-reply-text','first-playback']
      .map(name => [name, Math.round(performance.getEntriesByName('padi.voice.' + name).at(-1)?.duration)]));
    return {
      ...timings,
      visibleMs: Math.round(state.turn.visibleAt - state.turn.lastWordAt),
      audibleMs: Math.round(state.turn.audibleAt - state.turn.lastWordAt),
      largestGapMs: Math.round(1000 * clips.reduce((gap, clip, i) => i ? Math.max(gap, clip.start - clips[i-1].end) : gap, 0)),
    };
  }, firstPacket);
}

async function checkLatency() {
  const fixture = name => readFileSync(join(__dirname, 'fixtures', name + '.wav')).toString('base64');
  const english = [fixture('nigerian-english-short'), fixture('nigerian-english-long'), continuation];
  const pidgin = [fixture('nigerian-pidgin'), continuation];
  let total = 0, passed = 0;
  for (const languageCode of ['en-NG', 'pcm-NG']) {
    for (const voiceId of ['baby', 'ada']) {
      const {page, context, requests} = await pageFor({voiceId, languageCode});
      try {
        await page.goto(frontend + '/voice');
        await start(page);
        const recordings = languageCode === 'pcm-NG' ? pidgin : english;
        for (let index = 0; index < 25; index++) {
          const before = await page.evaluate(() => window.__padiVoiceCheck.playing);
          await page.evaluate(() => window.__padiVoiceCheck.armTiming());
          const send = page.waitForRequest(req => req.url().endsWith('/v1/chat') && !req.postDataJSON().greeting, {timeout:30000});
          await Promise.all([send, page.evaluate(encoded => window.__padiVoiceCheck.playInput(encoded), recordings[index % recordings.length])]);
          await waitForPlayback(page, before);
          await listening(page);
          const timings = await turnTiming(page, before);
          assert.ok(Object.values(timings).every(Number.isFinite), 'Every turn needs an observed caption, reply, and audible waveform');
          assert.equal(requests.length, index + 1, 'One utterance must send one user turn');
          total++;
          if (timings.visibleMs >= 0 && timings.visibleMs <= 3000 && timings.audibleMs >= 0 && timings.audibleMs <= 3000) passed++;
          console.log(JSON.stringify({turn:total, voiceId, languageCode, ...timings}));
          if (total - passed > 5) throw new Error(`Three-second target missed. ${total - passed} of ${total} turns exceeded the joint limit.`);
        }
      } finally { await context.close(); }
    }
  }
  assert.equal(total, 100);
  assert.ok(passed >= 95);
  console.log(`${passed}/100 warm turns delivered both text and audible speech within three seconds.`);
}

async function success() {
  // Represent an existing text conversation without depending on the
  // separately configured text-chat provider. All voice turns use real Groq.
  const marker = `HibiscusVoice${randomBytes(4).toString('hex')}`;
  const initialMessages=[
    {id:'fixture-user',role:'user',text:`During this voice check, answer in one concise sentence. Our temporary test word is ${marker}.`},
    {id:'fixture-padi',role:'padi',text:`I will remember ${marker}.`},
  ].map(message=>({...message,createdAt:Date.now(),backendChat:true,backendUserID:session.user.id,memoryRevision:0}));
  const { context, page, requests } = await pageFor({initialMessages});
  const responses = [];
  const browserErrors = [];
  let voiceConfig;
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('response', response => {
    const path = new URL(response.url()).pathname;
    if (path === '/v1/chat' || path.startsWith('/v1/voice/')) responses.push({ path, status: response.status() });
  });
  try {
    await page.goto(`${frontend}/chat?mode=text`);
    await page.getByRole('button', { name: 'Open PADI menu' }).click();
    await page.getByRole('button', { name: /During this voice check/ }).click();
    await page.getByRole('button', { name: 'Switch to voice' }).click();
    voiceConfig = await page.evaluate(async apiURL => (await fetch(`${apiURL}/v1/voice/config`)).json(), api);
    assert.equal(voiceConfig.local_transcription,true);assert.equal(voiceConfig.groq_conversation,true);
    await listening(page);
    await page.screenshot({path:'/tmp/my-padi-voice-simple.png'});
    const greetingPlayed = await page.evaluate(() => window.__padiVoiceCheck.playing);
    assert.ok(greetingPlayed > 0, 'Switching to voice plays the greeting automatically.');
    assert.equal(await page.getByRole('button', { name: /Record|Submit|Stop and send|Stop listening|Voice to text/i }).count(), 0);
    assert.equal(await page.getByText(/Voice conversation active|I’m here. Let’s talk.|Talk freely.|Tap to chat to start/i).count(),0);
    assert.equal(requests.length,0,'Greeting echo must not create a user turn.');
    const live = voiceConfig.live_recognition_languages?.includes('en-NG');
    const transcription = live ? null : page.waitForResponse(response => new URL(response.url()).pathname === '/v1/voice/transcribe', { timeout: 60000 });
    const voiceReply = page.waitForResponse(response => response.url().endsWith('/v1/chat'), { timeout: 155000 });
    await page.evaluate(encoded => window.__padiVoiceCheck.playInput(encoded), publicSpeech);
    if (transcription) {
      const recognised = await transcription;
      assert.equal(recognised.status(), 200);
      assert.equal(new URL(recognised.url()).searchParams.get('language'),'en-NG');
    }
    const answered = await voiceReply;
    assert.equal(answered.status(), 200);
    const answerText = completedStream(await answered.text());
    assert.equal(requests.at(-1).language,'en-NG','The real chat request keeps selected English');
    assert.equal(requests.at(-1).stream,true,'Voice replies use the streaming route.');
    await waitForPlayback(page, greetingPlayed);
    const latency = await page.evaluate(() => (window.__padiVoiceCheck.lastPlaybackStarted - window.__padiVoiceCheck.inputEndedAt) / 1000);
    console.log(`First spoken reply after input ended: ${latency.toFixed(2)} seconds.`);
    await listening(page);
    console.log(`PASS: public speech was captured, transcribed, and streamed to a complete response (${answerText.length} characters).`);

    await page.waitForTimeout(1000);
    assert.equal(requests.length,1,'Reply echo and silence must not create another turn.');
    const secondReply = page.waitForResponse(response => response.url().endsWith('/v1/chat'), { timeout: 155000 });
    await page.evaluate(encoded => window.__padiVoiceCheck.playInput(encoded), continuation);
    const continued = await secondReply;
    assert.equal(continued.status(), 200);
    const lastRequest = requests.at(-1);
    assert.equal(lastRequest.delivery, 'voice');
    assert.equal(lastRequest.stream,true);
    assert.ok(lastRequest.messages.some(message=>message.content===answerText),'The second voice turn retains the first reply.');
    assert.match(lastRequest.messages.at(-1).content.toLowerCase(), /continue/);
    completedStream(await continued.text());
    await listening(page);
    const constraints = await page.evaluate(() => window.__padiVoiceCheck.constraints.audio);
    assert.equal(constraints.echoCancellation, true);
    assert.equal(constraints.noiseSuppression, true);
    assert.equal(await page.evaluate(()=>window.__padiVoiceCheck.tracks.length),1,'Both turns use the same microphone session.');
    assert.equal(requests.length,2,'PADI cannot answer its own spoken audio.');
    console.log('PASS: silence completed two voice turns, with automatic listening and echo rejection.');

    await page.getByRole('button', { name: 'Switch to text', exact: true }).click();
    await assertClosed(page);
    await page.getByRole('textbox').first().waitFor();
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('app:v1:chat-messages')||'[]'));
    assert.ok(saved.some(message=>message.text===answerText));
    assert.ok(saved.some(message=>message.text.includes(marker)));
    assert.ok(saved.some(message=>message.role==='user' && /what your country/i.test(message.text)));
    console.log('PASS: switching to text closed capture and retained the real conversation.');

    await page.getByRole('button', { name: 'Switch to voice', exact: true }).click();
    await listening(page);
    const resumedReply=page.waitForResponse(response=>response.url().endsWith('/v1/chat'),{timeout:155000});
    const playedBefore=await page.evaluate(()=>window.__padiVoiceCheck.playing);
    await page.evaluate(encoded=>window.__padiVoiceCheck.playInput(encoded),continuation);
    const resumed=await resumedReply;
    assert.equal(resumed.status(),200);completedStream(await resumed.text());
    assert.ok(requests.at(-1).messages.some(message=>message.content===answerText));
    assert.ok(requests.at(-1).messages.some(message=>message.content.includes(marker)),'Reopening voice mode retains the text and voice context.');
    await waitForPlayback(page,playedBefore);
    await page.getByRole('button', { name: 'Switch to text', exact: true }).click();
    await assertClosed(page);
    assert.equal(await page.evaluate(()=>window.__padiVoiceCheck.activePlayback),0);
    console.log('PASS: calling PADI again resumed context; leaving during playback stopped audio and capture.');
  } catch (error) {
    const state = await page.evaluate(() => ({
      url: location.pathname,
      buttons: [...document.querySelectorAll('[role="button"]')].map(element => element.getAttribute('aria-label')).filter(Boolean),
      playing: window.__padiVoiceCheck?.playing,
      ended: window.__padiVoiceCheck?.ended,
      paused: window.__padiVoiceCheck?.paused,
      activeMicrophones: window.__padiVoiceCheck?.tracks.filter(track => track.readyState === 'live').length,
      alerts: [...document.querySelectorAll('[role="alert"]')].map(element => element.textContent?.slice(0, 300)),
    })).catch(() => ({ available: false }));
    await page.screenshot({path:'/tmp/my-padi-voice-browser-failure.png'}).catch(()=>{});
    console.error('Voice check diagnostics:', JSON.stringify({ responses, state, browserErrors }));
    throw error;
  } finally {
    await context.close();
  }
}

async function denied() {
  const { context, page } = await pageFor({ microphone: false });
  try {
    await page.goto(`${frontend}/voice`);
    assert.equal(await page.evaluate(async () => (await navigator.permissions.query({ name: 'microphone' })).state), 'denied');
    await page.getByRole('button', { name: /portrait, PADI idle$/ }).click();
    await page.getByRole('alert').filter({ hasText: /microphone/i }).waitFor();
    await assertClosed(page);
    console.log('PASS: denied microphone permission produced an error and opened no capture.');
  } finally {
    await context.close();
  }
}

async function unavailable() {
  const { context, page, requests } = await pageFor();
  try {
    // This scenario exercises the separate file-recognition outage.
    await page.route('**/v1/voice/config', async route => {
      const response=await route.fetch();
      await route.fulfill({response,json:{...await response.json(),live_recognition_languages:[],streaming_speech_languages:[]}});
    });
    await page.route(url=>/\/v1\/voice\/(call|speak)$/.test(url.pathname), route => {
      if (route.request().method() === 'OPTIONS') return route.continue();
      return route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':new URL(frontend).origin},
        body:JSON.stringify({audio_base64:continuation,mime_type:'audio/wav',text:'Hey! How are you?'})});
    });
    await page.route('**/v1/voice/transcribe*', route => {
      if (route.request().method() === 'OPTIONS') return route.continue();
      return route.fulfill({
        status: 503, contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Cache-Control': 'no-store' },
        body: JSON.stringify({ error: 'voice_unavailable', message: 'Verification service outage.' }),
      });
    });
    await page.goto(`${frontend}/voice`);
    await start(page);
    await page.evaluate(encoded => window.__padiVoiceCheck.playInput(encoded), publicSpeech);
    await page.getByRole('alert').filter({ hasText: 'Verification service outage.' }).waitFor();
    assert.equal(requests.length, 0, 'Failed transcription must not invent a chat message.');
    await page.getByRole('button', { name: 'Switch to text', exact: true }).click();
    await assertClosed(page);
    console.log('PASS: simulated service failure reported accurately, created no chat turn, and remained stoppable.');
  } finally {
    await context.close();
  }
}

async function naturalSpeechUnavailable() {
  const { context, page } = await pageFor();
  try {
    let voiceRequests = 0;
    await page.route(url => /\/v1\/voice\/(welcome|preview)$/.test(url.pathname), route => {
      if (route.request().method() === 'OPTIONS') return route.continue();
      voiceRequests++;
      return route.fulfill({ status: 503, contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Cache-Control': 'no-store' },
        body: JSON.stringify({ error: 'speech_unavailable', message: 'Natural voice unavailable for verification.' }),
      });
    });
    await page.goto(`${frontend}/onboarding/welcome`);
    await page.getByRole('button', { name: 'Get Started', exact: true }).waitFor();
    assert.equal(await page.getByRole('button').count(), 1);
    assert.equal(voiceRequests, 0);
    assert.equal(await page.evaluate(() => window.__padiVoiceCheck.deviceSpeech), 0);
    await page.goto(`${frontend}/settings`);
    await page.getByText('Voice', { exact: true }).last().click();
    for (const name of ['PADI', 'Ada', 'Chidi', 'Zainab', 'Tunde', 'Amara']) {
      await page.getByRole('button', { name: `Preview voice: ${name}`, exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'Natural voice unavailable for verification.' }).waitFor();
      await page.getByRole('button', { name: `Preview voice: ${name}`, exact: true }).waitFor();
    }
    const state = await page.evaluate(() => ({ robot: window.__padiVoiceCheck.deviceSpeech, playing: window.__padiVoiceCheck.playing }));
    assert.deepEqual(state, { robot: 0, playing: 0 });
    console.log('PASS: onboarding was silent and all six Settings voice previews reported the service failure.');
  } finally { await context.close(); }
}

(async () => {
  try {
    browser = await chromium.launch({
      ...(process.env.PADI_VOICE_BROWSER_EXECUTABLE ? { executablePath: process.env.PADI_VOICE_BROWSER_EXECUTABLE } : { channel: 'chrome' }),
      headless: true,
      args: ['--use-fake-device-for-media-stream'],
    });
    if (process.env.PADI_VERIFY_LIVE_CAPTIONS === '1') { await liveCaptions(); return; }
    if (process.env.PADI_VERIFY_VOICE_LATENCY === '1') { await checkLatency(); return; }
    if (!failuresOnly) await success();
    await denied();
    await unavailable();
    await naturalSpeechUnavailable();
    console.log(failuresOnly
      ? 'Browser failure checks passed; this run did not generate AI replies or speech.'
      : 'Browser software checks passed. Physical microphone, speaker, echo, and native-device checks remain separate.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await browser?.close();
  }
})();
