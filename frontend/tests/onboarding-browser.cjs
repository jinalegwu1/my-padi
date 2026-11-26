// Run against an Expo web build. Use Chromium's permission controls and fixture weather/chat replies.
const assert = require('node:assert/strict');
const { mkdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require('playwright-core');

const frontend = process.env.PADI_VOICE_FRONTEND_URL || 'http://localhost:8081';
const screenshots = process.env.PADI_ONBOARDING_SCREENSHOTS;
const sample = readFileSync(join(__dirname, 'fixtures/please-continue.wav')).toString('base64');

async function check(browser, { viewport, outcome, signedIn }) {
  const context = await browser.newContext({
    viewport,
    reducedMotion: outcome === 'later' ? 'reduce' : 'no-preference',
    geolocation: { latitude: 6.52, longitude: 3.38 },
  });
  try {
    await context.grantPermissions(outcome === 'allow' ? ['geolocation', 'microphone'] : [], { origin: frontend });
    await context.addInitScript(signedIn => {
      if (signedIn) sessionStorage.setItem('padi.auth.session.v1', JSON.stringify({
        token: 'onboarding-browser-fixture', expires_at: new Date(Date.now() + 3600000).toISOString(),
        user: { id: 'browser-user', full_name: 'Browser User' },
      }));
      window.locationRequests = 0;
      window.audioStarts = 0;
      window.micRequests = 0;
      const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = (...args) => { window.micRequests++; return capture(...args); };
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args) {
        window.audioStarts++;
        return start.apply(this, args);
      };
      const getPosition = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
      Object.defineProperty(navigator.geolocation, 'getCurrentPosition', {
        value(...args) {
          window.locationRequests++;
          return getPosition(...args);
        },
      });
    }, signedIn);
    const page = await context.newPage();
    const errors = [];
    const speechRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (request.url().includes('/v1/voice/')) speechRequests.push(request.url());
    });
    await page.route('**/v1/voice/config', route => route.fulfill({ json: {
      enabled: true, max_seconds: 60, local_transcription: true, transcription_ready: true,
      natural_speech: true, live_speech: true, voice_text_streaming: true,
      local_speech: true, speech_languages: ['en-NG'],
    } }));
    await page.route('**/v1/voice/speak', route => route.fulfill({ json: { audio_base64: sample, mime_type: 'audio/wav' } }));
    const openings = [];
    await page.route('**/v1/chat', route => {
      const request = route.request().postDataJSON();
      if (request.greeting) openings.push(request);
      const reply = request.greeting ? 'My padi, welcome!' : 'The cook has a point.';
      const result = { reply, memory_revision: 0 };
      if (!request.stream) return route.fulfill({ json: result });
      return route.fulfill({ contentType: 'text/event-stream',
        body: 'event: delta\ndata: ' + JSON.stringify({ text: reply }) + '\n\nevent: done\ndata: ' + JSON.stringify(result) + '\n\n' });
    });
    await page.route('**/api.open-meteo.com/**', route => route.fulfill({ json: {
      current: { temperature_2m: 28, apparent_temperature: 28, relative_humidity_2m: 85,
        wind_speed_10m: 3, precipitation: 0, uv_index: 1, weather_code: 1, is_day: 1, time: '2026-11-26T08:00' },
    } }));
    async function capture(screen) {
      if (!screenshots) return;
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({path: screenshots + '/' + viewport.width + '-' + screen + '.png'});
    }
    await page.goto(frontend);
    await page.waitForURL('**/onboarding/welcome');
    const start = page.getByRole('button', { name: 'Get Started', exact: true });
    await start.waitFor();
    assert.equal(await page.getByRole('button').count(), 1);
    assert.equal(await page.getByRole('link').count(), 0);
    const lighting = page.locator('img[src*="gold-knot-light"]').locator('..');
    if (outcome === 'later') {
      assert.equal(await lighting.evaluate(el => getComputedStyle(el).opacity), '0');
    } else {
      await page.waitForFunction(() => {
        const layer = document.querySelector('img[src*="gold-knot-light"]')?.parentElement;
        return layer && Number(getComputedStyle(layer).opacity) > 0.05;
      });
    }
    await capture('welcome');
    await start.click();
    await page.waitForURL('**/onboarding/country');
    await page.getByRole('heading', { name: 'Select your country' }).waitFor();
    await capture('country');
    const search = page.getByRole('textbox', { name: 'Search countries' });
    await search.fill('no matching country');
    await page.getByText('No matching countries.').waitFor();
    await page.getByRole('button', { name: 'Clear search' }).click();
    await search.fill('niger');
    const nigeria = page.getByRole('button', { name: 'Nigeria', exact: true });
    assert.match(await nigeria.innerText(), /🇳🇬/);
    assert.deepEqual(speechRequests, []);
    assert.equal(await page.evaluate(() => window.micRequests + window.audioStarts), 0);
    await nigeria.click();
    await page.waitForURL('**/chat');
    const toggle = page.getByRole('button', { name: 'Use my location' });
    await toggle.waitFor();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem('app:v1:preferences')));
    assert.equal(prefs.countryCode, 'NG');
    assert.equal(prefs.onboarded, true);
    if (signedIn) {
      await page.getByRole('button', { name: 'Switch to text' }).waitFor();
      await page.waitForFunction(() => window.audioStarts > 0);
      assert.equal(await page.evaluate(() => window.micRequests), 1);
      assert.equal(openings.length, 1);
      assert.equal(openings[0].stream, true);
    }
    await toggle.click();
    assert.equal(await page.evaluate(() => window.locationRequests), 0);
    await capture('chat-location');
    if (outcome === 'later') {
      await page.getByRole('button', { name: 'Maybe later' }).click();
      assert.equal(await page.evaluate(() => window.locationRequests), 0);
    } else {
      await page.getByRole('button', { name: 'Allow location' }).click();
      assert.equal(await page.evaluate(() => window.locationRequests), 1);
      if (outcome === 'allow') await page.getByText('Good morning! It’s 28°C near you.').waitFor();
    }
    await toggle.waitFor({ state: 'hidden' });
    if (signedIn) {
      if (outcome === 'allow') await page.getByRole('button', { name: /portrait, PADI listening$/ }).waitFor();
      else await page.getByRole('alert').first().waitFor();
      await page.getByRole('button', { name: 'Switch to text' }).click();
      await page.getByText('My padi, welcome!', { exact: true }).waitFor();
      await page.locator('textarea').fill('What about the plantain?');
      await page.locator('textarea').press('Enter');
      await page.getByText('The cook has a point.', { exact: true }).waitFor();
    } else {
      await page.getByRole('button', { name: 'Continue with phone' }).waitFor();
    }
    await page.goto(frontend);
    await page.waitForURL('**/chat');
    await page.getByRole('button', {name: signedIn ? 'Switch to text' : 'Continue with phone'}).waitFor();
    assert.equal(await toggle.count(), 0);
    assert.equal(await page.evaluate(() => window.locationRequests), 0);
    if (!signedIn) assert.deepEqual(speechRequests, []);
    assert.deepEqual(errors, []);
    console.log('PASS', viewport.width, 'px, location:', outcome, 'signed in:', signedIn);
  } finally { await context.close(); }
}

(async () => {
  if (screenshots) mkdirSync(screenshots, { recursive: true });
  const browser = await chromium.launch({
    ...(process.env.PADI_VOICE_BROWSER_EXECUTABLE ? { executablePath: process.env.PADI_VOICE_BROWSER_EXECUTABLE } : { channel: 'chrome' }),
    headless: true, args: ['--use-fake-device-for-media-stream'],
  });
  try {
    await check(browser, { viewport: { width: 390, height: 844 }, outcome: 'deny', signedIn: true });
    await check(browser, { viewport: { width: 1200, height: 850 }, outcome: 'allow', signedIn: true });
    await check(browser, { viewport: { width: 320, height: 568 }, outcome: 'later', signedIn: false });
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
