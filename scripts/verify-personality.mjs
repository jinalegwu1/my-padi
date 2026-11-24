import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const env = { ...parseEnv(readFileSync(join(root, 'backend/.env'), 'utf8')), ...process.env };
if (env.PADI_ENV !== 'development') throw new Error('Personality verification requires development mode.');
const directory = mkdtempSync(join(tmpdir(), 'padi-personality-driver-'));
const driver = join(directory, 'driver.cjs');
writeFileSync(driver, `require(${JSON.stringify(join(root, 'frontend/tests/personality-browser.cjs'))}).verify(process.argv[2], ${process.argv.includes('--greetings-only')}, ${process.argv.includes('--review-only')}).catch(error => { console.error(String(error.message).replace(/Authorization: Bearer [^\\r\\n]+/gi, 'Authorization: [redacted]')); process.exitCode = 1; });\n`);
env.PADI_VERIFY_PERSONALITY_BROWSER = '1';
env.PADI_VOICE_BROWSER_SCRIPT = driver;
env.PADI_VOICE_API_URL = `http://127.0.0.1:${(env.PADI_HTTP_ADDR || ':8080').match(/:(\d+)$/)[1]}`;
env.PADI_VOICE_FRONTEND_URL ||= 'http://localhost:8081';
const child = spawn('go', ['test', '-count=1', '-timeout=16m', '-v', '-run', '^TestPersonalityBrowser$', './internal/httpapi'], {
  cwd: join(root, 'backend'), env, stdio: 'inherit',
});
child.once('exit', code => { rmSync(directory, { recursive: true, force: true }); process.exitCode = code ?? 1; });
