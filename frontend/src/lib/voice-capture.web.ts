export type PCMFrame = { data: ArrayBuffer; sampleRate: number; channels: number };

// AudioWorklet captures 16 kHz PCM off the UI thread for local voice detection
// and metering. The recording path compresses the microphone stream separately.
const worklet = `class PadiCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = [];
    this.input = [];
    this.inputOffset = 0;
    this.outputIndex = 0;
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

  append(sample) {
    this.samples.push(sample);
    if (this.samples.length === 800) {
      const data = new ArrayBuffer(1600);
      const pcm = new DataView(data);
      for (let index = 0; index < this.samples.length; index++) {
        pcm.setInt16(index * 2, Math.max(-32768, Math.min(32767, Math.round(this.samples[index] * 32767))), true);
      }
      this.port.postMessage({ data, sampleRate: 16000, channels: 1 }, [data]);
      this.samples = [];
    }
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel?.length) return true;
    if (sampleRate === 16000) {
      for (const sample of channel) this.append(sample);
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
      this.append(sample);
      this.outputIndex++;
    }
    const keepFrom = Math.max(0, Math.floor(this.outputIndex * sampleRate / 16000) - this.radius * 2);
    const remove = keepFrom - this.inputOffset;
    this.input.splice(0, remove);
    this.inputOffset += remove;
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
  private source: MediaStreamAudioSourceNode | null = null;
  private recordingDestination: MediaStreamAudioDestinationNode | null = null;
  private stopped = false;
  private detachAbort: (() => void) | null = null;

  constructor(private onFrame: (frame: PCMFrame) => void, private interrupted: () => void) {}

  start(signal: AbortSignal): Promise<void> {
    if (signal.aborted || this.stopped) return Promise.resolve();
    const abort = () => { this.stopped = true; this.release(); };
    signal.addEventListener('abort', abort, { once: true });
    this.detachAbort = () => signal.removeEventListener('abort', abort);
    // Resume directly from the start-button gesture, before awaiting permission.
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === 'undefined') return Promise.reject(new Error('Hands-free voice requires a supported browser on localhost or HTTPS.'));
    try { this.context = new AudioContext({ sampleRate: 16000 }); }
    catch { this.context = new AudioContext(); }
    void this.context.resume().catch(() => undefined);
    this.starting = this.prepare(signal);
    return this.starting;
  }

  private async prepare(signal: AbortSignal): Promise<void> {
    let context = this.context!;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (signal.aborted || this.stopped) { this.release(); return; }
      this.stream.getTracks().forEach(track => { track.onended = this.interrupted; });
      let source: MediaStreamAudioSourceNode;
      try { source = context.createMediaStreamSource(this.stream); }
      catch (error) {
        // Some engines accept a 16 kHz context but cannot attach their
        // microphone at that rate. Reuse the stream in the default engine.
        if (context.sampleRate !== 16000) throw error;
        await context.close().catch(() => undefined);
        if (signal.aborted || this.stopped) { this.release(); return; }
        context = this.context = new AudioContext();
        void context.resume().catch(() => undefined);
        source = context.createMediaStreamSource(this.stream!);
      }
      this.url = URL.createObjectURL(new Blob([worklet], { type: 'application/javascript' }));
      await context.audioWorklet.addModule(this.url);
      URL.revokeObjectURL(this.url); this.url = null;
      if (signal.aborted || this.stopped) { this.release(); return; }
      this.node = new AudioWorkletNode(context, 'padi-capture', { channelCount: 1, channelCountMode: 'explicit', outputChannelCount: [1] });
      this.node.port.onmessage = event => { if (!signal.aborted && !this.stopped) this.onFrame(event.data); };
      this.source = source;
      source.connect(this.node);
      // The worklet writes silence to its output, allowing processing to run
      // without playing microphone sound back through the speakers.
      this.node.connect(context.destination);
    } catch (error) {
      this.release();
      if (signal.aborted || this.stopped) return;
      if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
        throw new Error('Microphone permission was denied. Allow microphone access in your browser settings and try again.');
      }
      if (error instanceof DOMException && error.name === 'NotFoundError') throw new Error('No microphone is available. Connect a microphone and try again.');
      if (error instanceof DOMException && error.name === 'NotReadableError') throw new Error('The microphone is unavailable or in use by another application.');
      throw new Error('The microphone could not start. Check browser microphone permission and try again.');
    }
  }

  private release(): void {
    this.detachAbort?.(); this.detachAbort = null;
    this.recordingDestination?.stream.getTracks().forEach(track => track.stop());
    this.recordingDestination = null;
    this.source?.disconnect(); this.source = null;
    if (this.node) { this.node.port.onmessage = null; this.node.disconnect(); this.node = null; }
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); }); this.stream = null;
    void this.context?.close().catch(() => undefined); this.context = null;
    if (this.url) { URL.revokeObjectURL(this.url); this.url = null; }
  }

  stop(): Promise<void> {
    this.stopped = true;
    this.release();
    this.cleanup ??= (async () => { await this.starting?.catch(() => undefined); this.release(); })();
    return this.cleanup;
  }

  /** Reuse the microphone engine for compression without playing it aloud. */
  recordingStream(): MediaStream {
    if (!this.context || !this.source) throw new Error('The microphone is not ready.');
    if (!this.recordingDestination) {
      this.recordingDestination = this.context.createMediaStreamDestination();
      this.recordingDestination.channelCount = 1;
      this.recordingDestination.channelCountMode = 'explicit';
      this.source.connect(this.recordingDestination);
    }
    return this.recordingDestination.stream;
  }
}
