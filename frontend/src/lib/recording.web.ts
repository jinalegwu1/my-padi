import { VoiceCapture } from './voice-capture.web';
import type { RecordingMetadata } from './transcription-session';

const MAX_BYTES = 8 * 1024 * 1024;
const BITRATE = 32000;

/** A complete compressed segment. No uncompressed browser fallback. */
export class VoiceRecording {
  private capture: VoiceCapture | null = null;
  private recorder: MediaRecorder | null = null;
  private starting: Promise<void> | null = null;
  private finishing: Promise<Blob> | null = null;
  private cleanup: Promise<void> | null = null;
  private chunks: Blob[] = [];
  private bytes = 0;
  private failed = false;
  private heardSound = false;
  private active = false;
  private began = 0;
  private duration = 0;
  private pcmBytes = 0;
  private compressionMs = 0;
  private file: Blob | null = null;
  private cancelled = false;
  private limitTimer: ReturnType<typeof setTimeout> | undefined;
  private detachAbort: (() => void) | null = null;
  constructor(private onInterrupt: () => void) {}
  get metadata(): RecordingMetadata {
    return { mime: this.file?.type ?? this.recorder?.mimeType ?? '', audioBytes: this.file?.size ?? this.bytes,
      pcmBytes: this.pcmBytes, durationMs: this.duration, compressionMs: this.compressionMs };
  }
  start(signal: AbortSignal): Promise<void> {
    const abort = () => { void this.cancel(); };
    signal.addEventListener('abort', abort, { once: true });
    this.detachAbort = () => signal.removeEventListener('abort', abort);
    this.starting = this.prepare(signal);
    return this.starting;
  }
  private async prepare(signal: AbortSignal) {
    if (signal.aborted || this.cancelled) return;
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') throw new Error('Compressed recording is unavailable in this browser.');
    const mime = ['audio/webm;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
    if (!mime) throw new Error('This browser cannot record supported compressed audio. Use WebM/Opus or M4A/AAC recording.');
    this.capture = new VoiceCapture(frame => {
      if (!this.active || signal.aborted || this.cancelled) return;
      this.pcmBytes += frame.data.byteLength;
      const values = new DataView(frame.data);
      let energy = 0;
      for (let offset = 0; offset < frame.data.byteLength; offset += 2) energy += (values.getInt16(offset, true) / 32768) ** 2;
      if (Math.sqrt(energy / (frame.data.byteLength / 2)) > 0.002) this.heardSound = true;
    }, () => { if (!signal.aborted) this.onInterrupt(); });
    try {
      await this.capture.start(signal);
      if (signal.aborted || this.cancelled) return;
      this.recorder = new MediaRecorder(this.capture.recordingStream(), { mimeType: mime, audioBitsPerSecond: BITRATE });
      if (!/^(audio\/webm|audio\/mp4)(;|$)/i.test(this.recorder.mimeType)) throw new Error('The browser returned an unsupported recording format.');
      this.recorder.addEventListener('dataavailable', event => {
        if (event.data.size && !signal.aborted && !this.cancelled && !this.failed) {
          this.bytes += event.data.size;
          if (this.bytes > MAX_BYTES) { this.failed = true; this.chunks = []; this.onInterrupt(); void this.cancel(); }
          else this.chunks.push(event.data);
        }
      });
      this.recorder.addEventListener('error', () => { this.failed = true; if (!signal.aborted) this.onInterrupt(); void this.cancel(); });
      this.recorder.addEventListener('stop', () => {
        if (this.active && !this.cancelled && !signal.aborted) {
          this.failed = true; this.onInterrupt(); void this.cancel();
        }
      });
      this.began = performance.now(); this.active = true;
      this.recorder.start(250);
      this.limitTimer = setTimeout(() => { this.failed = true; this.onInterrupt(); void this.cancel(); }, 60_000);
    } catch (error) { this.active = false; await this.capture.stop(); throw error; }
  }
  private stop(): Promise<Blob> {
    if (this.finishing) return this.finishing;
    const recorder = this.recorder;
    if (!recorder) return Promise.reject(new Error('No recording is available.'));
    clearTimeout(this.limitTimer);
    this.active = false; this.duration = performance.now() - this.began;
    this.finishing = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        recorder.removeEventListener('stop', finished);
        void this.capture?.stop();
        reject(new Error('The browser could not finish the recording. Please try again.'));
      }, 5000);
      const finished = () => {
        clearTimeout(timeout);
        void this.capture?.stop();
        if (this.failed) reject(new Error('The recording failed or exceeded its size limit. Please try again.'));
        else resolve(new Blob(this.chunks, { type: recorder.mimeType }));
      };
      if (recorder.state === 'inactive') { finished(); return; }
      recorder.addEventListener('stop', finished, { once: true });
      try { recorder.stop(); }
      catch { clearTimeout(timeout); recorder.removeEventListener('stop', finished); reject(new Error('The recording could not stop. Please try again.')); }
    });
    return this.finishing;
  }
  async finish(): Promise<FormData> {
    const check = () => { if (this.cancelled) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' }); };
    check();
    const started = performance.now(); const blob = await this.stop(); await this.capture?.stop();
    check();
    if (!this.heardSound) throw new Error('No clear speech was heard. Speak closer to the microphone and try again.');
    if (blob.size < 12) throw new Error('The recording was empty. Please try again.');
    if (blob.size > MAX_BYTES) throw new Error('The recording exceeds 8 MB. Please record a shorter message.');
    const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    check();
    const webm = header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3;
    const mp4 = String.fromCharCode(...header.subarray(4, 8)) === 'ftyp';
    if ((blob.type.includes('webm') && !webm) || (blob.type.includes('mp4') && !mp4)) throw new Error('The compressed recording is malformed. Please record again.');
    this.file = blob; this.compressionMs = performance.now() - started;
    const form = new FormData(); form.append('audio', blob, mp4 ? 'recording.m4a' : 'recording.webm'); return form;
  }
  cancel(): Promise<void> {
    this.cancelled = true;
    clearTimeout(this.limitTimer);
    this.detachAbort?.(); this.detachAbort = null;
    void this.capture?.stop();
    this.cleanup ??= (async () => {
      await this.starting?.catch(() => undefined);
      try { if (this.recorder) await this.stop(); } catch { /* a failed recording still releases resources */ }
      finally { await this.capture?.stop(); this.capture = null; this.recorder = null; this.chunks = []; this.file = null; this.finishing = null; }
    })();
    return this.cleanup;
  }
}
