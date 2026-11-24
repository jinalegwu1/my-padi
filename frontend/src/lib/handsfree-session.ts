import { VoiceActivity, wavAudio, type PCMFrame } from '@/lib/voice-activity';
import { takeCompletedSentences, takeReadySpeech } from '@/lib/voice-audio';
import type { AppSession } from '@/lib/session';
import type { VoiceSnapshot } from '@/lib/voice-session';
import type { SpeechStream } from '@/lib/streaming-speech';

type Capture = { start(signal:AbortSignal):Promise<void>; stop():Promise<void> };
type Reply = { status:string; reply?:string; messageID?:string };
type Dependencies = {
  readSession():Promise<AppSession|null>;
  capture(frame:(frame:PCMFrame)=>void,interrupted:()=>void):Capture;
  filterFrame?(frame:PCMFrame):PCMFrame;
  transcribe(token:string,wav:Uint8Array,signal:AbortSignal):Promise<string>;
  send(text:string,accountID:string,signal:AbortSignal,onDelta:(delta:string)=>void,onStart:(id:string)=>void):Promise<Reply>;
  speak?(text:string,signal:AbortSignal,onStart:()=>void,completed:(text:string)=>void):Promise<void>;
  createSpeech?(signal:AbortSignal,onStart:()=>void,completed:(text:string)=>void):SpeechStream;
  greet?(signal:AbortSignal,onText:(text:string)=>void,onStart:()=>void):Promise<void>;
  delivered(id:string,text:string,interrupted:boolean,accountID:string):void;
  changed(snapshot:VoiceSnapshot & {connected:boolean}):void;
};
type Work = {controller:AbortController; reply?:string; id?:string; spoken:string; accountID:string; done:Promise<void>; finish:()=>void; speechTask:Promise<void>; played:boolean};

/** Keep the microphone active during speech. AEC/reference filtering rejects
 * speaker echo; genuine speech onset cancels only PADI's response, not capture. */
export class HandsfreeSession {
  private session:AppSession|null=null;
  private controller:AbortController|null=null;
  private capture:Capture|null=null;
  private activity:VoiceActivity;
  private queue:Uint8Array[]=[];
  private draining=false;
  private work:Work|null=null;
  private touchVersion=0;
  private touchPending=false;
  private pending='';
  private stopping:Promise<void>|null=null;
  private snapshot:VoiceSnapshot & {connected:boolean}={phase:'idle',connected:false,padiText:'',error:null};
  private wakeMode=false;
  private wakeActivated=false;
  private wakeTimer:ReturnType<typeof setTimeout>|null=null;

  constructor(private deps:Dependencies) {
    this.activity=new VoiceActivity(()=>this.began(),utterance=>{
      if(this.queue.length>=3) { void this.cancel('Voice could not keep up. Please restart the conversation.'); return; }
      this.queue.push(wavAudio(utterance));
      void this.drain();
    },{onsetMs:120,silenceMs:1400});
  }
  private change(update:Partial<typeof this.snapshot>) {
    this.snapshot={...this.snapshot,...update}; this.deps.changed(this.snapshot);
  }
  private alive(controller=this.controller) { return !!controller && this.controller===controller && !controller.signal.aborted; }
  private makeWork(accountID:string):Work {
    let finish!:()=>void;
    const done=new Promise<void>(resolve=>{finish=resolve;});
    return {controller:new AbortController(),spoken:'',accountID,done,finish,speechTask:Promise.resolve(),played:false};
  }

  async start({greet=true,wake=false}: {greet?:boolean;wake?:boolean} = {}) {
    if(this.controller || this.stopping) return;
    this.wakeMode=wake;
    this.wakeActivated=false;
    const controller=new AbortController(); this.controller=controller;
    this.change({phase:'preparing',error:null});
    try {
      const session=await this.deps.readSession();
      if(!this.alive(controller)) return;
      if(!session) throw new Error('Sign in to talk with PADI.');
      this.session=session; this.activity.reset();
      this.capture=this.deps.capture(frame=>{
        if(this.alive(controller)&&this.snapshot.connected)this.activity.feed(this.deps.filterFrame?.(frame)??frame);
      },()=>{ void this.cancel('Voice was interrupted by the device. Tap PADI to continue.'); });
      await this.capture.start(controller.signal);
      if(!this.alive(controller)) return;
      this.change({connected:true});
      if(greet && this.deps.greet) void this.greet(controller);
      else this.change({phase:'listening'});
    } catch(error) { if(this.alive(controller)) await this.cancel(error instanceof Error?error.message:'Voice could not start.'); }
  }

