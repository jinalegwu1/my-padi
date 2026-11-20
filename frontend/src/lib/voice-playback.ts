import { requireOptionalNativeModule } from 'expo';
import { portraitSpeech, speechEnvelope } from '@/lib/portrait-speech';

type NativeVoice = { play(encoded:string):Promise<void>; stopPlayback():void };
export async function unlockVoicePlayback(): Promise<void> {}
export async function playVoice(encoded:string,signal:AbortSignal,onStart:()=>void,voiceId?:string):Promise<void> {
  const voice = requireOptionalNativeModule<NativeVoice>('PadiVoice');
  if (!voice) throw new Error('Natural hands-free voice requires the PADI development build.');
  const stop = () => voice.stopPlayback();
  signal.addEventListener('abort',stop,{once:true});
  let face:ReturnType<typeof portraitSpeech>|undefined;
  let progress:ReturnType<typeof setInterval>|undefined;
  try {
    if(signal.aborted) return;
    const playing = voice.play(encoded);
    if(voiceId) {
      face=portraitSpeech(voiceId);
      const envelope=speechEnvelope(encoded), began=Date.now();
      progress=setInterval(()=>face?.report(envelope.levelAt((Date.now()-began)/1000)),40);
    }
    onStart();
    await playing;
  } finally { if(progress)clearInterval(progress);face?.stop();signal.removeEventListener('abort',stop); }
}
