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
  const options = process.argv.slice(2);
  if (options.some(option => option !== '--vulkan')) throw new Error('Use npm run setup:voice or npm run setup:voice -- --vulkan.');
  if (!existsSync(python)) {
    await run(windows ? 'py' : 'python3', [...(windows ? ['-3'] : []), '-m', 'venv', environment]);
  }
  await run(python, ['-c', 'import sys; assert sys.version_info >= (3, 10), "Python 3.10 or later is required"']);
  if (process.arch === 'x64' && (windows || process.platform === 'linux')) {
    await run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--index-url', 'https://download.pytorch.org/whl/cpu', 'torch==2.6.0']);
  }
  await run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', join(root, 'services', 'voice', 'requirements.txt')]);
  await run(python, [join(root, 'services', 'voice', 'install_conversation_models.py')]);
  if (options.includes('--vulkan')) {
    await run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', 'ncnn==1.0.20261020', 'pnnx==20261020']);
    await run(python, [join(root, 'services', 'voice', 'vulkan_speech.py')]);
  }
  console.log('Live recognition and both Nigerian voices are installed.');
  console.log(`For file transcription and other input languages, install Whisper once: ${python} services/voice/install_model.py --model base`);
  console.log('Then enable PADI_STT_ENABLED in backend/.env and start the configured services with npm run dev.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
