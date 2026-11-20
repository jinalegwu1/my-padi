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

async function pageFor({ microphone = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 430, height: 900 } });
  // Playwright scopes the override to this isolated browser context. An empty
  // list rejects microphone permission rather than leaving a pending prompt.
  await context.grantPermissions(microphone ? ['microphone'] : [], { origin: frontend });
  await context.addInitScript(({ session, preferences }) => {
    sessionStorage.setItem('padi.auth.session.v1', JSON.stringify(session));
    localStorage.setItem('app:v1:preferences', JSON.stringify(preferences));
    localStorage.setItem('app:v1:chat-messages', '[]');
    const state = window.__padiVoiceCheck = { tracks: [], playing: 0, ended: 0, paused: 0, deviceSpeech: 0, constraints: null };
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
        state.lastPlaybackStarted = performance.now();
        playing.add(this);
        this.addEventListener('ended', () => { if (playing.has(this)) state.ended++; playing.delete(this); }, { once: true });
      }
      return play.apply(this, args);
    };
    AudioBufferSourceNode.prototype.stop = function (...args) {
      if (playing.has(this)) { state.paused++; playing.delete(this); }
      return pause.apply(this, args);
    };
  }, { session, preferences });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  // A fresh Expo development bundle can take longer than ordinary UI actions.
  page.setDefaultNavigationTimeout(120000);
  const requests = [];
  page.on('request', request => {
    if (request.url().endsWith('/v1/chat')) requests.push(request.postDataJSON());
  });
  return { context, page, requests };
}

async function textTurn(page, text) {
  const reply = page.waitForResponse(response => response.url().endsWith('/v1/chat'), { timeout: 155000 });
  await page.getByRole('textbox').first().fill(text);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const response = await reply;
  assert.equal(response.status(), 200, 'Text chat must return a real successful reply.');
  const body = await response.json();
  assert.equal(typeof body.reply, 'string');
  assert.ok(body.reply.trim());
  await page.waitForFunction(() => {
    const messages = JSON.parse(localStorage.getItem('app:v1:chat-messages') || '[]');
    return messages.length > 0 && !messages.some(message => message.pending);
  });
  return body.reply;
}

