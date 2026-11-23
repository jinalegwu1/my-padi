// Offline comparison of public WAV artifacts exported by the capture browser
// harness. Uses the same installed local engine as PADI; no external API.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const compare = String.raw`
import hashlib,json,re,sys
from pathlib import Path
sys.path.insert(0,str(Path.cwd()/'services/voice'))
from local_recognition import RecognitionConfig,load_model,recognise_file
folder=Path(sys.argv[1]);rows=json.loads((folder/'uploads.json').read_text())
config=RecognitionConfig.environment();model=load_model(config)
cache,results={},[]
fixtures=[name for name in ('continue','jfk') if any(row['name']==name+'-16000-before' for row in rows)]
if not fixtures:raise SystemExit('No public speech fixtures were exported by the browser test.')
words=lambda text:re.findall(r'\w+',text.casefold())
for fixture in fixtures:
    texts={}
    for rate in (16000,44100,48000):
        for kind in ('before','stage1'):
            path=folder/f'{fixture}-{rate}-{kind}.wav'
            digest=hashlib.sha256(path.read_bytes()).hexdigest()
            if digest not in cache:cache[digest]=recognise_file(model,config,str(path),'audio/wav','en')['text']
            texts[rate,kind]=cache[digest]
        result={'fixture':fixture,'source_rate':rate,'before':texts[rate,'before'],'stage1':texts[rate,'stage1'],'same_words':words(texts[rate,'before'])==words(texts[rate,'stage1'])}
        results.append(result);print(json.dumps(result),flush=True)
(folder/'recognition.json').write_text(json.dumps({'engine':'faster-whisper','model':config.model,'inferences':len(cache),'comparisons':results},indent=2))
if any(not row['same_words'] for row in results):raise SystemExit('Recognition differed: inspect the actual before/after results.')
print(f'PASS {len(results)} local before/after speech comparisons.')
`;
try {
  if (process.argv.length !== 3) throw new Error('Pass the public artifact directory produced by voice-capture-browser.cjs.');
  const directory = resolve(process.argv[2]);
  if (!existsSync(join(directory, 'uploads.json'))) throw new Error('Run the browser capture test with PADI_VOICE_CAPTURE_OUTPUT_DIR first.');
  const python = process.env.PADI_VOICE_PYTHON || join(root, 'services/voice/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const env = { PATH: process.env.PATH, PYTHONUNBUFFERED: '1', HF_HUB_OFFLINE: '1' };
  for (const name of ['PADI_STT_MODEL', 'PADI_STT_MODEL_PATH', 'PADI_STT_THREADS', 'SystemRoot']) if (process.env[name]) env[name] = process.env[name];
  const child = spawn(python, ['-B', '-c', compare, directory], { cwd: root, stdio: 'inherit', env });
  child.once('error', () => { console.error('The local Python recognition environment could not start.'); process.exitCode = 1; });
  child.once('exit', code => { process.exitCode = code ?? 1; });
} catch (error) { console.error(error.message); process.exitCode = 1; }
