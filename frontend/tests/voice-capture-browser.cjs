// Run with: node frontend/tests/voice-capture-browser.cjs
// Uses real Chromium AudioWorklets and fake hardware; never calls AI or TTS.
// PADI_VOICE_CAPTURE_OUTPUT_DIR optionally preserves public WAV test artifacts.
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFileSync, existsSync, mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require('playwright-core');

const captureSource = readFileSync(join(__dirname, '../src/lib/voice-capture.web.js'), 'utf8');
const worklet = captureSource.match(/const worklet = `([\s\S]*?)`;/)[1];
const expose = (name, exported) => {
  const code = readFileSync(join(__dirname, '../src/lib', name), 'utf8');
  return `(function() { const module = {exports:{}}; const require = name => name === 'react-native' ? {Platform:{OS:'web'}} : {}; ${code}\nwindow.${exported} = module.exports.${exported}; })();`;
};
const scripts = [
  expose('voice-capture.web.js', 'VoiceCapture'),
  expose('voice-activity.js', 'wavAudio'),
  expose('voice-audio.js', 'audioUpload'),
].join('\n');
const output = process.env.PADI_VOICE_CAPTURE_OUTPUT_DIR;
if (output) mkdirSync(output, { recursive: true });
const uploads = [];
const server = createServer(async (request, response) => {
  if (request.method === 'GET') {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><button id="start">Start capture</button>');
    return;
  }
  try {
    const url = new URL(request.url, 'http://localhost');
    const name = url.searchParams.get('name');
    assert.match(name, /^[a-z0-9-]+$/);
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const boundary = /boundary=(.*)$/.exec(request.headers['content-type'])[1];
    const start = body.indexOf('\r\n\r\n') + 4;
    const end = body.indexOf(Buffer.from('\r\n--' + boundary), start);
    assert.ok(start > 4 && end > start);
    const bytes = body.subarray(start, end);
    assert.match(body.subarray(0, start).toString(), /name="audio"; filename="voice.wav"/);
    assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
    assert.equal(bytes.subarray(8, 16).toString(), 'WAVEfmt ');
    assert.equal(bytes.readUInt32LE(4), bytes.length - 8);
    assert.equal(bytes.readUInt16LE(20), 1);
    assert.equal(bytes.readUInt16LE(22), 1);
    assert.equal(bytes.readUInt16LE(34), 16);
    assert.equal(bytes.readUInt32LE(40), bytes.length - 44);
    const rate = bytes.readUInt32LE(24);
    assert.equal(bytes.readUInt32LE(28), rate * 2);
    assert.equal(rate, name.endsWith('before') ? Number(url.searchParams.get('rate')) : 16000);
    const result = { name, bytes: bytes.length, sampleRate: rate, seconds: (bytes.length - 44) / (rate * 2) };
    uploads.push(result);
    if (output) writeFileSync(join(output, name + '.wav'), bytes);
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(result));
  } catch (error) {
    response.statusCode = 500;
    response.end(error.message);
  }
});

