import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

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

async function runningBackend(backendPort) {
  try {
    const response = await fetch(`http://127.0.0.1:${backendPort}/health`, {
      signal: AbortSignal.timeout(1500), redirect: 'error',
    });
    return response.ok && (await response.json()).service === 'padi-api';
  } catch {
    return false;
  }
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
    // Backend credentials belong only to the Go process, including credentials
    // the developer may already have exported in their terminal.
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
    const backendRunning = await runningBackend(backendPort);
    if (!stopping) {
      if (backendRunning) console.log('Using the My PADI backend already running on this port.');
      else launch('Go backend', 'go', ['run', './cmd/api'], 'backend', backendEnv);
      launch('Expo frontend', process.execPath, [expo, 'start', '--web', '--port', String(frontendPort)], 'frontend', frontendEnv);
    }
  }
} catch (error) {
  console.error(error.message);
  stop(1);
}
