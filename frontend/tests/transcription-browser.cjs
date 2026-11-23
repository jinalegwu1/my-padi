// Actual exported PADI application + Chromium microphone/MediaRecorder + Go +
// Python + local Whisper. Only checked-in public/synthetic fixtures are used.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createServer } = require('node:http');
const { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, rmSync } = require('node:fs');
const { join, resolve, extname } = require('node:path');
const { tmpdir } = require('node:os');
const { mkdtempSync } = require('node:fs');
const { chromium } = require('playwright-core');
const { loadTS } = require('./helpers/load-ts.cjs');
const { wavAudio } = loadTS('src/lib/voice-activity.ts');

const root = resolve(__dirname, '../..');
const session = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const apiURL = process.env.PADI_TRANSCRIPTION_API_URL;
const pythonURL = process.env.PADI_TRANSCRIPTION_PYTHON_URL;
const port = Number(process.env.PADI_TRANSCRIPTION_FRONTEND_PORT);
const web = process.env.PADI_TRANSCRIPTION_WEB_DIRECTORY;
const origin = 'http://127.0.0.1:' + port;
const fixtureDirectory = join(__dirname, 'fixtures');
const fixtures = JSON.parse(readFileSync(join(fixtureDirectory, 'transcription.json'), 'utf8'));
const temporary = mkdtempSync(join(tmpdir(), 'padi-public-browser-voice-'));
const reports = [];
let server, browser;

