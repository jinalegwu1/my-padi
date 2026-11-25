import { synthesiseSpeech } from '@/lib/api';
import { readSession } from '@/lib/session';
import { playVoice } from '@/lib/voice-playback';
import { speechSegments } from '@/lib/voice-audio';
import { spokenText } from '@/lib/spoken-text';

/** Prefetch the next coherent passage while playing the current passage. The completed
 * callback marks only fully played segments, never guessed word timestamps. */
export async function speakNaturally(text:string,style:string,rate:number,signal:AbortSignal,onStart:()=>void,completed:(text:string)=>void,languageCode='en-NG') {
  const session=await readSession();
  if(signal.aborted) return;
  if(!session) throw new Error('Sign in to hear PADI’s reply.');
  const segments=speechSegments(spokenText(text));
  if(!segments.length) return;
  const load=(segment:string)=>synthesiseSpeech(session.token,segment,style,rate,signal,languageCode,true);
  let audio=load(segments[0]);
  for(let index=0;index<segments.length;index++) {
    const result=await audio;
    if(signal.aborted) return;
    if(index+1<segments.length) {
      audio=load(segments[index+1]);
      // A cancelled prefetched request may reject before the current clip ends.
      void audio.catch(()=>undefined);
    }
    await playVoice(result.audio_base64,signal,onStart,style);
    if(signal.aborted) return;
    completed(segments[index]);
  }
}

/** Speak one completed response segment through the configured Python speech engine. */
export async function speakGroqSegment(text:string,style:string,rate:number,languageCode:string,signal:AbortSignal,onStart:()=>void,completed:(text:string)=>void) {
  const words=spokenText(text);
  if(!words||signal.aborted)return;
  const session=await readSession();
  if(signal.aborted)return;
  if(!session)throw new Error('Sign in to hear PADI’s reply.');
  const result=await synthesiseSpeech(session.token,words,style,rate,signal,languageCode,true,false);
  if(signal.aborted)return;
  await playVoice(result.audio_base64,signal,onStart,style);
  if(!signal.aborted)completed(words);
}
