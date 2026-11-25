import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { runningFrontend, verifyBrowserAccess } from './dev-services.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const children = [];
let stopping = false;

function environment(directory) {
  const path = join(root, directory, '.env');
  try {
    return parseEnv(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`Cannot read ${directory}/.env; prepare it from .env.example.`);
  }
}

function port(value, name) {
  if (!/^\d+$/.test(value ?? '') || Number(value) < 1 || Number(value) > 65535) {
    throw new Error(`${name} must specify a port between 1 and 65535.`);
  }
  return Number(value);
}

async function runningBackend(backendPort, needsDatabase) {
  let matches = false;
  try {
    const response = await fetch(`http://127.0.0.1:${backendPort}/health`, {
      signal: AbortSignal.timeout(1500), redirect: 'error',
    });
    matches = response.ok && (await response.json()).service === 'padi-api';
  } catch {
    return false;
  }
  if (matches && needsDatabase) {
    let ready = false;
    try {
      const response = await fetch(`http://127.0.0.1:${backendPort}/readyz`, {
        signal: AbortSignal.timeout(2500), redirect: 'error',
      });
      ready = response.ok && (await response.json()).status === 'ready';
    } catch { /* The existing server must be restarted if PostgreSQL is unavailable. */ }
    if (!ready) {
      throw new Error(`The My PADI backend on port ${backendPort} is not database-ready. Stop that backend and run npm run dev to load backend/.env.`);
    }
  }
  return matches;
}

async function runningVoiceService(voicePort) {
  try {
    const response=await fetch(`http://127.0.0.1:${voicePort}/health`,{signal:AbortSignal.timeout(1500),redirect:'error'});
    if(!response.ok || (await response.json()).service!=='padi-python-voice') throw new Error('wrong service');
    return true;
  } catch { return false; }
}

function signal(child, name) {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      // Include the API executable created by go run and Metro's subprocesses.
      process.kill(-child.pid, name);
    }
  } catch (error) {
    if (error.code !== 'ESRCH') console.error('Could not stop a development process.');
  }
}

function alive(child) {
  if (!child.pid) return false;
  if (process.platform === 'win32') return child.exitCode === null && child.signalCode === null;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch {
    return false;
  }
}

function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) signal(child, 'SIGTERM');
  const timeout = setTimeout(() => {
    for (const child of children) signal(child, 'SIGKILL');
    clearInterval(cleanup);
  }, 11_000);
  const cleanup = setInterval(() => {
    if (children.every((child) => !alive(child))) {
      clearTimeout(timeout);
      clearInterval(cleanup);
    }
  }, 100);
}

function launch(label, command, args, directory, env) {
  const child = spawn(command, args, {
    cwd: join(root, directory), env, stdio: 'inherit', detached: process.platform !== 'win32',
  });
  children.push(child);
  child.once('error', () => {
    console.error(`Could not start ${label}; check its installed tools.`);
    stop(1);
  });
  child.once('exit', (code) => {
    if (!stopping) {
      if (code) console.error(`${label} exited with code ${code}.`);
      stop(code ?? 1);
    }
  });
}

process.once('SIGINT', () => stop(0));
process.once('SIGTERM', () => stop(0));

