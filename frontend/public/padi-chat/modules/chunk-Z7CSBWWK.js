import{c as s}from"./chunk-HDRHO2C5.js";var c=`class PadiCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = [];
    this.input = [];
    this.inputOffset = 0;
    this.outputIndex = 0;
    this.inputStartFrame = null;
    this.firstSample = 0;
    this.kernels = new Map();
    // A Blackman-windowed sinc filter prevents high-frequency sound from
    // aliasing into speech when the engine ignores the requested 16 kHz rate.
    // Its history and phase cache stay bounded during a continuous session.
    this.radius = Math.ceil(32 * Math.max(1, sampleRate / 16000));
    this.cutoff = 0.45 * Math.min(1, 16000 / sampleRate);
  }

  kernel(phase) {
    if (this.kernels.has(phase)) return this.kernels.get(phase);
    const weights = new Float64Array(this.radius * 2 + 1);
    const fraction = phase / 256;
    let total = 0;
    for (let index = 0; index < weights.length; index++) {
      const distance = index - this.radius - fraction;
      if (Math.abs(distance) > this.radius) continue;
      const angle = 2 * Math.PI * this.cutoff * distance;
      const sinc = angle === 0 ? 1 : Math.sin(angle) / angle;
      const window = 0.42 + 0.5 * Math.cos(Math.PI * distance / this.radius)
        + 0.08 * Math.cos(2 * Math.PI * distance / this.radius);
      weights[index] = 2 * this.cutoff * sinc * window;
      total += weights[index];
    }
    for (let index = 0; index < weights.length; index++) weights[index] /= total;
    this.kernels.set(phase, weights);
    return weights;
  }

  append(sample, endTime) {
    this.samples.push(sample);
    if (this.samples.length === 800) {
      const data = new ArrayBuffer(1600);
      const pcm = new DataView(data);
      for (let index = 0; index < this.samples.length; index++) {
        pcm.setInt16(index * 2, Math.max(-32768, Math.min(32767, Math.round(this.samples[index] * 32767))), true);
      }
      this.port.postMessage({ data, sampleRate: 16000, channels: 1, endTime }, [data]);
      this.samples = [];
    }
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel?.length) return true;
    if (this.inputStartFrame === null) this.inputStartFrame = currentFrame;
    if (sampleRate === 16000) {
      for (let index = 0; index < channel.length; index++) this.append(channel[index], (currentFrame + index + 1) / sampleRate);
      return true;
    }
    if (this.inputOffset === 0 && this.input.length === 0) this.firstSample = channel[0];
    for (const sample of channel) this.input.push(sample);
    const received = this.inputOffset + this.input.length;
    // Use the total output count rather than accumulating a fractional step,
    // so 44.1 kHz input does not drift between worklet render blocks.
    // The causal filter uses past samples (about 2 ms of group delay at
    // 44.1/48 kHz), without waiting for a future render block.
    while (this.outputIndex * sampleRate < received * 16000) {
      const position = this.outputIndex * sampleRate;
      const newest = Math.floor(position / 16000);
      const phase = Math.round((position % 16000) / 16000 * 256);
      const weights = this.kernel(phase);
      let sample = 0;
      for (let index = 0; index < weights.length; index++) {
        const sourceIndex = newest - this.radius * 2 + index;
        sample += (sourceIndex < 0 ? this.firstSample : this.input[sourceIndex - this.inputOffset]) * weights[index];
      }
      this.append(sample, (this.inputStartFrame + newest + 1 - this.radius) / sampleRate);
      this.outputIndex++;
    }
    const keepFrom = Math.max(0, Math.floor(this.outputIndex * sampleRate / 16000) - this.radius * 2);
    const remove = keepFrom - this.inputOffset;
    this.input.splice(0, remove);
    this.inputOffset += remove;
    return true;
  }
} registerProcessor('padi-capture',PadiCapture);`,o=class{constructor(e,t){s(this,"stream",null);s(this,"context",null);s(this,"node",null);s(this,"url",null);s(this,"source",null);s(this,"recordingDestination",null);s(this,"stopped",!1);s(this,"detachAbort",null);this.onFrame=e,this.interrupted=t}start(e){if(e.aborted||this.stopped)return Promise.resolve();let t=()=>{this.stopped=!0,this.release()};return e.addEventListener("abort",t,{once:!0}),this.detachAbort=()=>e.removeEventListener("abort",t),!navigator.mediaDevices?.getUserMedia||typeof AudioWorkletNode>"u"?Promise.reject(new Error("Hands-free voice requires a supported browser on localhost or HTTPS.")):(this.context=new AudioContext({latencyHint:"interactive"}),this.context.resume().catch(()=>{}),this.prepare(e))}async prepare(e){let t=this.context;try{if(this.stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:!0,noiseSuppression:!0,autoGainControl:!0}}),e.aborted||this.stopped){this.release();return}this.stream.getTracks().forEach(i=>{i.onended=this.interrupted});let n;try{n=t.createMediaStreamSource(this.stream)}catch(i){if(t.sampleRate!==16e3)throw i;if(await t.close().catch(()=>{}),e.aborted||this.stopped){this.release();return}t=this.context=new AudioContext,t.resume().catch(()=>{}),n=t.createMediaStreamSource(this.stream)}if(this.url=URL.createObjectURL(new Blob([c],{type:"application/javascript"})),await t.audioWorklet.addModule(this.url),URL.revokeObjectURL(this.url),this.url=null,e.aborted||this.stopped){this.release();return}this.node=new AudioWorkletNode(t,"padi-capture",{channelCount:1,channelCountMode:"explicit",outputChannelCount:[1]}),this.node.port.onmessage=i=>{if(e.aborted||this.stopped)return;let{endTime:r,...a}=i.data,h=Number.isFinite(r)?Math.max(0,t.currentTime-r):0;this.onFrame({...a,capturedAt:performance.now()/1e3-h})},this.source=n,n.connect(this.node),this.node.connect(t.destination)}catch(n){if(this.release(),e.aborted||this.stopped)return;throw n instanceof DOMException&&(n.name==="NotAllowedError"||n.name==="SecurityError")?new Error("Microphone permission was denied. Allow microphone access in your browser settings and try again."):n instanceof DOMException&&n.name==="NotFoundError"?new Error("No microphone is available. Connect a microphone and try again."):n instanceof DOMException&&n.name==="NotReadableError"?new Error("The microphone is unavailable or in use by another application."):new Error("The microphone could not start. Check browser microphone permission and try again.")}}release(){this.detachAbort?.(),this.detachAbort=null,this.recordingDestination?.stream.getTracks().forEach(e=>e.stop()),this.recordingDestination=null,this.source?.disconnect(),this.source=null,this.node&&(this.node.port.onmessage=null,this.node.disconnect(),this.node=null),this.stream?.getTracks().forEach(e=>{e.onended=null,e.stop()}),this.stream=null,this.context?.close().catch(()=>{}),this.context=null,this.url&&(URL.revokeObjectURL(this.url),this.url=null)}async stop(){this.stopped=!0,this.release()}recordingStream(){if(!this.context||!this.source)throw new Error("The microphone is not ready.");return this.recordingDestination||(this.recordingDestination=this.context.createMediaStreamDestination(),this.recordingDestination.channelCount=1,this.recordingDestination.channelCountMode="explicit",this.source.connect(this.recordingDestination)),this.recordingDestination.stream}};export{o as a};
