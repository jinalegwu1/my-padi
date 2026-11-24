import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const mode = process.argv.includes('--echo-stress')?'echo-stress':process.argv.includes('--stress')?'stress':process.argv.includes('--echo-diagnostics')?'diagnostic':process.argv.includes('--interruptions') ? 'interruptions' : process.argv.includes('--baseline') ? 'baseline' : 'fixed';
const directory = mkdtempSync(join(tmpdir(), 'padi-playback-driver-'));
const driver = join(directory, 'driver.cjs');
const env = { ...parseEnv(readFileSync(join(root, 'backend/.env'), 'utf8')), ...process.env };
if (env.PADI_ENV !== 'development') throw new Error('Playback verification requires development mode.');
const check=['stress','echo-stress','interruptions','diagnostic'].includes(mode)?'voice-interruption-browser.cjs':'voice-playback-browser.cjs';
writeFileSync(driver, `require(${JSON.stringify(join(root, 'frontend/tests',check))}).verify(${JSON.stringify(mode)}, process.argv[2]);\n`);
env.PADI_VERIFY_VOICE_BROWSER = '1';
env.PADI_VOICE_BROWSER_SCRIPT = driver;
env.PADI_VOICE_API_URL = `http://127.0.0.1:${(env.PADI_HTTP_ADDR || ':8080').match(/:(\d+)$/)[1]}`;
env.PADI_VOICE_FRONTEND_URL ||= 'http://localhost:8081';
console.log(`Measuring ${mode} voice playback with real Groq text and speech. Gemini speech requests are blocked.`);
const child = spawn('go', ['test', '-count=1', '-timeout=8m', '-v', '-run', '^TestHandsfreeBrowser$', './internal/httpapi'], {
  cwd: join(root, 'backend'), env, stdio: 'inherit',
});
child.once('exit', code => { rmSync(directory, { recursive: true, force: true }); process.exitCode = code ?? 1; });