let browser;
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  try {
    browser = await chromium.launch({
      ...(process.env.PADI_VOICE_BROWSER_EXECUTABLE ? { executablePath: process.env.PADI_VOICE_BROWSER_EXECUTABLE } : { channel: 'chrome' }),
      headless: true, args: ['--use-fake-device-for-media-stream'],
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(origin);
    await page.addScriptTag({ content: scripts });
    const fixtures = [{ name: 'tone10', seconds: 10 }];
    for (const [name, path] of [['continue', join(__dirname, 'fixtures/please-continue.wav')], ['jfk', process.env.PADI_VOICE_TEST_AUDIO_PATH || '/tmp/my-padi-public-jfk.wav']]) {
      if (existsSync(path)) fixtures.push({ name, encoded: readFileSync(path).toString('base64') });
    }
    for (const fixture of fixtures) {
      for (const rate of [44100, 48000, 16000]) {
        const result = await page.evaluate(async ({ fixture, rate, worklet }) => {
          let decoded;
          if (fixture.encoded) {
            const decoder = new OfflineAudioContext(1, rate, rate);
            decoded = await decoder.decodeAudioData(Uint8Array.from(atob(fixture.encoded), c => c.charCodeAt(0)).buffer);
          }
          // Silence lets the finite resampling filter settle after a fixture.
          const seconds = fixture.seconds ?? Math.ceil((decoded.duration + 0.25) * 20) / 20;
          const count = Math.round(seconds * rate);
          const engine = new OfflineAudioContext(1, count, rate);
          const buffer = engine.createBuffer(1, count, rate);
          const samples = buffer.getChannelData(0);
          if (decoded) samples.set(decoded.getChannelData(0));
          else for (let index = 0; index < count; index++) samples[index] = 0.05 * Math.sin(2 * Math.PI * 1000 * index / rate);
          const url = URL.createObjectURL(new Blob([worklet], { type: 'application/javascript' }));
          await engine.audioWorklet.addModule(url);
          URL.revokeObjectURL(url);
          const node = new AudioWorkletNode(engine, 'padi-capture', { channelCount: 1, channelCountMode: 'explicit', outputChannelCount: [1] });
          const frames = [];
          let finish;
          const received = new Promise(resolve => { finish = resolve; });
          node.port.onmessage = ({ data }) => {
            if (data.sampleRate !== 16000 || data.channels !== 1 || data.data.byteLength !== 1600) throw new Error('Invalid worklet PCM frame');
            frames.push(data.data);
            if (frames.length === Math.round(seconds * 20)) finish();
          };
          const source = engine.createBufferSource();
          source.buffer = buffer;
          source.connect(node); node.connect(engine.destination); source.start();
          await engine.startRendering();
          let timeout;
          try { await Promise.race([received, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Worklet frames did not arrive')), 3000); })]); }
          finally { clearTimeout(timeout); }
          node.port.onmessage = null; node.disconnect(); source.disconnect();
          const pcm = new Uint8Array(frames.length * 1600);
          frames.forEach((frame, index) => pcm.set(new Uint8Array(frame), index * 1600));
          const originalPCM = new Uint8Array(samples.length * 2);
          const view = new DataView(originalPCM.buffer);
          for (let index = 0; index < samples.length; index++) view.setInt16(index * 2, Math.max(-32768, Math.min(32767, Math.round(samples[index] * 32767))), true);
          const before = wavAudio({ pcm: originalPCM, sampleRate: rate });
          const after = wavAudio({ pcm, sampleRate: 16000 });
          if (rate === 16000 && (before.length !== after.length || before.some((byte, index) => byte !== after[index]))) throw new Error('16 kHz PCM changed');
          const uploaded = [];
          for (const [kind, bytes] of [['before', before], ['stage1', after]]) {
            const upload = audioUpload(bytes);
            const name = fixture.name + '-' + rate + '-' + kind;
            const response = await fetch('/upload?name=' + name + '&rate=' + rate, { method: 'POST', body: upload.form });
            if (!response.ok) throw new Error(await response.text());
            uploaded.push(await response.json());
            upload.dispose();
          }
          return uploaded;
        }, { fixture, rate, worklet });
        assert.equal(result[1].sampleRate, 16000);
        assert.equal(result[0].seconds, result[1].seconds);
        const saving = 100 * (1 - result[1].bytes / result[0].bytes);
        console.log(`PASS ${fixture.name} ${rate} Hz: ${result[0].bytes} -> ${result[1].bytes} actual multipart audio bytes (${saving.toFixed(2)}% reduction).`);
      }
    }
    await context.close();

    for (const mode of ['direct', 'reject', 'ignore', 'source-reject', 'denied']) {
      const context = await browser.newContext();
      await context.grantPermissions(mode === 'denied' ? [] : ['microphone'], { origin });
      const page = await context.newPage();
      await page.goto(origin);
      await page.addScriptTag({ content: scripts });
      await page.evaluate(mode => {
        const BaseContext = AudioContext;
        const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        const state = window.captureCheck = { frames: [], contexts: [], tracks: [], attempts: [], interrupted: 0 };
        navigator.mediaDevices.getUserMedia = async constraints => {
          state.constraints = constraints;
          const stream = await getUserMedia(constraints);
          state.tracks.push(...stream.getTracks());
          return stream;
        };
        window.AudioContext = class extends BaseContext {
          constructor(options) {
            state.attempts.push(options?.sampleRate ?? null);
            if (mode === 'reject' && options?.sampleRate === 16000) throw new DOMException('Unsupported rate', 'NotSupportedError');
            super(mode === 'ignore' || !options ? { sampleRate: 48000 } : options);
            state.contexts.push(this);
          }
          createMediaStreamSource(stream) {
            if (mode === 'source-reject' && this.sampleRate === 16000) throw new DOMException('Microphone rate mismatch', 'NotSupportedError');
            return super.createMediaStreamSource(stream);
          }
        };
        state.controller = new AbortController();
        state.capture = new VoiceCapture(frame => state.frames.push(frame), () => { state.interrupted++; state.controller.abort(); });
        document.querySelector('button').onclick = () => { void state.capture.start(state.controller.signal).catch(error => { state.error = error.message; }); };
      }, mode);
      await page.locator('button').click();
      if (mode === 'denied') {
        await page.waitForFunction(() => !!captureCheck.error);
        const state = await page.evaluate(() => ({ frames: captureCheck.frames.length, tracks: captureCheck.tracks.length, closed: captureCheck.contexts.every(context => context.state === 'closed') }));
        assert.deepEqual(state, { frames: 0, tracks: 0, closed: true });
      } else {
        await page.waitForFunction(() => captureCheck.frames.length >= 5);
        const state = await page.evaluate(async () => {
          const f = captureCheck;
          const valid = f.frames.every(frame => frame.sampleRate === 16000 && frame.channels === 1 && frame.data.byteLength === 1600);
          f.tracks[0].dispatchEvent(new Event('ended'));
          await f.capture.stop();
          return { valid, interrupted: f.interrupted, closed: f.contexts.every(context => context.state === 'closed'), stopped: f.tracks.every(track => track.readyState === 'ended'), attempts: f.attempts, constraints: f.constraints.audio };
        });
        assert.equal(state.valid, true); assert.equal(state.interrupted, 1);
        assert.equal(state.closed, true); assert.equal(state.stopped, true);
        assert.deepEqual(state.constraints, { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true });
        assert.deepEqual(state.attempts, [null]);
      }
      console.log(`PASS real browser capture: ${mode}, PCM format and microphone cleanup.`);
      await context.close();
    }
    if (output) writeFileSync(join(output, 'uploads.json'), JSON.stringify(uploads, null, 2));
    console.log('Browser capture checks passed. Physical microphone behavior and live recognition are separate checks.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