function command(binary, args, cwd, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd, env, stdio: 'inherit' });
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error('PADI web export failed.')));
  });
}
function pcm(path) {
  const bytes = readFileSync(path);
  assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(offset + 4);
    if (bytes.subarray(offset, offset + 4).toString() === 'data') return new Uint8Array(bytes.subarray(offset + 8, offset + 8 + size));
    offset += 8 + size + size % 2;
  }
  throw new Error('Public PCM fixture lacks an audio data chunk.');
}
function variant(input, leading = 0, trailing = 0, noisy = false) {
  const result = new Uint8Array(leading * 32000 + input.length + trailing * 32000);
  result.set(input, leading * 32000);
  if (noisy) {
    const view = new DataView(result.buffer);
    let squared = 0;
    for (let index = 0; index < result.length; index += 2) squared += view.getInt16(index, true) ** 2;
    const amplitude = Math.sqrt(squared / (result.length / 2)) / 10 ** (15 / 20);
    let seed = 20261123;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed + 1) / 4294967297; };
    for (let index = 0; index < result.length; index += 2) {
      const gaussian = Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random());
      view.setInt16(index, Math.max(-32768, Math.min(32767, Math.round(view.getInt16(index, true) + gaussian * amplitude))), true);
    }
  }
  return result;
}
function accuracy(reference, observed) {
  const words = value => value.toLocaleLowerCase('en').match(/[\p{L}\p{N}_]+/gu) ?? [];
  const expected = words(reference), actual = words(observed);
  let previous = Array.from({ length: actual.length + 1 }, (_, index) => index);
  expected.forEach((word, i) => {
    const row = [i + 1]; actual.forEach((other, j) => row.push(Math.min(row[j] + 1, previous[j + 1] + 1, previous[j] + Number(word !== other)))); previous = row;
  });
  return { word_errors: previous.at(-1), reference_words: expected.length, word_error_rate: previous.at(-1) / Math.max(1, expected.length) };
}
async function until(predicate, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error('Timed out waiting for voice processing state.');
}
async function launch(input, mode = 'normal') {
  const path = join(temporary, 'public-input.wav');
  // Extra tail prevents looped fake hardware from repeating the next sentence.
  writeFileSync(path, wavAudio({ pcm: variant(input, .75, 1.5), sampleRate: 16000 }));
  browser = await chromium.launch({
    ...(process.env.PADI_VOICE_BROWSER_EXECUTABLE ? { executablePath: process.env.PADI_VOICE_BROWSER_EXECUTABLE } : { channel: 'chrome' }),
    headless: true, args: ['--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + path, '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({ permissions: mode === 'denied' ? [] : ['microphone'] });
  await context.addInitScript(({ session, mode }) => {
    sessionStorage.setItem('padi.auth.session.v1', JSON.stringify(session));
    const NativeRecorder = window.MediaRecorder;
    window.voiceEncoding = { bytes: 0, chunks: 0, mime: '', microphoneRequests: 0 };
    window.voiceTracks = [];
    window.MediaRecorder = class extends NativeRecorder {
      constructor(...args) {
        super(...args); voiceEncoding.bytes = 0; voiceEncoding.chunks = 0; voiceEncoding.mime = this.mimeType;
        this.addEventListener('dataavailable', event => { voiceEncoding.bytes += event.data.size; voiceEncoding.chunks++; });
      }
    };
    if (mode === 'unsupported') window.MediaRecorder.isTypeSupported = () => false;
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      voiceEncoding.microphoneRequests++;
      const stream = await capture(constraints); voiceTracks.push(...stream.getTracks()); return stream;
    };
  }, { session, mode });
  const page = await context.newPage();
  const uploads = [], forbidden = [];
  page.on('request', request => {
    if (/\/v1\/chat(?:\?|$)|\/v1\/voice\/(speak|call|welcome)(?:\?|$)/.test(request.url())) forbidden.push(request.url());
    if (request.url().includes('/v1/voice/transcribe')) uploads.push(request);
  });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
    return route.continue();
  });
  await page.goto(origin + '/voice?mode=transcribe');
  await page.getByRole('button', { name: 'Start recording', exact: true }).waitFor();
  await until(() => page.getByRole('button', { name: 'Start recording', exact: true }).isEnabled(), 60000);
  return { page, uploads, forbidden, async close() { await context.close(); await browser.close(); browser = undefined; } };
}
async function record(f, input, language) {
  const page = f.page;
  const label = language === 'pcm-NG' ? 'Nigerian Pidgin' : language === 'auto' ? 'Automatic' : 'English';
  await page.getByRole('button', { name: 'Recognition language: ' + label, exact: true }).click();
  await page.getByRole('button', { name: /^(Start recording|Record another sentence)$/ }).click();
  await page.getByRole('button', { name: 'Stop and transcribe', exact: true }).waitFor();
  await page.waitForTimeout(input.length / 32 + 1600);
  const response = page.waitForResponse(response => response.url().includes('/v1/voice/transcribe'), { timeout: 210000 });
  const started = Date.now();
  await page.getByRole('button', { name: 'Stop and transcribe', exact: true }).click();
  const received = await response;
  const result = await received.json();
  assert.equal(received.status(), 200, 'Local speech service must return real recognised words: ' + (result.error ?? ''));
  await page.getByTestId('voice-transcript').waitFor({ timeout: 10000 });
  assert.equal(await page.getByTestId('voice-transcript').innerText(), result.text);
  assert.equal(result.user_id, session.user.id);
  assert.equal(result.codec, 'opus'); assert.equal(result.container, 'webm');
  assert.equal(result.sample_rate, 16000); assert.equal(result.channels, 1);
  assert.ok(result.text.trim()); assert.ok(result.transcription_ms > 0);
  const measured = await page.evaluate(() => voiceEncoding);
  assert.equal(measured.bytes, result.audio_bytes, 'Measured browser encoder bytes must match bytes received by Python.');
  assert.match(measured.mime, /^audio\/webm/); assert.ok(measured.chunks > 0);
  assert.equal(f.forbidden.length, 0, 'The incoming transcript must not be sent to AI or TTS.');
  await page.getByRole('button', { name: 'Audio details', exact: true }).click();
  assert.match(await page.locator('body').innerText(), /Validated format: webm \/ opus/);
  await page.getByRole('button', { name: 'Audio details', exact: true }).click();
  return { ...result, total_after_stop_ms: Date.now() - started, browser_compressed_bytes: measured.bytes,
    compression_ratio: result.decoded_pcm_bytes / result.audio_bytes, compression_saving_percent: 100 * (1 - result.audio_bytes / result.decoded_pcm_bytes) };
}

