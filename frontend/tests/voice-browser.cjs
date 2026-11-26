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

async function pageFor({ microphone = true, initialMessages = [] } = {}) {
  const context = await browser.newContext({ viewport: { width: 430, height: 900 } });
  // Playwright scopes the override to this isolated browser context. An empty
  // list rejects microphone permission rather than leaving a pending prompt.
  await context.grantPermissions(microphone ? ['microphone'] : [], { origin: frontend });
  await context.addInitScript(({ session, preferences, initialMessages }) => {
    sessionStorage.setItem('padi.auth.session.v1', JSON.stringify(session));
    localStorage.setItem('app:v1:preferences', JSON.stringify(preferences));
    localStorage.setItem('app:v1:chat-messages', JSON.stringify(initialMessages));
    const state = window.__padiVoiceCheck = { tracks: [], playing: 0, activePlayback: 0, ended: 0, paused: 0, deviceSpeech: 0, constraints: null, echoPlayback: true };
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
    state.playInput = async encoded => {
      if (!state.input || state.input.state !== 'running') throw new Error('Test microphone is not running.');
      const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
      const buffer = await state.input.decodeAudioData(bytes.buffer);
      const source = state.input.createBufferSource();
      source.buffer = buffer;
      source.connect(state.destination);
      await new Promise(resolve => { source.onended = resolve; source.start(); });
      state.inputEndedAt = performance.now();
    };
    const play = AudioBufferSourceNode.prototype.start;
    const pause = AudioBufferSourceNode.prototype.stop;
    const playing = new WeakSet();
    AudioBufferSourceNode.prototype.start = function (...args) {
      if (this.context !== state.input) {
        state.playing++;
        state.activePlayback++;
        state.lastPlaybackStarted = performance.now();
        playing.add(this);
        this.addEventListener('ended', () => { if (playing.delete(this)) { state.ended++; state.activePlayback--; } }, { once: true });
        // Route a copy of actual TTS into the test microphone to exercise
        // echo suppression through the real capture worklet, not just flags.
        if (state.echoPlayback && state.input?.state === 'running') {
          const echo = state.input.createBufferSource();
          echo.buffer = this.buffer;
          echo.connect(state.destination);
          play.call(echo);
        }
      }
      return play.apply(this, args);
    };
    AudioBufferSourceNode.prototype.stop = function (...args) {
      if (playing.delete(this)) { state.paused++; state.activePlayback--; }
      return pause.apply(this, args);
    };
  }, { session, preferences, initialMessages });
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
    assert.equal(await page.getByRole('button', { name: /Record|Submit|Stop and send|Stop listening|Voice to text|Show words|Hide words/i }).count(), 0);
    assert.equal(await page.getByText(/Voice conversation active|I’m here. Let’s talk.|Talk freely.|Tap to chat to start/i).count(),0);
    assert.equal(requests.length,0,'Greeting echo must not create a user turn.');
    const transcription = page.waitForResponse(response => new URL(response.url()).pathname === '/v1/voice/transcribe', { timeout: 60000 });
    const voiceReply = page.waitForResponse(response => response.url().endsWith('/v1/chat'), { timeout: 155000 });
    await page.evaluate(encoded => window.__padiVoiceCheck.playInput(encoded), publicSpeech);
    const recognised = await transcription;
    assert.equal(recognised.status(), 200);
    assert.equal(new URL(recognised.url()).searchParams.get('language'),'en-NG','Capture keeps selected English');
    assert.match((await recognised.json()).text.toLowerCase(), /ask not what your country/);
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
    assert.ok(saved.some(message=>/ask not what your country/i.test(message.text)));
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