try {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--migrate')) {
    throw new Error('Use npm run dev to start both servers, or npm run migrate for migrations.');
  }
  const backendValues = environment('backend');
  const backendEnv = { ...backendValues, ...process.env };
  if (args[0] === '--migrate') {
    launch('Database migrations', 'go', ['run', './cmd/migrate'], 'backend', backendEnv);
  } else {
    const frontendValues = environment('frontend');
    const frontendEnv = { ...frontendValues, ...process.env };
    // Server credentials never go to Expo. Python receives its own explicitly
    // scoped voice-service subset below; Go keeps the backend configuration.
    for (const name of Object.keys(backendValues)) {
      if (!name.startsWith('EXPO_PUBLIC_')) delete frontendEnv[name];
    }
    const frontendPort = port(backendEnv.PADI_FRONTEND_PORT || '8081', 'PADI_FRONTEND_PORT');
    const backendPort = port((backendEnv.PADI_HTTP_ADDR || ':8080').match(/:(\d+)$/)?.[1], 'PADI_HTTP_ADDR');
    if (frontendPort === backendPort) throw new Error('The frontend and backend need separate ports.');
    const origins = new Set((backendEnv.PADI_CORS_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean));
    origins.add(`http://localhost:${frontendPort}`);
    origins.add(`http://127.0.0.1:${frontendPort}`);
    backendEnv.PADI_CORS_ORIGINS = [...origins].join(',');
    frontendEnv.EXPO_PUBLIC_API_URL ||= `http://127.0.0.1:${backendPort}`;
    frontendEnv.BROWSER ||= 'none';
    const expo = join(root, 'frontend', 'node_modules', 'expo', 'bin', 'cli');
    if (!existsSync(expo)) throw new Error('Install frontend dependencies first: npm ci --prefix frontend');
    console.log(`Backend: http://127.0.0.1:${backendPort}`);
    console.log(`Frontend: http://localhost:${frontendPort}`);
    const needsDatabase = Boolean(backendEnv.DATABASE_URL || backendEnv.PADI_DATABASE_URL || backendEnv.PADI_AI_MODELS);
    const frontendRunning = await runningFrontend(frontendPort, join(root, 'frontend'));
    const backendRunning = await runningBackend(backendPort, needsDatabase);
    if (backendRunning) {
      await verifyBrowserAccess(`http://127.0.0.1:${backendPort}`, [
        `http://localhost:${frontendPort}`, `http://127.0.0.1:${frontendPort}`,
      ]);
    }
    if (!stopping) {
      if(backendEnv.PADI_PYTHON_VOICE_ENABLED==='true' || backendEnv.PADI_STT_ENABLED==='true') {
        const voicePort=port(backendEnv.PADI_PYTHON_VOICE_PORT||'8090','PADI_PYTHON_VOICE_PORT');
        if(voicePort===backendPort || voicePort===frontendPort) throw new Error('Python voice needs its own port.');
        const python=backendEnv.PADI_VOICE_PYTHON || join(root,'services','voice','.venv',process.platform==='win32'?'Scripts':'bin',process.platform==='win32'?'python.exe':'python');
        if(!existsSync(python)) throw new Error('Prepare services/voice/.venv and install services/voice/requirements.txt before starting Python voice.');
        const voiceEnv={PATH:process.env.PATH,PYTHONUNBUFFERED:'1',
          PADI_PYTHON_VOICE_ENGINE:backendEnv.PADI_PYTHON_VOICE_ENGINE||'local',
          PADI_PYTHON_VOICE_ENABLED:backendEnv.PADI_PYTHON_VOICE_ENABLED||'false',PADI_PYTHON_VOICE_PORT:String(voicePort),PADI_VOICE_SERVICE_TOKEN:backendEnv.PADI_VOICE_SERVICE_TOKEN,
          PADI_STT_ENABLED:backendEnv.PADI_STT_ENABLED||'false',
          PADI_VOICE_MODEL:backendEnv.PADI_VOICE_MODEL||'gemini-3.1-flash-tts-preview',
          ...(backendEnv.PADI_VOICE_FALLBACK_MODEL !== undefined ? {PADI_VOICE_FALLBACK_MODEL:backendEnv.PADI_VOICE_FALLBACK_MODEL} : {}),
          PADI_VOICE_DEFAULT_ID:backendEnv.PADI_VOICE_DEFAULT_ID||'',
          PADI_AI_FREE_ACCOUNT_CONFIRMED:backendEnv.PADI_AI_FREE_ACCOUNT_CONFIRMED,
          PADI_DISABLE_ALL_LIMITS:backendEnv.PADI_DISABLE_ALL_LIMITS||'false',
          ...((backendEnv.PADI_PYTHON_VOICE_ENGINE||'local')==='gemini' ? {GEMINI_API_KEY:backendEnv.GEMINI_API_KEY,GROQ_API_KEY:backendEnv.GROQ_API_KEY} : {})};
        for(const name of ['PADI_STT_MODEL','PADI_STT_MODEL_PATH','PADI_STT_WORKERS','PADI_STT_THREADS','PADI_STT_TIMEOUT_SECONDS']) {
          if(backendEnv[name]!==undefined) voiceEnv[name]=backendEnv[name];
        }
        for(const name of ['SystemRoot','WINDIR','SSL_CERT_FILE','SSL_CERT_DIR','HTTPS_PROXY','HTTP_PROXY','NO_PROXY']) {
          if(process.env[name]) voiceEnv[name]=process.env[name];
        }
        if(await runningVoiceService(voicePort)) console.log('Using the Python voice service already running.');
        else launch('Python voice',python,['app.py'],'services/voice',voiceEnv);
      }
      if (backendRunning) console.log('Using the My PADI backend already running on this port.');
      else launch('Go backend', 'go', ['run', './cmd/api'], 'backend', backendEnv);
      if (frontendRunning) console.log(`Using this PADI project's Expo server already running at http://localhost:${frontendPort}.`);
      else launch('Expo frontend', process.execPath, [expo, 'start', '--web', '--port', String(frontendPort)], 'frontend', frontendEnv);
    }
  }
} catch (error) {
  console.error(error.message);
  stop(1);
}