(async () => {
  assert.ok(apiURL && pythonURL && port && web, 'Run through npm run verify:transcription.');
  console.log('Exporting the actual PADI web app for local-only browser verification.');
  await command(process.execPath, [join(root, 'frontend/node_modules/expo/bin/cli'), 'export', '--platform', 'web', '--output-dir', web, '--clear'], join(root, 'frontend'), { PATH: process.env.PATH, EXPO_PUBLIC_API_URL: apiURL, CI: '1', BROWSER: 'none' });
  server = createServer((request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, origin).pathname);
      let path = resolve(web, '.' + pathname);
      if (!path.startsWith(resolve(web) + '/') && path !== resolve(web)) { response.writeHead(404); response.end(); return; }
      if (!existsSync(path) || !statSync(path).isFile()) path = join(web, 'index.html');
      const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };
      response.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream'); response.end(readFileSync(path));
    } catch { response.writeHead(400); response.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  for (const fixture of fixtures) {
    const input = pcm(join(fixtureDirectory, fixture.file)); const f = await launch(input);
    try {
      const result = await record(f, input, fixture.language);
      const row = { ...result, fixture: fixture.id, reference: fixture.reference, ...accuracy(fixture.reference, result.text) };
      if (fixture.id === 'short-sentence') assert.equal(row.word_error_rate, 0, 'The known short sentence must match its spoken words.');
      if (fixture.id === 'clear-english') assert.ok(row.word_error_rate <= .15, 'Clear English recognition differs materially from its spoken words.');
      reports.push(row); console.log(JSON.stringify(row));
      if (fixture.id === 'short-sentence') {
        const repeated = await record(f, input, fixture.language);
        assert.equal(accuracy(fixture.reference, repeated.text).word_error_rate, 0);
        console.log('PASS record another sentence; no stale transcript or audio measurement.');
      }
    } finally { await f.close(); }
  }
  const source = fixtures.find(item => item.id === 'nigerian-english-short');
  for (const mode of ['speech-with-silence', 'noisy-speech']) {
    const input = variant(pcm(join(fixtureDirectory, source.file)), mode === 'speech-with-silence' ? 1 : 0, mode === 'speech-with-silence' ? 1 : 0, mode === 'noisy-speech');
    const f = await launch(input);
    try { const row = { ...await record(f, input, 'en'), fixture: mode, reference: source.reference }; Object.assign(row, accuracy(source.reference, row.text)); reports.push(row); console.log(JSON.stringify(row)); }
    finally { await f.close(); }
  }
  for (const mode of ['denied', 'unsupported']) {
    const f = await launch(new Uint8Array(32000), mode);
    try {
      await f.page.getByRole('button', { name: 'Start recording', exact: true }).click();
      const error = f.page.getByRole('alert'); await error.waitFor();
      assert.match(await error.innerText(), mode === 'denied' ? /permission.*denied/i : /cannot record supported compressed audio/i);
      assert.equal(f.uploads.length, 0); if (mode === 'unsupported') assert.equal(await f.page.evaluate(() => voiceEncoding.microphoneRequests), 0);
      console.log('PASS browser error handling: ' + mode);
    } finally { await f.close(); }
  }
  const silent = await launch(new Uint8Array(64000));
  try {
    await silent.page.getByRole('button', { name: 'Start recording', exact: true }).click();
    await silent.page.getByRole('button', { name: 'Stop and transcribe', exact: true }).waitFor();
    await silent.page.waitForTimeout(2500); await silent.page.getByRole('button', { name: 'Stop and transcribe', exact: true }).click();
    await silent.page.getByRole('alert').waitFor(); assert.match(await silent.page.getByRole('alert').innerText(), /No clear speech/);
    assert.equal(silent.uploads.length, 0); console.log('PASS silent recording is rejected before upload.');
  } finally { await silent.close(); }
  const input = pcm(join(fixtureDirectory, source.file)); const f = await launch(input);
  try {
    await f.page.getByRole('button', { name: 'Start recording', exact: true }).click(); await f.page.getByRole('button', { name: 'Stop and transcribe', exact: true }).waitFor();
    await f.page.waitForTimeout(input.length / 32 + 1600); await f.page.getByRole('button', { name: 'Stop and transcribe', exact: true }).click();
    await until(async () => (await (await fetch(pythonURL + '/health')).json()).recognition.active_requests === 1);
    await f.page.getByRole('button', { name: 'Cancel processing', exact: true }).click();
    await until(async () => (await (await fetch(pythonURL + '/health')).json()).recognition.active_requests === 0, 5000);
    assert.equal(await f.page.getByTestId('voice-transcript').count(), 0);
    await f.page.waitForTimeout(500); assert.equal(await f.page.getByTestId('voice-transcript').count(), 0);
    console.log('PASS browser → Go → Python cancellation; abandoned inference released.');
  } finally { await f.close(); }
  const interrupted = await launch(input);
  try {
    await interrupted.page.getByRole('button', { name: 'Start recording', exact: true }).click();
    await interrupted.page.getByRole('button', { name: 'Stop and transcribe', exact: true }).waitFor();
    await interrupted.page.getByRole('button', { name: 'Close voice', exact: true }).click();
    await until(() => interrupted.page.evaluate(() => voiceTracks.every(track => track.readyState === 'ended')));
    assert.equal(interrupted.uploads.length, 0); console.log('PASS navigating away stops the microphone without uploading.');
  } finally { await interrupted.close(); }
  const corrupted = await launch(input);
  try {
    await corrupted.page.route(apiURL + '/v1/voice/transcribe*', route => {
      const request = route.request(); const body = request.postDataBuffer();
      const boundary = /boundary=(.+)$/.exec(request.headers()['content-type'])[1];
      const begin = body.indexOf('\r\n\r\n') + 4; const end = body.indexOf(Buffer.from('\r\n--' + boundary), begin);
      assert.ok(begin > 4 && end > begin);
      const broken = Buffer.concat([body.subarray(0, begin), Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(32), body.subarray(end)]);
      const headers = { ...request.headers() }; delete headers['content-length'];
      return route.continue({ postData: broken, headers });
    });
    await corrupted.page.getByRole('button', { name: 'Start recording', exact: true }).click();
    await corrupted.page.getByRole('button', { name: 'Stop and transcribe', exact: true }).waitFor();
    await corrupted.page.waitForTimeout(input.length / 32 + 1600);
    const response = corrupted.page.waitForResponse(response => response.url().includes('/v1/voice/transcribe'));
    await corrupted.page.getByRole('button', { name: 'Stop and transcribe', exact: true }).click();
    assert.equal((await response).status(), 400);
    await corrupted.page.getByRole('alert').waitFor(); assert.match(await corrupted.page.getByRole('alert').innerText(), /empty or damaged/);
    assert.equal(await corrupted.page.getByTestId('voice-transcript').count(), 0); console.log('PASS Python decode failure produces a clear PADI error.');
  } finally { await corrupted.close(); }
  if (process.env.PADI_TRANSCRIPTION_REPORT_PATH) writeFileSync(process.env.PADI_TRANSCRIPTION_REPORT_PATH, JSON.stringify(reports, null, 2) + '\n');
  console.log('PASS incoming pipeline: ' + reports.length + ' real speech/codec/display cases plus permission, unsupported-format and cancellation checks.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); rmSync(temporary, { recursive: true, force: true });
});
