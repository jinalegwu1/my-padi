import { AudioModule, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, type AudioRecorder } from 'expo-audio';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

/** Native recordings stay in the app cache only until transcription finishes. */
export class VoiceRecording {
  private recorder: AudioRecorder | null = null;
  private starting: Promise<void> | null = null;
  private stopping: Promise<void> | null = null;
  private cleanup: Promise<void> | null = null;
  private heardSound = false;
  private meteringAvailable = false;
  private monitor: ReturnType<typeof setInterval> | undefined;

  constructor(private onInterrupt: () => void) {}

  start(signal: AbortSignal): Promise<void> {
    this.starting = this.prepare(signal);
    return this.starting;
  }

  private async prepare(signal: AbortSignal): Promise<void> {
    const check = () => { if (signal.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' }); };
    const permission = await requestRecordingPermissionsAsync();
    check();
    if (!permission.granted) throw new Error('Microphone permission is off. Allow it in your device settings, or use text chat.');
    await setAudioModeAsync({ allowsRecording: true, allowsBackgroundRecording: false, shouldPlayInBackground: false, playsInSilentMode: true, interruptionMode: 'doNotMix' });
    check();
    const options = { ...RecordingPresets.HIGH_QUALITY, numberOfChannels: 1, bitRate: 64000, isMeteringEnabled: true };
    const platform = Platform.OS === 'ios' ? options.ios : options.android;
    this.recorder = new AudioModule.AudioRecorder({ ...options, ...platform });
    await this.recorder.prepareToRecordAsync(options);
    check();
    this.recorder.record();
    this.monitor = setInterval(() => {
      try {
        const status = this.recorder?.getStatus();
        this.measure(status?.metering);
        if (status && (!status.isRecording || status.mediaServicesDidReset)) this.onInterrupt();
      } catch { this.onInterrupt(); }
    }, 100);
  }

  private measure(level?: number): void {
    if (typeof level === 'number' && Number.isFinite(level)) {
      this.meteringAvailable = true;
      if (level > -55) this.heardSound = true;
    }
  }

  private async stop(): Promise<void> {
    clearInterval(this.monitor);
    if (!this.recorder) return;
    this.stopping ??= this.recorder.stop();
    await this.stopping;
  }

  async finish(): Promise<FormData> {
    this.measure(this.recorder?.getStatus().metering);
    await this.stop();
    if (this.meteringAvailable && !this.heardSound) throw new Error('I could not hear speech. Speak closer to the microphone and try again.');
    const uri = this.recorder?.uri;
    if (!uri) throw new Error('The microphone did not produce a recording. Please try again.');
    const file = new File(uri);
    if (!file.exists || file.size < 12) throw new Error('The recording was empty. Please try again.');
    if (file.size > 8 * 1024 * 1024) throw new Error('The recording is too large. Please record a shorter message.');
    const form = new FormData();
    // React Native uploads this cached file without copying it into JS memory.
    form.append('audio', { uri, name: 'recording.m4a', type: 'audio/mp4' } as unknown as Blob);
    return form;
  }

  cancel(): Promise<void> {
    this.cleanup ??= this.dispose();
    return this.cleanup;
  }

  private async dispose(): Promise<void> {
    await this.starting?.catch(() => undefined);
    try { await this.stop(); }
    finally {
      const uri = this.recorder?.uri;
      const recorder = this.recorder;
      this.recorder = null;
      try {
        recorder?.release();
        if (uri) { const file = new File(uri); if (file.exists) file.delete(); }
      } finally { await setAudioModeAsync({ allowsRecording: false, interruptionMode: 'mixWithOthers' }); }
    }
  }
}
