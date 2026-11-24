// Opt-in browser check: uses the real app, animations and audio playback,
// with the fixed public speech fixture replacing public greeting/preview audio.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const frontend = process.env.PADI_PORTRAIT_FRONTEND_URL || 'http://localhost:8081';
const idleOnly = process.argv.includes('--idle-only');
fs.mkdirSync('/tmp/my-padi-portrait-motion', { recursive: true });
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/please-continue.wav'));
// End the real public fixture with a silent interval so the browser can prove
// that lips close before playback ends, rather than just when a clip is stopped.
let dataChunk = 12;
while (fixture.toString('ascii', dataChunk, dataChunk + 4) !== 'data') {
  const length = fixture.readUInt32LE(dataChunk + 4);
  dataChunk += 8 + length + length % 2;
}
const dataStart = dataChunk + 8;
const dataLength = fixture.readUInt32LE(dataChunk + 4);
const pcm = fixture.subarray(dataStart, dataStart + dataLength);
const silent = Buffer.alloc(16000 * 2 * 2);
const wave = Buffer.concat([fixture.subarray(0, dataStart), pcm, pcm, silent, fixture.subarray(dataStart + dataLength)]);
wave.writeUInt32LE(wave.length - 8, 4);
wave.writeUInt32LE(pcm.length * 2 + silent.length, dataChunk + 4);
const audio = wave.toString('base64');
const preferences = {
  onboarded: true, countryCode: 'NG', languageCode: 'en-NG', displayName: 'Portrait check',
  appearance: 'light', textScale: 1, reduceMotion: false, highContrast: false,
  voiceId: idleOnly ? 'ada' : 'baby', voiceRate: 1, showVoiceTranscript: true,
  notificationsEnabled: false, dailyCheckIn: false, checkInTime: '08:00',
};

