import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixtureURL = 'https://raw.githubusercontent.com/ggml-org/whisper.cpp/master/samples/jfk.wav';

try {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--browser', '--failures-only'].includes(arg)) || new Set(args).size !== args.length || (args.includes('--failures-only') && !args.includes('--browser'))) {
    throw new Error('Use npm run verify:voice or npm run verify:voice:browser.');
  }
  const browser = args.includes('--browser');
  const failuresOnly = args.includes('--failures-only');
  const env = { ...parseEnv(readFileSync(join(root, 'backend', '.env'), 'utf8')), ...process.env };
  if (env.PADI_ENV !== 'development') throw new Error('Live voice verification requires a development environment.');
  if (env.PADI_STT_ENABLED !== 'true' || env.PADI_PYTHON_VOICE_ENABLED !== 'true') {
    throw new Error('Enable the configured transcription and Python voice services before live verification.');
  }
  const backendPort = (env.PADI_HTTP_ADDR || ':8080').match(/:(\d+)$/)?.[1];
  if (!backendPort) throw new Error('The configured backend port is invalid.');
  const apiURL = `http://127.0.0.1:${backendPort}`;
  const response = await fetch(`${apiURL}/v1/voice/config`, { signal: AbortSignal.timeout(5000) });
  const configuration = await response.json();
  if (!response.ok || !configuration.enabled || !configuration.natural_speech) {
    throw new Error('Start the configured Go and Python voice services with npm run dev first.');
  }

  const fixture = env.PADI_VOICE_TEST_AUDIO_PATH || join(tmpdir(), 'my-padi-public-jfk.wav');
  if (!existsSync(fixture)) {
    console.log('Downloading the public JFK speech fixture; personal microphone audio is not used.');
    const download = await fetch(fixtureURL, { signal: AbortSignal.timeout(30000) });
    if (!download.ok) throw new Error('The public speech fixture could not be downloaded.');
    const audio = Buffer.from(await download.arrayBuffer());
    if (audio.length > 1024 * 1024 || audio.subarray(0, 4).toString() !== 'RIFF' || audio.subarray(8, 12).toString() !== 'WAVE') {
      throw new Error('The downloaded speech fixture is invalid.');
    }
    writeFileSync(fixture, audio, { mode: 0o600, flag: 'wx' });
  }
  const audio = readFileSync(fixture);
  if (audio.length > 1024 * 1024 || audio.subarray(0, 4).toString() !== 'RIFF') throw new Error('Use the documented public WAV fixture.');

  Object.assign(env, {
    PADI_VOICE_TEST_AUDIO_PATH: fixture,
    PADI_VOICE_API_URL: apiURL,
    PADI_VOICE_FRONTEND_URL: env.PADI_VOICE_FRONTEND_URL || `http://localhost:${env.PADI_FRONTEND_PORT || '8081'}`,
    PADI_VOICE_BROWSER_SCRIPT: join(root, 'frontend', 'tests', 'voice-browser.cjs'),
    PADI_VOICE_BROWSER_FAILURES_ONLY: failuresOnly ? '1' : '0',
    [browser ? 'PADI_VERIFY_VOICE_BROWSER' : 'PADI_VERIFY_VOICE_LIVE']: '1',
  });
  console.log(failuresOnly ? 'Checking denied microphone permission and a controlled service failure.' : browser ? 'Checking the real browser voice flow with a temporary account.' : 'Checking authenticated transcription, AI replies, and real speech with a temporary account.');
  const child = spawn('go', ['test', '-count=1', '-timeout=8m', '-v', '-run', browser ? '^TestHandsfreeBrowser$' : '^TestVoiceLiveTranscriptionAndChat$', './internal/httpapi'], {
    cwd: join(root, 'backend'), env, stdio: 'inherit',
  });
  child.once('error', () => { console.error('Go could not start; install Go 1.22 or later.'); process.exitCode = 1; });
  child.once('exit', code => { process.exitCode = code ?? 1; });
} catch (error) {
  console.error(error instanceof Error && error.message.includes('backend/.env') ? 'Prepare backend/.env before live voice verification.' : error.message);
  process.exitCode = 1;
}
