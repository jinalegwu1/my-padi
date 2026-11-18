import { requireOptionalNativeModule } from 'expo';
import { requestRecordingPermissionsAsync } from 'expo-audio';

export type PCMFrame = { data: ArrayBuffer; sampleRate: number; channels: number };
type NativeVoice = {
  start(): Promise<{ echoCancellation: boolean; sampleRate: number }>;
  stop(): void;
  addListener(name: string, callback: (event: PCMFrame) => void): { remove(): void };
};

export class VoiceCapture {
  private module: NativeVoice | null = requireOptionalNativeModule('PadiVoice');
  private subscriptions: { remove(): void }[] = [];
  private starting: Promise<void> | null = null;
  private cleanup: Promise<void> | null = null;

  constructor(private onFrame: (frame: PCMFrame) => void, private interrupted: () => void) {}

  start(signal: AbortSignal): Promise<void> {
    this.starting = this.prepare(signal);
    return this.starting;
  }

  private async prepare(signal: AbortSignal): Promise<void> {
    if (!this.module) throw new Error('Hands-free voice needs the PADI development build. Expo Go cannot load its microphone module.');
    const permission = await requestRecordingPermissionsAsync();
    if (signal.aborted) return;
    if (!permission.granted) throw new Error('Allow microphone access in device settings to talk with PADI.');
    this.subscriptions = [this.module.addListener('buffer', frame => { if (!signal.aborted) this.onFrame(frame); }),
      this.module.addListener('interrupted', () => { if (!signal.aborted) this.interrupted(); })];
    try { await this.module.start(); }
    catch { throw new Error('Hands-free audio could not start. Check microphone permission and audio settings, then try again.'); }
    if (signal.aborted) this.module.stop();
  }

  stop(): Promise<void> {
    this.cleanup ??= (async () => {
      await this.starting?.catch(() => undefined);
      this.module?.stop();
      this.subscriptions.forEach(subscription => subscription.remove());
      this.subscriptions = [];
    })();
    return this.cleanup;
  }
}