async function transformChanges(locator) {
  const first = await locator.evaluate(element => getComputedStyle(element).transform);
  await new Promise(resolve => setTimeout(resolve, 180));
  const next = await locator.evaluate(element => getComputedStyle(element).transform);
  return first !== next;
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  let page;
  try {
    const context = await browser.newContext({ viewport: { width: 430, height: 900 } });
    await context.addInitScript(preferences => {
      if (!localStorage.getItem('app:v1:preferences')) {
        localStorage.setItem('app:v1:preferences', JSON.stringify(preferences));
      }
      const audit = window.__portraitAudit = { starts: 0, playing: 0, frames: [], voice: null };
      const start = AudioBufferSourceNode.prototype.start;
      const stop = AudioBufferSourceNode.prototype.stop;
      const active = new WeakSet();
      AudioBufferSourceNode.prototype.start = function (...args) {
        audit.starts++; audit.playing++; active.add(this);
        this.addEventListener('ended', () => { if (active.delete(this)) audit.playing--; }, {once:true});
        return start.apply(this,args);
      };
      AudioBufferSourceNode.prototype.stop = function (...args) {
        if (active.delete(this)) audit.playing--;
        return stop.apply(this,args);
      };
      const sample = () => {
        if (audit.voice) {
          const opacity = suffix => {
            const nodes = document.querySelectorAll(`[data-testid="padi-portrait-${audit.voice}-${suffix}"]`);
            return nodes.length ? Number(getComputedStyle(nodes[nodes.length-1]).opacity) : 0;
          };
          audit.frames.push({mouth:opacity('mouth'),blink:opacity('blink'),playing:audit.playing});
          if (audit.frames.length>1000) audit.frames.shift();
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }, preferences);
    page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(120000);
    await page.route(/\/v1\/voice\/(?:call|preview)\?/, async route => {
      const headers = { 'Access-Control-Allow-Origin': new URL(frontend).origin,
        'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      await new Promise(resolve => setTimeout(resolve, 500));
      await route.fulfill({ status: 200, contentType: 'application/json',
        headers,
        body: JSON.stringify({ audio_base64: audio, mime_type: 'audio/wav', text: 'Please continue.' }) });
    });
    if (!idleOnly) {
    await page.goto(`${frontend}/settings`);
    await page.getByText('Voice', { exact: true }).last().click();
    for (const [id, name] of [['ada', 'Ada'], ['chidi', 'Chidi'], ['zainab', 'Zainab'], ['baby', 'PADI'], ['tunde', 'Tunde'], ['amara', 'Amara']]) {
      const row = page.getByRole('radio', { name: new RegExp(`^${name},`) });
      await row.scrollIntoViewIfNeeded();
      const before = await page.evaluate(id => {
        const audit=window.__portraitAudit;audit.voice=id;audit.frames=[];return audit.starts;
      },id);
      await row.click();
      await page.waitForFunction(id => JSON.parse(localStorage.getItem('app:v1:preferences')).voiceId === id, id);
      const mouth = row.getByTestId(`padi-portrait-${id}-mouth`);
      await page.waitForFunction(before => window.__portraitAudit.starts>before,before);
      await page.waitForFunction(() => window.__portraitAudit.frames.some(frame=>frame.playing>0&&frame.mouth>.1));
      await page.waitForFunction(() => {
        const frames=window.__portraitAudit.frames;
        const talking=frames.findIndex(frame=>frame.playing>0&&frame.mouth>.1);
        return talking>=0&&frames.slice(talking+10).some(frame=>frame.playing>0&&frame.mouth===0);
      });
      const frames=await page.evaluate(()=>window.__portraitAudit.frames);
      assert.ok(frames.some(frame=>frame.blink>.8&&!frame.playing),`${name} visibly blinks on touch before audio starts`);
      assert.ok(frames.filter(frame=>!frame.playing).every(frame=>frame.mouth===0),'Preparing audio leaves the lips at rest');
      await page.getByText('“Please continue.”', {exact:true}).waitFor();
      await page.getByRole('button', { name: 'Stop preview', exact: true }).click();
      assert.equal(await mouth.evaluate(element => Number(getComputedStyle(element).opacity)),0,'Stopping playback restores resting lips');
      console.log(`PASS: ${name} tap greets, blinks before speech, opens lips during speech and closes during silence/stop.`);
    }
    await page.getByRole('radio',{name:/^Ada,/}).click();
    await page.waitForFunction(()=>window.__portraitAudit.playing>0);
    await page.screenshot({ path: '/tmp/my-padi-portrait-motion/picker.png' });
    }
    await page.goto(`${frontend}/voice`);
    const portrait = page.getByRole('button', { name: 'Ada portrait, PADI idle', exact: true });
    await portrait.waitFor();
    if (!idleOnly) {
      const before=await page.evaluate(()=>window.__portraitAudit.starts);
      await portrait.click();
      await page.getByRole('alert').filter({hasText:/Sign in to talk with PADI/}).waitFor();
      assert.equal(await page.evaluate(()=>window.__portraitAudit.starts),before,'Signed-out portrait taps do not play speech or open a conversation');
      assert.equal(await page.getByRole('button',{name:'Tap to chat',exact:true}).count(),0,'The portrait is the voice interaction');
    }
    assert.equal(await transformChanges(page.getByTestId('padi-portrait-ada-face')), true);
    await page.screenshot({ path: '/tmp/my-padi-portrait-motion/live.png' });
    await page.setViewportSize({ width: 360, height: 740 });
    const box = await portrait.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 360, 'Live portrait fits a small phone');
    await page.screenshot({ path: '/tmp/my-padi-portrait-motion/live-small.png' });
    assert.deepEqual(errors, []);
    console.log('PASS: live portrait reacts to touch, fits a small phone, and renders without browser errors.');
  } catch (error) {
    await page?.screenshot({ path: '/tmp/my-padi-portrait-motion/browser-failure.png' });
    console.error('Browser errors:', errors);
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
