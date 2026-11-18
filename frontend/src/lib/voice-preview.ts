import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { synthesiseSpeech } from '@/lib/api';
import { readSession } from '@/lib/session';
import { playVoice } from '@/lib/voice-playback';

/** Preview the same Python-generated voice without opening the microphone. */
export async function previewVoice(text:string,style:string,rate:number,signal:AbortSignal,onStart:()=>void) {
  const session=await readSession();
  if(signal.aborted)return;
  if(!session)throw new Error('Sign in to preview PADI’s natural voices.');
  const audio=await synthesiseSpeech(session.token,text,style,rate,signal);
  if(signal.aborted)return;
  if(Platform.OS==='web'){await playVoice(audio.audio_base64,signal,onStart);return;}
  const file=new File(Paths.cache,`padi-preview-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
  let player:AudioPlayer|undefined;
  try {
    file.create();file.write(audio.audio_base64,{encoding:'base64'});
    player=createAudioPlayer(file.uri,{updateInterval:100});
    await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>finish(new Error('Voice preview did not finish. Please try again.')),120_000);
      let started=false,settled=false;
      const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',stop);subscription.remove();error?reject(error):resolve();};
      const stop=()=>{player?.pause();finish();};
      const subscription=player!.addListener('playbackStatusUpdate',status=>{
        if(status.playing&&!started){started=true;onStart();}
        if(status.didJustFinish)finish();
      });
      signal.addEventListener('abort',stop,{once:true});
      if(signal.aborted){stop();return;}
      try{player!.play();}catch{finish(new Error('Voice preview could not start.'));}
    });
  } finally { try{player?.release();}finally{if(file.exists)file.delete();} }
}
