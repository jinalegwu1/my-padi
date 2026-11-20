// Run with the existing isolated browser-session harness. Chat replies are
// controlled here to test keyboard behaviour without generating AI or speech.
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { chromium } = require('playwright-core');

const session = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const frontend = process.env.PADI_VOICE_FRONTEND_URL || 'http://localhost:8081';
const executablePath = process.env.PADI_VOICE_BROWSER_EXECUTABLE ||
  ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(existsSync);

(async () => {
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext();
    await context.addInitScript(session => {
      sessionStorage.setItem('padi.auth.session.v1', JSON.stringify(session));
      localStorage.setItem('app:v1:preferences', JSON.stringify({
        onboarded: true, countryCode: 'NG', languageCode: 'en-NG', displayName: 'Keyboard verification',
        appearance: 'light', textScale: 1, reduceMotion: true, highContrast: false,
        voiceId: 'baby', voiceRate: 1, notificationsEnabled: false, dailyCheckIn: false,
        checkInTime: '08:00', showVoiceTranscript: true,
      }));
      localStorage.setItem('app:v1:chat-messages', '[]');
    }, session);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.setDefaultNavigationTimeout(120000);
    const sends = [];
    let hold = false, release, fail = false;
    await page.route('**/v1/chat', async route => {
      const request = route.request().postDataJSON();
      sends.push(request.messages.at(-1).content);
      if (hold) await new Promise(resolve => { release = resolve; });
      await route.fulfill({ status: fail ? 503 : 200, contentType: 'application/json', body: JSON.stringify(fail
        ? { error: 'controlled_test_failure', message: 'The test service is unavailable.' }
        : { reply: 'Keyboard test reply.', memory_revision: 0 }) });
    });
    // Opening chat and pressing Enter must never open a microphone or generate speech.
    await page.route('**/v1/voice/speak', () => assert.fail('keyboard chat generated speech'));
    await page.goto(frontend + '/chat');
    const input = page.locator('textarea').first();
    await input.fill('Enter sends this message');
    await input.press('Enter');
    await page.waitForFunction(() => document.querySelector('textarea')?.value === '');
    assert.deepEqual(sends, ['Enter sends this message']);

    await input.fill('First line');
    await input.press('Shift+Enter');
    await input.pressSequentially('Second line');
    assert.equal(await input.inputValue(), 'First line\nSecond line');
    assert.equal(sends.length, 1);
    await input.press('Enter');
    await page.waitForFunction(() => document.querySelector('textarea')?.value === '');
    assert.equal(sends[1], 'First line\nSecond line');

    hold = true;
    await input.fill('Pending message');
    await input.press('Enter');
    while (!release) await new Promise(resolve => setTimeout(resolve, 20));
    await input.fill('Next draft');
    await input.press('Enter');
    assert.equal(sends.length, 3);
    hold = false; release();
    await page.waitForFunction(() => !JSON.parse(localStorage.getItem('app:v1:chat-messages') || '[]').some(message => message.pending));
    assert.equal(await input.inputValue(), 'Next draft');

    fail = true;
    await input.press('Enter');
    await page.getByRole('alert').filter({ hasText: 'The test service is unavailable.' }).waitFor();
    assert.equal(await input.inputValue(), 'Next draft');
    console.log('PASS: browser Enter sends once, Shift+Enter adds a line, and pending/failed sends preserve the draft.');
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
