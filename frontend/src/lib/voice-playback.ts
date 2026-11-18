import { requireOptionalNativeModule } from 'expo';

type NativeVoice = { play(encoded:string):Promise<void>; stopPlayback():void };
export async function playVoice(encoded:string,signal:AbortSignal,onStart:()=>void):Promise<void> {
  const voice = requireOptionalNativeModule<NativeVoice>('PadiVoice');
  if (!voice) throw new Error('Natural hands-free voice requires the PADI development build.');
  const stop = () => voice.stopPlayback();
  signal.addEventListener('abort',stop,{once:true});
  try {
    if(signal.aborted) return;
    const playing = voice.play(encoded);
    onStart();
    await playing;
  } finally { signal.removeEventListener('abort',stop); }
}
