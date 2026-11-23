// Explicit local-only verification. No AI/TTS provider credentials are passed
// to the test server, Python process or browser driver.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
try {
  const values = { ...parseEnv(readFileSync(join(root, 'backend/.env'), 'utf8')), ...process.env };
  if (values.PADI_ENV !== 'development') throw new Error('Incoming voice verification creates a temporary account and requires development mode.');
  const env = { PATH: process.env.PATH, PADI_ENV: 'development', PADI_VERIFY_TRANSCRIPTION: '1',
    ...(process.env.HOME ? { HOME: process.env.HOME } : {}) };
  for (const name of ['DATABASE_URL', 'PADI_DATABASE_URL', 'PADI_VOICE_PYTHON', 'PADI_STT_MODEL', 'PADI_STT_MODEL_PATH', 'PADI_VOICE_BROWSER_EXECUTABLE', 'PADI_TRANSCRIPTION_REPORT_PATH', 'GOCACHE', 'GOMODCACHE', 'GOPATH', 'SystemRoot', 'WINDIR', 'TMP', 'TEMP']) {
    if (values[name]) env[name] = values[name];
  }
  const child = spawn('go', ['test', './internal/httpapi', '-run', '^TestIncomingTranscriptionBrowser$', '-count=1', '-v', '-timeout', '13m'], {
    cwd: join(root, 'backend'), env, stdio: 'inherit',
  });
  child.once('error', () => { console.error('The incoming voice test could not start. Check Go, Python and frontend dependencies.'); process.exitCode = 1; });
  child.once('exit', code => { process.exitCode = code ?? 1; });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
