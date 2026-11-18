export async function playVoice(encoded:string,signal:AbortSignal,onStart:()=>void):Promise<void> {
  const bytes=Uint8Array.from(atob(encoded),character=>character.charCodeAt(0));
  const url=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));
  const audio=new Audio(url);
  try {
    await new Promise<void>((resolve,reject)=>{
      const stop=()=>{ audio.pause(); resolve(); };
      const finish=()=>{ signal.removeEventListener('abort',stop); resolve(); };
      audio.onended=finish;
      audio.onerror=()=>{ signal.removeEventListener('abort',stop); reject(new Error('Voice playback failed. Your reply is available in the transcript.')); };
      audio.onplaying=()=>{ if(!signal.aborted) onStart(); };
      signal.addEventListener('abort',stop,{once:true});
      if(signal.aborted) { stop(); return; }
      void audio.play().catch(()=>{ signal.removeEventListener('abort',stop); reject(new Error('Playback was blocked. Tap Start conversation again to enable sound.')); });
    });
  } finally { audio.pause(); audio.src=''; URL.revokeObjectURL(url); }
}