async function start(page) {
  await page.getByRole('button', { name: 'Tap to chat', exact: true }).click();
  await page.waitForFunction(() => window.__padiVoiceCheck.tracks.some(track => track.readyState === 'live'));
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
  const { context, page, requests } = await pageFor();
  const responses = [];
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('response', response => {
    const path = new URL(response.url()).pathname;
    if (path === '/v1/chat' || path.startsWith('/v1/voice/')) responses.push({ path, status: response.status() });
  });
  try {
    await page.goto(`${frontend}/chat`);
    const marker = `HibiscusVoice${randomBytes(4).toString('hex')}`;
    await textTurn(page, `During this voice check, answer in one concise sentence. Our temporary test word is ${marker}.`);
    console.log('PASS: authenticated text conversation started.');

    await page.getByRole('button', { name: 'Tap to chat', exact: true }).click();
    await page.waitForFunction(() => window.__padiVoiceCheck.tracks.some(track => track.readyState === 'live'));
    assert.equal(await page.getByRole('button', { name: 'Start conversation', exact: true }).count(), 0);
    await waitForPlayback(page);
    const greetingPlayed = await page.evaluate(() => window.__padiVoiceCheck.playing);
    console.log('PASS: one tap connected capture and PADI greeted first with real audio.');
    assert.equal(await page.getByRole('button', { name: /Stop and send/i }).count(), 0);
    const transcription = page.waitForResponse(response => new URL(response.url()).pathname === '/v1/voice/transcribe', { timeout: 60000 });
    const voiceReply = page.waitForResponse(response => response.url().endsWith('/v1/chat'), { timeout: 155000 });
    await page.evaluate(encoded => window.__padiVoiceCheck.playInput(encoded), publicSpeech);
    const recognised = await transcription;
    assert.equal(recognised.status(), 200);
    assert.equal(new URL(recognised.url()).searchParams.get('language'),'en-NG','Capture keeps selected English');
    assert.match((await recognised.json()).text.toLowerCase(), /ask not what your country/);
    const answered = await voiceReply;
    assert.equal(answered.status(), 200);
    assert.ok((await answered.json()).reply.trim());
    assert.equal(requests.at(-1).language,'en-NG','The real chat request keeps selected English');
    await waitForPlayback(page, greetingPlayed);
    const latency = await page.evaluate(() => (window.__padiVoiceCheck.lastPlaybackStarted - window.__padiVoiceCheck.inputEndedAt) / 1000);
    console.log(`First spoken reply after input ended: ${latency.toFixed(2)} seconds.`);
    console.log('PASS: public speech was captured, transcribed, answered, and played automatically.');

    const secondReply = page.waitForResponse(response => response.url().endsWith('/v1/chat'), { timeout: 155000 });
    const pausedBefore = await page.evaluate(() => window.__padiVoiceCheck.paused);
    const endedBefore = await page.evaluate(() => window.__padiVoiceCheck.ended);
    await page.evaluate(encoded => window.__padiVoiceCheck.playInput(encoded), continuation);
    await page.waitForFunction(count => window.__padiVoiceCheck.paused > count, pausedBefore);
    const continued = await secondReply;
    assert.equal(continued.status(), 200);
    const lastRequest = requests.at(-1);
    assert.equal(lastRequest.delivery, 'voice');
    assert.ok(lastRequest.voice_context?.interrupted_reply);
    assert.match(lastRequest.messages.at(-1).content.toLowerCase(), /continue/);
    await page.waitForFunction(count => window.__padiVoiceCheck.ended > count, endedBefore, { timeout: 65000 });
    await page.getByText('I’m listening', { exact: true }).waitFor();
    const constraints = await page.evaluate(() => window.__padiVoiceCheck.constraints.audio);
    assert.equal(constraints.echoCancellation, true);
    assert.equal(constraints.noiseSuppression, true);
    console.log('PASS: speaking interrupted playback, sent continuation context, and returned to listening.');

    await page.getByRole('button', { name: 'Pause chat', exact: true }).click();
    await assertClosed(page);
    await page.getByRole('button', { name: 'End chat', exact: true }).first().click();
    assert.match(await textTurn(page, 'What was our temporary test word? Reply with only the word.'), new RegExp(marker));
    assert.equal(requests.at(-1).delivery, 'text');
    assert.ok(requests.at(-1).messages.some(message => /ask not what your country/i.test(message.content)));
    console.log('PASS: Pause closed capture; switching back to text retained the real conversation.');

    await page.getByRole('button', { name: 'Tap to chat', exact: true }).click();
    await page.waitForFunction(() => window.__padiVoiceCheck.tracks.some(track => track.readyState === 'live'));
    await page.getByRole('button', { name: 'End chat', exact: true }).first().click();
    await assertClosed(page);
    console.log('PASS: End/navigation closed a restarted microphone.');
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
    await page.getByRole('button', { name: 'Tap to chat', exact: true }).click();
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
    await page.route('**/v1/voice/call?*', route => {
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
    await page.getByRole('button', { name: 'Pause chat', exact: true }).click();
    await assertClosed(page);
    console.log('PASS: simulated service failure reported accurately, created no chat turn, and remained stoppable.');
  } finally {
    await context.close();
  }
}

async function naturalSpeechUnavailable() {
  const { context, page } = await pageFor();
  try {
    await page.route(url => /\/v1\/voice\/(welcome|preview)$/.test(url.pathname), route => {
      if (route.request().method() === 'OPTIONS') return route.continue();
      return route.fulfill({ status: 503, contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Cache-Control': 'no-store' },
        body: JSON.stringify({ error: 'speech_unavailable', message: 'Natural voice unavailable for verification.' }),
      });
    });
    await page.goto(`${frontend}/onboarding/welcome`);
    await page.getByRole('button', { name: 'Hear PADI’s introduction', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Natural voice unavailable for verification.' }).waitFor();
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
    console.log('PASS: introduction and all six voice choices reported natural-service failure without browser speech or fake playback.');
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
