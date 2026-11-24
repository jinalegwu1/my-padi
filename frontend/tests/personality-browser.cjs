// Focused checks of the real greeting screens and configured model responses.
// No chat/TTS responses are mocked; only silent microphone input is supplied.
const assert = require('node:assert/strict');
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require('playwright-core');

exports.verify = async (sessionFile, greetingsOnly = false, reviewOnly = false, textReviewOnly = false) => {
  const frontend = process.env.PADI_VOICE_FRONTEND_URL || 'http://localhost:8081';
  const api = process.env.PADI_VOICE_API_URL || 'http://127.0.0.1:8080';
  const session = JSON.parse(readFileSync(sessionFile, 'utf8'));
  const folder = '/tmp/my-padi-personality';
  const evidenceFile = join(folder, textReviewOnly?'text-correction-review.json':reviewOnly ? 'final-review.json' : greetingsOnly ? 'greetings.json' : 'verification.json');
  mkdirSync(folder, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const evidence = { greetings: [], greetingRequests: [], conversations: [], speechRequests: [], playback: [] };
  try {
    const context = await browser.newContext({ viewport: { width: 430, height: 900 } });
    await context.grantPermissions(['microphone'], { origin: frontend });
    await context.addInitScript(({ session }) => {
      sessionStorage.setItem('padi.auth.session.v1', JSON.stringify(session));
      if (!localStorage.getItem('padi.personality.fixture')) {
      localStorage.setItem('app:v1:preferences', JSON.stringify({ onboarded: true, voiceId: 'ada', voiceRate: 1,
        languageCode: 'en-NG', appearance: 'light', reduceMotion: true, wakeWordEnabled: false,
        autoSpeakReplies: false, showVoiceTranscript: false, displayName: 'Personality check', textScale: 1 }));
      localStorage.setItem('app:v1:chat-messages', '[]');
      localStorage.setItem('padi.personality.fixture', 'initialized');
      }
      window.__personalityAudio = [];
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args) {
        const clip = { at: Date.now(), duration: this.buffer.duration, ended: false };
        window.__personalityAudio.push(clip);
        this.addEventListener('ended', () => { clip.ended = true; });
        return start.apply(this, args);
      };
      navigator.mediaDevices.getUserMedia = async () => {
        const input = new AudioContext();
        const destination = input.createMediaStreamDestination();
        destination.stream.getTracks().forEach(track => {
          const stop = track.stop.bind(track);
          track.stop = () => { stop(); void input.close(); };
        });
        return destination.stream;
      };
    }, { session });
    const page = await context.newPage();
    page.on('request', request => {
      if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/v1/chat') return;
      const body = request.postDataJSON();
      if (body.greeting) evidence.greetingRequests.push({ delivery: body.delivery, prompt: body.messages.at(-1).content });
    });
    page.setDefaultTimeout(60000);
    const headers = { Authorization: `Bearer ${session.token}` };
    const conversations = { text: [], voice: [] };
    let memoryRevision=0;
    let selectedHumour;
    const preferences = async humour => {
      if (selectedHumour === humour) return;
      const result = await page.request.patch(`${api}/v1/personality/preferences`, { headers, data: { humour, tone: 'adaptive' } });
      assert.equal(result.status(), 200);
      selectedHumour = humour;
    };
    const conversation = async (name, user, humour, delivery = 'text') => {
      await preferences(humour);
      const casual = ['ordinary', 'everyday', 'user-joke', 'teasing', 'natural-laughter', 'independent-observation', 'sarcasm'].includes(name);
      const prior = casual ? conversations[delivery] : [];
      const response = await page.request.post(`${api}/v1/chat`, { headers, data: {
        messages: [...prior, { role: 'user', content: user }], delivery, memory_revision:memoryRevision, ...(delivery === 'voice' ? { stream: true, language: 'en-NG' } : {}),
      } });
      assert.equal(response.status(), 200, `${name} returned a complete model response`);
      let reply;
      if (delivery === 'voice') {
        const done = (await response.text()).match(/event: done\r?\ndata: (.+)/);
        assert.ok(done, `${name} voice response completed without a provider error`);
        const result=JSON.parse(done[1]);reply=result.reply;memoryRevision=result.memory_revision;
      } else { const result=await response.json();reply=result.reply;memoryRevision=result.memory_revision; }
      assert.ok(reply.trim());
      const result = { name, humour, delivery, user, reply };
      if (casual) conversations[delivery] = [...prior, { role: 'user', content: user }, { role: 'assistant', content: reply }].slice(-10);
      evidence.conversations.push(result);
      writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2));
      return result;
    };
    if (reviewOnly||textReviewOnly) {
      const reviewScenarios=textReviewOnly?[
        ['ordinary', "I'm spending Sunday doing laundry and listening to music. I've decided the folding can wait until this album finishes.",'occasional','text'],
        ['user-joke', "I set five alarms and negotiated with every single one. I think my morning self has a very promising career in diplomacy.",'occasional','text'],
        ['teasing', "PADI, even my kettle gets to the point faster than you. At this rate I'll have finished my tea before you've finished a sentence.",'occasional','text'],
        ['sarcasm', "Wonderful. My printer only works when I don't need to print. Apparently it has its own interpretation of office hours.",'occasional','text'],
        ['humour-off', "I opened the fridge again hoping dinner would appear. I'm hungry and deciding what to make this evening.",'off','text'],
        ['humour-off', "I keep pressing snooze in the morning and would like a calmer start to my day. Please keep this straightforward.",'off','text'],
        ['serious', "My father died yesterday. Please just listen. I don't really know what I want to say yet, but I wanted some company.",'frequent','text'],
      ]:[
        ['user-joke', 'I set five alarms and negotiated with every single one.', 'occasional', 'text'],
        ['teasing', 'PADI, even my kettle gets to the point faster than you.', 'occasional', 'text'],
        ['humour-off', 'I opened the fridge again hoping dinner would appear.', 'off', 'text'],
        ['user-joke', 'I set five alarms and negotiated with every single one.', 'occasional', 'voice'],
        ['teasing', 'PADI, even my kettle gets to the point faster than you.', 'occasional', 'voice'],
        ['serious', 'My father died yesterday. Please just listen.', 'frequent', 'voice'],
      ];
      for (const [name, user, humour, delivery] of reviewScenarios) {
        await page.waitForTimeout(25000);
        await conversation(name, user, humour, delivery);
      }
      console.log(JSON.stringify(evidence, null, 2));
      console.log('PASS: final real-provider response sample completed; quality still requires human review.');
      return;
    }
    await page.route('**/v1/voice/speak', route => {
      if (route.request().method() === 'OPTIONS') return route.continue();
      const body = route.request().postDataJSON();
      evidence.speechRequests.push({ text: body.text, groqOnly: body.groq_only });
      assert.equal(body.groq_only, true, 'Voice greetings must use Groq TTS only');
      return route.continue();
    });
    const history = () => page.evaluate(() => JSON.parse(localStorage.getItem('app:v1:chat-messages') || '[]'));
    let lastGreetingID = '';
    const waitGreeting = async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        await page.waitForFunction(previous => JSON.parse(localStorage.getItem('app:v1:chat-messages') || '[]').some(m => m.role === 'padi' && m.backendChat && !m.pending && m.id !== previous) || document.querySelector('[role="alert"]')?.textContent, lastGreetingID);
        if (!(await page.locator('[role="alert"]').count())) break;
        if (attempt === 2) throw new Error('The configured text provider remained unavailable for greeting verification.');
        await page.waitForTimeout(30000);
        await page.getByRole('button', { name: 'Open PADI menu' }).click();
        await page.getByRole('button', { name: 'New chat. Start a fresh conversation' }).click();
      }
      const messages = await history();
      assert.equal(messages.filter(m => m.role === 'user').length, 0);
      const message = messages.find(m => m.role === 'padi' && !m.pending);
      lastGreetingID = message.id;
      const greeting = message.text;
      await page.getByText(greeting, { exact: false }).first().waitFor();
      assert.ok(!/\b(?:Mrs|Mr|My Lord|Boss|Oga)\b/.test(greeting), 'No assumed age/gender title');
      return greeting;
    };
    await preferences('occasional');
    await page.goto(`${frontend}/chat`, { timeout: 120000 });
    evidence.greetings.push({ delivery: 'text', preference: 'occasional', text: await waitGreeting() });
    await page.getByRole('button', { name: 'Open PADI menu' }).click();
    await page.getByRole('button', { name: 'New chat. Start a fresh conversation' }).click();
    evidence.greetings.push({ delivery: 'text', preference: 'occasional', text: await waitGreeting() });
    assert.notEqual(evidence.greetings[0].text, evidence.greetings[1].text, 'Fresh greeting wording varies');
    await page.goto(`${frontend}/voice`);
    await page.getByRole('button', { name: /portrait, PADI idle$/ }).click();
    await page.waitForFunction(() => __personalityAudio.length || document.querySelector('[role="alert"]')?.textContent);
    assert.deepEqual(await page.locator('[role="alert"]').allTextContents(), []);
    await page.getByRole('button', { name: /portrait, PADI listening$/ }).waitFor();
    evidence.greetings.push({ delivery: 'voice', preference: 'occasional', context: 'first call', text: (await history()).at(-1).text });
    evidence.playback.push(...await page.evaluate(() => __personalityAudio));
    await page.getByRole('button', { name: 'Switch to text' }).click();
    await page.getByRole('button', { name: 'Open PADI menu' }).waitFor();
    await page.waitForTimeout(25000);
    // Use a serious existing conversation to verify a resumed greeting respects it.
    const serious = await conversation('serious', 'My father died yesterday. Please just listen.', 'frequent');
    await page.evaluate(({ serious, session }) => {
      localStorage.setItem('app:v1:chat-messages', JSON.stringify([
        { id: 'user-context', role: 'user', text: serious.user, backendChat: true, backendUserID: session.user.id, memoryRevision: 0, createdAt: Date.now() },
        { id: 'reply-context', role: 'padi', text: serious.reply, backendChat: true, backendUserID: session.user.id, memoryRevision: 0, createdAt: Date.now() },
      ]));
    }, { serious, session });
    await page.goto(`${frontend}/voice`);
    await page.getByRole('button', { name: /portrait, PADI idle$/ }).click();
    await page.waitForFunction(() => __personalityAudio.length || document.querySelector('[role="alert"]')?.textContent);
    const error = await page.locator('[role="alert"]').allTextContents();
    assert.deepEqual(error, [], `Voice greeting failed: ${error.join(' ')}`);
    await page.getByRole('button', { name: /portrait, PADI listening$/ }).waitFor();
    const voiceHistory = await history();
    const voiceGreeting = voiceHistory.at(-1);
    assert.equal(voiceGreeting.viaVoice, true);
    assert.equal(voiceHistory.length, 3, 'Greeting preserves context without a synthetic user turn');
    evidence.greetings.push({ delivery: 'voice', preference: 'frequent', context: 'grief', text: voiceGreeting.text });
    evidence.playback.push(...await page.evaluate(() => __personalityAudio));
    assert.ok(evidence.playback.length && evidence.playback.every(c => c.ended), 'Real greeting audio played completely');
    assert.ok(evidence.speechRequests.length && evidence.speechRequests.every(r => r.groqOnly), 'Only configured Groq speech was used');
    await page.getByRole('button', { name: 'Switch to text' }).click();
    await page.getByRole('button', { name: 'Open PADI menu' }).waitFor();
    assert.equal((await history()).at(-1).text, voiceGreeting.text, 'Spoken greeting remains unchanged in text chat');
    const scenarios = [
      ['ordinary', "I'm spending Sunday doing laundry and listening to music.", 'occasional'],
      ['everyday', "I opened the fridge three times and dinner still hasn't appeared.", 'occasional'],
      ['user-joke', 'My Wi-Fi and I are in a long-distance relationship. We live in the same room.', 'occasional'],
      ['teasing', 'PADI, you talk like you swallowed a dictionary.', 'occasional'],
      ['natural-laughter', 'I died laughing. I tried to unlock my front door with my car key fob.', 'occasional'],
      ['independent-observation', 'I spent ten minutes looking for my glasses. They were on my head.', 'occasional'],
      ['sarcasm', "Wonderful. My printer only works when I don't need to print.", 'occasional'],
      ['serious-question', 'Serious answer please: is it safe to mix bleach and ammonia?', 'frequent'],
      ['explicit-serious', 'Please give me a serious response about preparing for my interview.', 'frequent'],
      ['humour-off', 'I opened the fridge three times and dinner still hasn\'t appeared.', 'off'],
      ['subtle', 'I keep opening the fridge hoping dinner will magically appear.', 'subtle'],
    ];
    for (const [name, user, humour] of greetingsOnly ? [] : scenarios) {
      await page.waitForTimeout(25000);
      await conversation(name, user, humour);
    }
    // These are actual Groq voice-stream requests, not fabricated voice examples.
    // Respect provider quotas between verification requests, never during playback.
    for (const [name, user, humour] of greetingsOnly ? [] : [...scenarios, ['serious', serious.user, 'frequent']]) {
      await page.waitForTimeout(25000);
      await conversation(name, user, humour, 'voice');
    }
    writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence, null, 2));
    console.log('PASS: real first/new text greetings, context-aware spoken greeting, full Groq audio, automatic listening, and return to text. Model output quality requires human review.');
  } finally {
    writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2));
    await browser.close();
  }
};
