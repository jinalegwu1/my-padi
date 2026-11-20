import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const windows = process.platform === 'win32';
const environment = join(root, 'services', 'voice', '.venv');
const python = join(environment, windows ? 'Scripts' : 'bin', windows ? 'python.exe' : 'python');

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit' });
    child.once('error', () => reject(new Error('Install Python 3.10 or later, then run npm run setup:voice again.')));
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('Python voice setup failed. Check the output above before starting PADI.')));
  });
}

try {
  if (!existsSync(python)) {
    await run(windows ? 'py' : 'python3', [...(windows ? ['-3'] : []), '-m', 'venv', environment]);
  }
  await run(python, ['-c', 'import sys; assert sys.version_info >= (3, 10), "Python 3.10 or later is required"']);
  await run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', join(root, 'services', 'voice', 'requirements.txt')]);
  await run(python, ['-c', 'import webrtcvad']);
  console.log('Python voice is prepared. Start the configured services with npm run dev.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
