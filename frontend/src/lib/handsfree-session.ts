import { VoiceActivity, wavAudio, type PCMFrame } from '@/lib/voice-activity';
import type { AppSession } from '@/lib/session';
import type { VoiceSnapshot } from '@/lib/voice-session';

type Capture = { start(signal:AbortSignal):Promise<void>; stop():Promise<void> };
type Reply = { status:string; reply?:string; messageID?:string };
type Dependencies = {
  readSession():Promise<AppSession|null>;
  capture(frame:(frame:PCMFrame)=>void,interrupted:()=>void):Capture;
  transcribe(token:string,wav:Uint8Array,signal:AbortSignal):Promise<string>;
  send(text:string,accountID:string,signal:AbortSignal):Promise<Reply>;
  speak(text:string,signal:AbortSignal,onStart:()=>void,completed:(text:string)=>void):Promise<void>;
  delivered(id:string,text:string,interrupted:boolean,accountID:string):void;
  changed(snapshot:VoiceSnapshot & {connected:boolean}):void;
};
type Work = {controller:AbortController; reply?:string; id?:string; spoken:string; accountID:string};

/** Foreground capture keeps running while transcription, thinking and playback
 * run. A speech onset aborts only the response, preserving recognised input. */
export class HandsfreeSession {
  private session:AppSession|null=null;
  private controller:AbortController|null=null;
  private capture:Capture|null=null;
  private activity:VoiceActivity;
  private queue:Uint8Array[]=[];
  private draining=false;
  private work:Work|null=null;
  private pending='';
  private stopping:Promise<void>|null=null;
  private snapshot:VoiceSnapshot & {connected:boolean}={phase:'idle',connected:false,padiText:'Start a conversation. I’ll listen and reply when you finish speaking.',error:null};

  constructor(private deps:Dependencies) {
    this.activity=new VoiceActivity(()=>this.began(),utterance=>{
      if(this.queue.length>=3) { void this.cancel('Voice could not keep up. Please restart the conversation.'); return; }
      this.queue.push(wavAudio(utterance));
      void this.drain();
    });
  }
  private change(update:Partial<typeof this.snapshot>) {
    this.snapshot={...this.snapshot,...update}; this.deps.changed(this.snapshot);
  }
  private alive(controller=this.controller) { return !!controller && this.controller===controller && !controller.signal.aborted; }

  async start() {
    if(this.controller || this.stopping) return;
    const controller=new AbortController(); this.controller=controller;
    this.change({phase:'preparing',error:null});
    try {
      const session=await this.deps.readSession();
      if(!this.alive(controller)) return;
      if(!session) throw new Error('Sign in to talk with PADI.');
      this.session=session; this.activity.reset();
      this.capture=this.deps.capture(frame=>{ if(this.alive(controller)) this.activity.feed(frame); },()=>{ void this.cancel('Voice was interrupted by the device. Start the conversation again when you’re ready.'); });
      await this.capture.start(controller.signal);
      if(!this.alive(controller)) return;
      this.change({connected:true,phase:'listening'});
    } catch(error) { if(this.alive(controller)) await this.cancel(error instanceof Error?error.message:'Voice could not start.'); }
  }

  private began() {
    this.work?.controller.abort();
    if(this.work?.id) this.deps.delivered(this.work.id,this.work.spoken,true,this.work.accountID);
    this.change({phase:'listening',error:null});
  }

