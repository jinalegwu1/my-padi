import { requireOptionalNativeModule } from 'expo';
import { portraitSpeech, speechEnvelope } from '@/lib/portrait-speech';
import { prepareWaveReference } from '@/lib/voice-echo';

type NativeVoice = { play(encoded:string):Promise<void>; stopPlayback():void;
  beginQueuedPlayback?():void; enqueueAudio?(encoded:string):Promise<void>; finishQueuedPlayback?():Promise<void> };
export async function unlockVoicePlayback(): Promise<void> {}
export async function pauseVoicePlayback(): Promise<void> {}
export async function resumeVoicePlayback(): Promise<void> {}
export async function playVoice(encoded:string,signal:AbortSignal,onStart:()=>void,voiceId?:string):Promise<void> {
  const voice = requireOptionalNativeModule<NativeVoice>('PadiVoice');
  if (!voice) throw new Error('Natural hands-free voice requires the PADI development build.');
  let stopReference:(()=>void)|undefined;
  const stop = () => {voice.stopPlayback();stopReference?.();};
  signal.addEventListener('abort',stop,{once:true});
  let face:ReturnType<typeof portraitSpeech>|undefined;
  let progress:ReturnType<typeof setInterval>|undefined;
  try {
    if(signal.aborted) return;
    const reference=prepareWaveReference(encoded),start=Date.now()/1000;
    stopReference=reference(()=>Date.now()/1000-start);
    const playing = voice.play(encoded);
    if(voiceId) {
      face=portraitSpeech(voiceId);
      const envelope=speechEnvelope(encoded), began=Date.now();
      progress=setInterval(()=>face?.report(envelope.levelAt((Date.now()-began)/1000)),40);
    }
    onStart();
    await playing;
  } finally {stopReference?.();if(progress)clearInterval(progress);face?.stop();signal.removeEventListener('abort',stop); }
}

/** Updated native builds keep their player/AudioTrack for the entire response. */
export function createVoiceQueue(signal:AbortSignal,voiceId?:string) {
  const voice = requireOptionalNativeModule<NativeVoice>('PadiVoice');
  const queued = !!voice?.beginQueuedPlayback && !!voice.enqueueAudio && !!voice.finishQueuedPlayback;
  let begun = false;
  let serial = Promise.resolve();
  const pending:Promise<void>[]=[];
  const clips:{start:number;end:number;envelope:ReturnType<typeof speechEnvelope>}[]=[];
  let end=0;
  let face:ReturnType<typeof portraitSpeech>|undefined;
  let progress:ReturnType<typeof setInterval>|undefined;
  const stopReferences:(()=>void)[]=[];
  const stop=()=>{voice?.stopPlayback();stopReferences.forEach(stop=>stop());if(progress)clearInterval(progress);face?.stop();};
  signal.addEventListener('abort',stop,{once:true});
  return {
    enqueue(encoded:string,onStart:()=>void,completed:()=>void):Promise<void> {
      if(signal.aborted)return Promise.resolve();
      if(!voice)return Promise.reject(new Error('Voice playback requires the PADI development build.'));
      if(!queued) {
        serial=serial.then(()=>playVoice(encoded,signal,onStart,voiceId)).then(()=>{if(!signal.aborted)completed();});
        return serial;
      }
      if(!begun){voice.beginQueuedPlayback!();begun=true;onStart();}
      const reference=prepareWaveReference(encoded);
      const referenceStart=Math.max(Date.now()/1000,end);
      const stopReference=reference(()=>Date.now()/1000-referenceStart);
      stopReferences.push(stopReference);
      if(voiceId) {
        face??=portraitSpeech(voiceId);
        const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
        const start=Math.max(Date.now()/1000,end);
        end=start+(bytes.byteLength-44)/48000;
        clips.push({start,end,envelope:speechEnvelope(encoded)});
        progress??=setInterval(()=>{
          const now=Date.now()/1000;
          const clip=clips.find(clip=>now>=clip.start&&now<clip.end);
          face?.report(clip?.envelope.levelAt(now-clip.start)??0);
        },40);
      }
      const playing=voice.enqueueAudio!(encoded).then(()=>{stopReference();if(!signal.aborted)completed();});
      pending.push(playing);return playing;
    },
    async finish() {
      try {
        if(queued&&begun&&!signal.aborted)await voice!.finishQueuedPlayback!();
        await serial;await Promise.all(pending);
      } finally {if(progress)clearInterval(progress);face?.stop();signal.removeEventListener('abort',stop);}
    },
  };
}
