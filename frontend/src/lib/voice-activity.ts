/** Keep a short pre-roll so speech onset and interruptions retain the first syllable. */
export type PCMFrame = { data: ArrayBuffer; sampleRate: number; channels: number; voiceLevel?:number; capturedAt?:number };
export type Utterance = { pcm: Uint8Array; sampleRate: number; lastVoiceAt?: number };

export class VoiceActivity {
  private frames: Uint8Array[] = [];
  private preRoll: Uint8Array[] = [];
  private preDuration = 0;
  private rate = 0;
  private speechMs = 0;
  private quietMs = 0;
  private durationMs = 0;
  private active = false;
  private noise = -65;
  private lastVoiceAt = 0;

  constructor(private began: (rate: number, startedAt: number) => void, private ended: (utterance: Utterance) => void,
    private options:{onsetMs?:number;silenceMs?:number | (() => number); audio?:(pcm:Uint8Array)=>void}={}) {}
  get speaking() { return this.active; }

  reset() {
    this.frames = []; this.preRoll = []; this.preDuration = 0;
    this.rate = 0; this.speechMs = 0; this.quietMs = 0; this.durationMs = 0; this.active = false;
  }

  feed(frame: PCMFrame) {
    if (frame.channels !== 1 || !Number.isSafeInteger(frame.sampleRate) || frame.sampleRate < 8000 || frame.sampleRate > 96000 || !frame.data.byteLength || frame.data.byteLength % 2 || frame.data.byteLength > frame.sampleRate * 2) return;
    if (this.rate && frame.sampleRate !== this.rate) this.reset();
    this.rate = frame.sampleRate;
    const pcm = new Uint8Array(frame.data).slice();
    const samples = new DataView(pcm.buffer);
    let sum = 0;
    for (let offset=0;offset<pcm.length;offset+=2) { const value=samples.getInt16(offset,true)/32768; sum+=value*value; }
    const db = frame.voiceLevel??20*Math.log10(Math.max(1e-7,Math.sqrt(sum/(pcm.length/2))));
    const ms = pcm.length / 2 / frame.sampleRate * 1000;
    const voiced = db > Math.max(-48, Math.min(-26, this.noise+12));
    if (voiced) this.lastVoiceAt = frame.capturedAt === undefined ? performance.now() : frame.capturedAt * 1000;
    if (!this.active) {
      this.preRoll.push(pcm); this.preDuration += ms;
      while (this.preDuration > 500 && this.preRoll.length > 1) this.preDuration -= this.preRoll.shift()!.length / 2 / this.rate * 1000;
      if (!voiced) this.noise = 0.95*this.noise+0.05*db;
      this.speechMs = voiced ? this.speechMs+ms : 0;
      if (this.speechMs >= (this.options.onsetMs??180)) {
        this.active = true; this.frames = this.preRoll; this.preRoll = []; this.preDuration = 0; this.durationMs = this.speechMs; this.quietMs = 0;
        this.began(this.rate, Math.max(0, this.lastVoiceAt - this.speechMs));
        this.frames.forEach(buffer => this.options.audio?.(buffer));
      }
      return;
    }
    this.frames.push(pcm); this.durationMs += ms;
    this.options.audio?.(pcm);
    this.quietMs = voiced ? 0 : this.quietMs+ms;
    const silence = typeof this.options.silenceMs === 'function' ? this.options.silenceMs() : this.options.silenceMs;
    if (this.quietMs >= (silence??750) || this.durationMs >= Math.min(55_000,7*1024*1024/(2*this.rate)*1000)) {
      const audio = new Uint8Array(this.frames.reduce((size,buffer)=>size+buffer.length,0));
      let offset=0; this.frames.forEach(buffer=>{ audio.set(buffer,offset); offset+=buffer.length; });
      const rate=this.rate;
      this.reset();
      this.ended({pcm:audio,sampleRate:rate,lastVoiceAt:this.lastVoiceAt});
    }
  }
}

export function wavAudio(utterance: Utterance): Uint8Array {
  const audio = new Uint8Array(44+utterance.pcm.length);
  const view = new DataView(audio.buffer);
  const text = (offset:number,value:string) => { for(let index=0;index<value.length;index++) audio[offset+index]=value.charCodeAt(index); };
  text(0,'RIFF'); view.setUint32(4,audio.length-8,true); text(8,'WAVEfmt ');
  view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
  view.setUint32(24,utterance.sampleRate,true); view.setUint32(28,utterance.sampleRate*2,true);
  view.setUint16(32,2,true); view.setUint16(34,16,true); text(36,'data'); view.setUint32(40,utterance.pcm.length,true);
  audio.set(utterance.pcm,44); return audio;
}
