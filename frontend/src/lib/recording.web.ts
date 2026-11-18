/** Browser capture uses memory-only blobs and releases every microphone track. */
export class VoiceRecording {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private starting: Promise<void> | null = null;
  private finishing: Promise<Blob> | null = null;
  private chunks: Blob[] = [];
  private failed = false;
  private cleanup: Promise<void> | null = null;
  private audioContext: AudioContext | null = null;
  private monitor: ReturnType<typeof setInterval> | undefined;
  private heardSound = false;

  constructor(private onInterrupt: () => void) {}

  start(signal: AbortSignal): Promise<void> {
    // Release an acquired stream immediately, even during asynchronous setup.
    signal.addEventListener('abort', () => this.release(), { once: true });
    this.starting = this.prepare(signal);
    return this.starting;
  }

  private async prepare(signal: AbortSignal): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      throw new Error('This browser cannot record audio here. Use localhost or HTTPS in a supported browser, or use text chat.');
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      throw new Error('The microphone is unavailable or permission was denied. Check your browser permissions, or use text chat.');
    }
    if (signal.aborted) { this.release(); throw Object.assign(new Error('Cancelled'), { name: 'AbortError' }); }
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) { this.release(); throw new Error('This browser does not support a compatible recording format. Please use another browser or text chat.'); }
    try {
      this.audioContext = new AudioContext();
      // The analyser needs an active context, but no audio is played locally.
      // Do not block microphone cleanup on a browser autoplay restriction.
      void this.audioContext.resume().catch(() => undefined);
      if (signal.aborted) { this.release(); throw Object.assign(new Error('Cancelled'), { name: 'AbortError' }); }
      const analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 2048;
      this.audioContext.createMediaStreamSource(this.stream!).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      this.monitor = setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += sample * sample;
        if (Math.sqrt(sum / samples.length) > 0.002) this.heardSound = true;
      }, 100);
      this.recorder = new MediaRecorder(this.stream, { mimeType, audioBitsPerSecond: 64000 });
      this.recorder.addEventListener('dataavailable', event => { if (event.data.size) this.chunks.push(event.data); });
      this.recorder.addEventListener('error', () => { this.failed = true; this.onInterrupt(); });
      this.stream.getTracks().forEach(track => { track.onended = this.onInterrupt; });
      this.recorder.start();
    } catch (error) { this.release(); throw error; }
  }

  private release(): void {
    clearInterval(this.monitor);
    void this.audioContext?.close().catch(() => undefined);
    this.audioContext = null;
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    this.stream = null;
  }

  private stop(): Promise<Blob> {
    if (this.finishing) return this.finishing;
    const recorder = this.recorder;
    if (!recorder) return Promise.reject(new Error('No recording is available.'));
    this.finishing = new Promise((resolve, reject) => {
      const done = () => {
        this.release();
        if (this.failed) reject(new Error('The recording was interrupted. Please try again.'));
        else resolve(new Blob(this.chunks, { type: recorder.mimeType }));
      };
      if (recorder.state === 'inactive') { done(); return; }
      recorder.addEventListener('stop', done, { once: true });
      recorder.stop();
    });
    return this.finishing;
  }

  async finish(): Promise<FormData> {
    const blob = await this.stop();
    if (!this.heardSound) throw new Error('I could not hear speech. Speak closer to the microphone and try again.');
    if (blob.size < 12) throw new Error('The recording was empty. Please try again.');
    if (blob.size > 8 * 1024 * 1024) throw new Error('The recording is too large. Please record a shorter message.');
    const form = new FormData();
    form.append('audio', blob, blob.type.includes('mp4') ? 'recording.m4a' : 'recording.webm');
    return form;
  }

  cancel(): Promise<void> {
    this.cleanup ??= this.dispose();
    return this.cleanup;
  }

  private async dispose(): Promise<void> {
    await this.starting?.catch(() => undefined);
    try { if (this.recorder) await this.stop(); }
    finally { this.release(); this.recorder = null; this.chunks = []; this.finishing = null; }
  }
}
