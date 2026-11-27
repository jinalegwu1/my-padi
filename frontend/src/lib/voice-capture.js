const { requireOptionalNativeModule } = require('expo');
const { requestRecordingPermissionsAsync } = require('expo-audio');
class VoiceCapture {
  module = requireOptionalNativeModule('PadiVoice');
  subscriptions = [];
  starting = null;
  cleanup = null;
  constructor(onFrame, interrupted) {
    this.onFrame = onFrame;
    this.interrupted = interrupted;
  }
  start(signal) {
    this.starting = this.prepare(signal);
    return this.starting;
  }
  async prepare(signal) {
    if (!this.module) throw new Error('Hands-free voice needs the PADI development build. Expo Go cannot load its microphone module.');
    const permission = await requestRecordingPermissionsAsync();
    if (signal.aborted) return;
    if (!permission.granted) throw new Error('Allow microphone access in device settings to talk with PADI.');
    this.subscriptions = [this.module.addListener('buffer', frame => {
      if (!signal.aborted) this.onFrame(frame);
    }), this.module.addListener('interrupted', () => {
      if (!signal.aborted) this.interrupted();
    })];
    try {
      await this.module.start();
    } catch {
      throw new Error('Hands-free audio could not start. Check microphone permission and audio settings, then try again.');
    }
    if (signal.aborted) this.module.stop();
  }
  stop() {
    this.cleanup ??= (async () => {
      await this.starting?.catch(() => undefined);
      this.module?.stop();
      this.subscriptions.forEach(subscription => subscription.remove());
      this.subscriptions = [];
    })();
    return this.cleanup;
  }
}

module.exports = { VoiceCapture };