  private async drain() {
    if(this.draining || !this.alive() || !this.session) return;
    const controller=this.controller!; const session=this.session;
    this.draining=true;
    try {
      while(this.queue.length && this.alive(controller)) {
        const wav=this.queue.shift()!;
        if(!this.activity.speaking) this.change({phase:'transcribing'});
        try {
          const text=await this.deps.transcribe(session.token,wav,controller.signal);
          if(!this.alive(controller)) return;
          this.pending=[this.pending,text].filter(Boolean).join('\n');
          this.change({userText:this.pending,error:null});
        } catch(error) {
          if(this.alive(controller) && error && typeof error==='object' && 'status' in error && error.status===401) {
            await this.cancel('Your session expired. Sign in again to continue.',true); return;
          }
          if(this.alive(controller)) this.change({phase:'listening',error:error instanceof Error?error.message:'I didn’t catch that. Please say it again.'});
        }
      }
    } finally {
      if(this.alive(controller)) { this.draining=false; void this.respond(); }
    }
  }

  private async respond() {
    if(!this.alive() || !this.session || this.work || this.draining || this.queue.length || this.activity.speaking || !this.pending.trim()) return;
    const sessionController=this.controller!;
    const text=this.pending;
    const work:Work={controller:new AbortController(),spoken:'',accountID:this.session.user.id}; this.work=work;
    const stop=()=>work.controller.abort(); sessionController.signal.addEventListener('abort',stop,{once:true});
    this.change({phase:'thinking'});
    try {
      const reply=await this.deps.send(text,this.session.user.id,work.controller.signal);
      if(!this.alive(sessionController)) return;
      if(reply.status==='sent' && reply.reply) {
        // The exchange is already confirmed in shared chat, even if the user
        // interrupts between the reply arriving and speech starting.
        if(this.pending.startsWith(text)) this.pending=this.pending.slice(text.length).trim();
        work.reply=reply.reply; work.id=reply.messageID;
        this.change({padiText:reply.reply});
        if(work.controller.signal.aborted) {
          if(work.id) this.deps.delivered(work.id,'',true,work.accountID);
          return;
        }
        await this.deps.speak(reply.reply,work.controller.signal,()=>{
          if(this.alive(sessionController) && !work.controller.signal.aborted) this.change({phase:'speaking'});
        },segment=>{
          if(!work.controller.signal.aborted) {
            work.spoken=[work.spoken,segment].filter(Boolean).join(' ');
            if(work.id) this.deps.delivered(work.id,work.spoken,false,work.accountID);
          }
        });
      } else if(!work.controller.signal.aborted) {
        if(reply.status==='unauthorized') { await this.cancel('Your session expired. Sign in again.'); return; }
        // Keep the draft so the next utterance can retry it, without repeatedly
        // calling providers while the user is silent.
        throw new Error('PADI could not answer. Your recognised words are still here; please speak again to retry.');
      }
    } catch(error) {
      if(this.alive(sessionController) && !work.controller.signal.aborted) this.change({error:error instanceof Error?error.message:'Voice playback failed. The reply is available in chat.'});
    } finally {
      sessionController.signal.removeEventListener('abort',stop);
      if(this.work===work) this.work=null;
      if(this.alive(sessionController)) {
        this.change({phase:'listening'});
        // Only drain genuinely newer input. Avoid automatic retries after an
        // AI failure, and preserve drafts when an in-flight send was cancelled.
        if(this.pending && this.pending!==text && !this.activity.speaking && !this.draining) void this.respond();
      }
    }
  }

  cancel(error:string|null=null,clearTranscript=false):Promise<void> {
    this.controller?.abort(); this.work?.controller.abort();
    if(this.work?.id && this.work.reply) this.deps.delivered(this.work.id,this.work.spoken,true,this.work.accountID);
    this.activity.reset(); this.queue=[]; this.pending='';
    this.draining=false; this.work=null;
    this.change({phase:'idle',connected:false,error,...(clearTranscript?{userText:undefined,padiText:''}:{})});
    if(this.stopping) return this.stopping;
    const capture=this.capture;
    this.stopping=(async()=>{
      try { await capture?.stop(); }
      catch { this.change({error:'The microphone could not close cleanly. Close the app before starting again.'}); }
      finally { this.controller=null; this.capture=null; this.session=null; this.stopping=null; }
    })();
    return this.stopping;
  }
}
