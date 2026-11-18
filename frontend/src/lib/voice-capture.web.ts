export type PCMFrame = { data: ArrayBuffer; sampleRate: number; channels: number };

// AudioWorklet captures PCM off the UI thread. No encoded files or blob URLs
// containing microphone audio are created; only the short worklet source URL.
const worklet = `class PadiCapture extends AudioWorkletProcessor {
  constructor() { super(); this.samples = []; }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) { for (const sample of channel) this.samples.push(sample); }
    if (this.samples.length >= sampleRate / 20) {
      const pcm = new Int16Array(this.samples.length);
      for (let i=0;i<pcm.length;i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(this.samples[i]*32767)));
      this.port.postMessage({data:pcm.buffer,sampleRate,channels:1},[pcm.buffer]); this.samples=[];
    }
    return true;
  }
} registerProcessor('padi-capture',PadiCapture);`;

export class VoiceCapture {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private starting: Promise<void> | null = null;
  private cleanup: Promise<void> | null = null;
  private url: string | null = null;

  constructor(private onFrame: (frame: PCMFrame) => void, private interrupted: () => void) {}

  start(signal: AbortSignal): Promise<void> {
    signal.addEventListener('abort', () => this.release(), { once: true });
    // Resume directly from the start-button gesture, before awaiting permission.
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === 'undefined') return Promise.reject(new Error('Hands-free voice requires a supported browser on localhost or HTTPS.'));
    this.context = new AudioContext();
    void this.context.resume();
    this.starting = this.prepare(signal);
    return this.starting;
  }

  private async prepare(signal: AbortSignal): Promise<void> {
    const context = this.context!;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (signal.aborted) { this.release(); return; }
      this.stream.getTracks().forEach(track => { track.onended = this.interrupted; });
      this.url = URL.createObjectURL(new Blob([worklet], { type: 'application/javascript' }));
      await context.audioWorklet.addModule(this.url);
      URL.revokeObjectURL(this.url); this.url = null;
      if (signal.aborted) { this.release(); return; }
      this.node = new AudioWorkletNode(context, 'padi-capture');
      this.node.port.onmessage = event => { if (!signal.aborted) this.onFrame(event.data); };
      context.createMediaStreamSource(this.stream!).connect(this.node);
      // The worklet writes silence to its output, allowing processing to run
      // without playing microphone sound back through the speakers.
      this.node.connect(context.destination);
    } catch { this.release(); throw new Error('The microphone could not start. Check browser microphone permission and try again.'); }
  }

  private release(): void {
    if (this.node) { this.node.port.onmessage = null; this.node.disconnect(); this.node = null; }
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); }); this.stream = null;
    void this.context?.close().catch(() => undefined); this.context = null;
    if (this.url) { URL.revokeObjectURL(this.url); this.url = null; }
  }

  stop(): Promise<void> {
    this.release();
    this.cleanup ??= (async () => { await this.starting?.catch(() => undefined); this.release(); })();
    return this.cleanup;
  }
}