  private async greet(sessionController:AbortController) {
    if(!this.deps.greet)return;
    const work=this.makeWork(this.session!.user.id);
    this.work=work;
    const stop=()=>work.controller.abort();
    sessionController.signal.addEventListener('abort',stop,{once:true});
    this.change({phase:'thinking'});
    try {
      await this.deps.greet!(work.controller.signal,
        text=>{if(this.alive(sessionController)&&!work.controller.signal.aborted)this.change({padiText:text});},
        ()=>{if(this.alive(sessionController)&&!work.controller.signal.aborted){work.played=true;this.change({phase:'speaking'});}});
    } catch(error) {
      if(this.alive(sessionController)&&!work.controller.signal.aborted)this.change({error:error instanceof Error?error.message:'PADI’s greeting could not play. You can still talk to me.'});
    } finally {
      sessionController.signal.removeEventListener('abort',stop);
      const owned=this.work===work;
      if(owned)this.work=null;
      work.finish();
      if(this.alive(sessionController)&&owned) {
        if(!this.draining)this.change({phase:'listening'});
        if(this.pending&&!this.activity.speaking&&!this.draining)void this.respond();
      }
    }
  }

  /** A touch gets a spoken acknowledgement without starting another mic. */
  async reactToTouch() {
    if(!this.alive()||!this.session)return;
    const controller=this.controller!;
    const version=++this.touchVersion;
    this.touchPending=true;
    const previous=this.work;
    previous?.controller.abort();
    await previous?.done;
    if(!this.alive(controller)||version!==this.touchVersion)return;
    this.touchPending=false;
    if(!this.activity.speaking)await this.greet(controller);
  }

