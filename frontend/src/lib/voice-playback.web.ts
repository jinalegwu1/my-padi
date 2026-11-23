import { portraitSpeech, speechEnvelope } from '@/lib/portrait-speech';

let output: AudioContext | null = null;

/** Unlock sound from the actual tap, before navigation or network requests. */
export async function unlockVoicePlayback(): Promise<void> {
  output ??= new AudioContext();
  if (output.state === 'closed') output = new AudioContext();
  if (output.state === 'running') return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      output.resume(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Tap to chat again to enable sound in your browser.')), 1500);
      }),
    ]);
    if ((output.state as AudioContextState) !== 'running') throw new Error('Tap to chat again to enable sound in your browser.');
  } finally { if (timer) clearTimeout(timer); }
}

export async function pauseVoicePlayback(): Promise<void> {
  if (output?.state === 'running') await output.suspend();
}

export async function resumeVoicePlayback(): Promise<void> {
  if (output?.state === 'suspended') await output.resume();
}

/** One unlocked output context keeps replies audible after async requests. */
export async function playVoice(encoded: string, signal: AbortSignal, onStart: () => void, voiceId?: string): Promise<void> {
  if (signal.aborted) return;
  await unlockVoicePlayback();
  const context = output!;
  const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
  let buffer: AudioBuffer;
  try { buffer = await context.decodeAudioData(bytes.buffer); }
  catch { throw new Error('Voice playback failed. Your reply is available in the transcript.'); }
  if (signal.aborted) return;
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  const envelope = voiceId ? speechEnvelope(encoded) : null;
  let face: ReturnType<typeof portraitSpeech> | undefined;
  let progress: ReturnType<typeof setInterval> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', stop);
        resolve();
      };
      const stop = () => { try { source.stop(); } finally { finish(); } };
      source.onended = finish;
      signal.addEventListener('abort', stop, { once: true });
      if (signal.aborted) { finish(); return; }
      try {
        source.start();
        if (voiceId && envelope) {
          face = portraitSpeech(voiceId);
          const began = context.currentTime;
          progress = setInterval(() => face?.report(envelope.levelAt(context.currentTime - began)), 40);
        }
        onStart();
      }
      catch {
        signal.removeEventListener('abort', stop);
        reject(new Error('PADI’s audio could not start. Tap to chat again to enable sound.'));
      }
    });
  } finally {
    if (progress) clearInterval(progress);
    face?.stop();
    source.onended = null; source.disconnect();
  }
}