  private began() {
    this.touchVersion++;this.touchPending=false;
    const work=this.work;
    if(work){
      // Detach ownership before cancelling: late completion must never reset
      // the detector or replace the user's new listening turn.
      this.work=null;this.pending='';work.controller.abort();
      if(work.id)this.deps.delivered(work.id,work.spoken,true,work.accountID);
    }
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
          let recognised=text.trim();
          if(this.wakeMode) {
            const wake=/^(?:hey\s+)?padi\b[\s,.:!?-]*/i;
            if(!this.wakeActivated) {
              if(!wake.test(recognised)) continue;
              recognised=recognised.replace(wake,'').trim();
              this.wakeActivated=true;
            } else if(wake.test(recognised)) {
              recognised=recognised.replace(wake,'').trim();
            }
            if(this.wakeTimer) clearTimeout(this.wakeTimer);
            this.wakeTimer=setTimeout(()=>{
              this.wakeActivated=false;
            },20_000);
          }
          if(/^(?:please\s+)?stop(?:\s+please)?[.!?]*$/i.test(recognised)){
            this.pending='';this.change({userText:recognised,error:null});continue;
          }
          if(recognised)this.pending=[this.pending,recognised].filter(Boolean).join('\n');
          this.change({userText:this.pending,error:null});
        } catch(error) {
          if(this.alive(controller) && error && typeof error==='object' && 'status' in error && error.status===401) {
            await this.cancel('Your session expired. Sign in again to continue.',true); return;
          }
          if(this.alive(controller)) this.change({phase:'listening',error:error instanceof Error?error.message:'I didn’t catch that. Please say it again.'});
        }
      }
    } finally {
      if(this.alive(controller)) { this.draining=false; this.scheduleResponse(); }
    }
  }

  private scheduleResponse() {
    if(!this.alive()||this.work||this.draining||this.queue.length||this.activity.speaking)return;
    if(this.pending.trim())void this.respond();
    else this.change({phase:'listening'});
  }

  private async respond() {
    if(!this.alive() || !this.session || this.work || this.touchPending || this.draining || this.queue.length || this.activity.speaking || !this.pending.trim()) return;
    const sessionController=this.controller!;
    const text=this.pending;
    const work=this.makeWork(this.session.user.id); this.work=work;
    const stop=()=>work.controller.abort(); sessionController.signal.addEventListener('abort',stop,{once:true});
    let speechRemainder='';
    let receivedStream=false;
    let speechQueued=false;
    const speaking=()=>{
      if(this.alive(sessionController)&&!work.controller.signal.aborted){work.played=true;this.change({phase:'speaking'});}
    };
    const completed=(spoken:string)=>{
      if(work.controller.signal.aborted)return;
      work.spoken=[work.spoken,spoken].filter(Boolean).join(' ');
      if(work.id)this.deps.delivered(work.id,work.spoken,false,work.accountID);
    };
    const stream=this.deps.createSpeech?.(work.controller.signal,speaking,completed);
    const queueSpeech=(segment:string)=>{
      speechQueued=true;
      if(stream){stream.enqueue(segment);return;}
      work.speechTask=work.speechTask.then(async()=>{
        if(work.controller.signal.aborted)return;
        try {
          await this.deps.speak?.(segment,work.controller.signal,speaking,completed);
        } catch(error) {
          if(!work.controller.signal.aborted) this.change({error:error instanceof Error?error.message:'PADI could not speak this reply. It is available in text chat.'});
        }
      });
    };
    this.change({phase:'thinking'});
    try {
      const reply=await this.deps.send(text,this.session.user.id,work.controller.signal,delta=>{
        if(work.controller.signal.aborted)return;
        receivedStream=true;
        work.reply=(work.reply??'')+delta;
        this.change({padiText:work.reply});
        speechRemainder+=delta;
        // A single network event can contain several passages. Drain all
        // usable text now, without waiting on playback or another delta.
        while(speechRemainder.trim()) {
          const complete=takeReadySpeech(speechRemainder,!speechQueued);
          if(!complete.sentences.length)break;
          speechRemainder=complete.remainder;
          complete.sentences.forEach(queueSpeech);
        }
      },id=>{if(this.alive(sessionController)&&!work.controller.signal.aborted)work.id=id;});
      if(!this.alive(sessionController)||this.work!==work||work.controller.signal.aborted) return;
      if(reply.status==='sent' && reply.reply) {
        // The exchange is already confirmed in shared chat, even if the user
        // interrupts between the reply arriving and speech starting.
        if(this.pending.startsWith(text)) this.pending=this.pending.slice(text.length).trim();
        work.reply=reply.reply; work.id=reply.messageID??work.id;
        if(work.id&&work.spoken)this.deps.delivered(work.id,work.spoken,false,work.accountID);
        this.change({padiText:reply.reply});
        if(work.controller.signal.aborted) {
          if(work.id) this.deps.delivered(work.id,'',true,work.accountID);
          return;
        }
        if(!receivedStream) {
          const complete=takeCompletedSentences(reply.reply);
          complete.sentences.forEach(queueSpeech);
          speechRemainder=complete.remainder;
        }
        if(speechRemainder.trim())queueSpeech(speechRemainder.trim());
        work.speechTask=stream?.finish()??work.speechTask;
        await work.speechTask;
      } else if(!work.controller.signal.aborted) {
        if(reply.status==='unauthorized') { await this.cancel('Your session expired. Sign in again.'); return; }
        // Keep the draft so the next utterance can retry it, without repeatedly
        // calling providers while the user is silent.
        throw new Error('PADI could not answer. Your recognised words are still here; please speak again to retry.');
      }
    } catch(error) {
      // A failed stream must also stop any sentence already playing.
      const interrupted=work.controller.signal.aborted;
      work.controller.abort();
      if(this.alive(sessionController)&&!interrupted) this.change({error:error instanceof Error?error.message:'Voice playback failed. The reply is available in chat.'});
    } finally {
      if(stream&&work.controller.signal.aborted)work.speechTask=stream.finish();
      await work.speechTask.catch(()=>undefined);
      sessionController.signal.removeEventListener('abort',stop);
      const owned=this.work===work;
      if(owned)this.work=null;
      work.finish();
      if(this.alive(sessionController)&&owned) {
        this.change({phase:'listening'});
        // Only drain genuinely newer input. Avoid automatic retries after an
        // AI failure, and preserve drafts when an in-flight send was cancelled.
        if(this.pending && this.pending!==text && !this.activity.speaking && !this.draining) this.scheduleResponse();
      }
    }
  }

  cancel(error:string|null=null,clearTranscript=false):Promise<void> {
    this.touchVersion++;this.touchPending=false;
    if(this.wakeTimer) { clearTimeout(this.wakeTimer); this.wakeTimer=null; }
    this.wakeMode=false;
    this.wakeActivated=false;
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
