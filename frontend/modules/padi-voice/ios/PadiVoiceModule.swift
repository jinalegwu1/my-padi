import AVFoundation
import ExpoModulesCore

/** Full-duplex voiceChat capture, with Apple's voice processing enabled. */
public class PadiVoiceModule: Module {
  private var engine: AVAudioEngine?
  private var observer: NSObjectProtocol?
  private var oldCategory: AVAudioSession.Category?
  private var oldMode: AVAudioSession.Mode?
  private var oldOptions: AVAudioSession.CategoryOptions?
  private var generation = 0
  private let player = AVAudioPlayerNode()
  private var playback: Promise?
  private var playbackGeneration = 0
  private var queuedPlayback: [Int: Promise] = [:]
  private var queueFinisher: Promise?
  private var nextClip = 0
  private var hasTap = false

  public func definition() -> ModuleDefinition {
    Name("PadiVoice")
    Events("buffer", "interrupted")
    AsyncFunction("start") { () -> [String: Any] in try self.startCapture() }.runOnQueue(.main)
    Function("stop") { self.onMain { self.stopCapture() } }
    AsyncFunction("play") { (encoded: String, promise: Promise) in self.playAudio(encoded, promise) }.runOnQueue(.main)
    Function("stopPlayback") { self.onMain { self.stopPlayback() } }
    Function("beginQueuedPlayback") { self.onMain { self.stopPlayback() } }
    AsyncFunction("enqueueAudio") { (encoded: String, promise: Promise) in self.enqueueAudio(encoded, promise) }.runOnQueue(.main)
    AsyncFunction("finishQueuedPlayback") { (promise: Promise) in
      if self.queuedPlayback.isEmpty { self.player.stop(); promise.resolve(nil) }
      else { self.queueFinisher = promise }
    }.runOnQueue(.main)
    OnDestroy { self.onMain { self.stopCapture() } }
  }

  private func startCapture() throws -> [String: Any] {
    stopCapture()
    let session = AVAudioSession.sharedInstance()
    guard session.recordPermission == .granted else { throw VoiceCaptureError() }
    oldCategory = session.category; oldMode = session.mode; oldOptions = session.categoryOptions
    do {
      try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
      try session.setActive(true)
      let audio = AVAudioEngine()
      engine = audio
      try audio.inputNode.setVoiceProcessingEnabled(true)
      audio.attach(player)
      let playbackFormat = AVAudioFormat(standardFormatWithSampleRate: 24000, channels: 1)!
      audio.connect(player, to: audio.mainMixerNode, format: playbackFormat)
      let format = audio.inputNode.outputFormat(forBus: 0)
      guard let mono = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true),
        let converter = AVAudioConverter(from: format, to: mono) else { throw VoiceCaptureError() }
      generation += 1
      let started = generation
      audio.inputNode.installTap(onBus: 0, bufferSize: 2048, format: format) { [weak self] buffer, _ in
        guard let self, let output = AVAudioPCMBuffer(pcmFormat: mono, frameCapacity: AVAudioFrameCount(Double(buffer.frameLength) * 16000 / format.sampleRate) + 1) else { return }
        var consumed = false
        var error: NSError?
        converter.convert(to: output, error: &error) { _, status in
          if consumed { status.pointee = .noDataNow; return nil }
          consumed = true; status.pointee = .haveData; return buffer
        }
        guard error == nil, output.frameLength > 0, let samples = output.int16ChannelData else { return }
        let data = NativeArrayBuffer.copy(of: samples[0], count: Int(output.frameLength) * 2)
        DispatchQueue.main.async { [weak self] in
          guard let self, self.generation == started, self.engine != nil else { return }
          self.sendEvent("buffer", ["data": data, "sampleRate": 16000, "channels": 1])
        }
      }
      hasTap = true
      observer = NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: session, queue: .main) { [weak self] _ in
        self?.stopCapture(); self?.sendEvent("interrupted", ["reason": "audio-session"])
      }
      try audio.start()
      return ["echoCancellation": true, "sampleRate": 16000]
    } catch { stopCapture(); throw error }
  }

  private func onMain(_ action: () -> Void) {
    if Thread.isMainThread { action() } else { DispatchQueue.main.sync(execute: action) }
  }

  private func stopCapture() {
    stopPlayback()
    generation += 1
    if let observer { NotificationCenter.default.removeObserver(observer); self.observer = nil }
    if hasTap { engine?.inputNode.removeTap(onBus: 0); hasTap = false }
    engine?.stop()
    if let engine, player.engine != nil { engine.detach(player) }
    engine = nil
    if let oldCategory, let oldMode, let oldOptions {
      let session = AVAudioSession.sharedInstance()
      try? session.setCategory(oldCategory, mode: oldMode, options: oldOptions)
      try? session.setActive(false, options: .notifyOthersOnDeactivation)
    }
    oldCategory = nil; oldMode = nil; oldOptions = nil
  }

  private func stopPlayback() {
    playbackGeneration += 1
    player.stop()
    playback?.resolve(nil); playback = nil
    queuedPlayback.values.forEach { $0.resolve(nil) }; queuedPlayback.removeAll()
    queueFinisher?.resolve(nil); queueFinisher = nil
  }

  private func playAudio(_ encoded: String, _ promise: Promise) {
    stopPlayback()
    guard engine != nil, let bytes = Data(base64Encoded: encoded), bytes.count > 44,
      bytes.count <= 8 * 1024 * 1024, String(data: bytes.prefix(4), encoding: .ascii) == "RIFF",
      let format = AVAudioFormat(standardFormatWithSampleRate: 24000, channels: 1),
      let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount((bytes.count - 44) / 2)) else {
      promise.reject(VoiceCaptureError()); return
    }
    let frames = (bytes.count - 44) / 2
    buffer.frameLength = AVAudioFrameCount(frames)
    guard let output = buffer.floatChannelData else { promise.reject(VoiceCaptureError()); return }
    bytes.withUnsafeBytes { raw in
      let data = raw.bindMemory(to: UInt8.self)
      for index in 0..<frames {
        let sample = Int16(bitPattern: UInt16(data[44+index*2]) | UInt16(data[45+index*2]) << 8)
        output[0][index] = Float(sample) / 32768
      }
    }
    playback = promise
    let started = playbackGeneration
    player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
      DispatchQueue.main.async { [weak self] in
        guard let self, self.playbackGeneration == started else { return }
        self.playback?.resolve(nil); self.playback = nil
      }
    }
    player.play()
  }

  private func enqueueAudio(_ encoded: String, _ promise: Promise) {
    guard engine != nil, let bytes = Data(base64Encoded: encoded), bytes.count > 44,
      bytes.count <= 8 * 1024 * 1024, String(data: bytes.prefix(4), encoding: .ascii) == "RIFF",
      let format = AVAudioFormat(standardFormatWithSampleRate: 24000, channels: 1),
      let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount((bytes.count - 44) / 2)),
      let output = buffer.floatChannelData else { promise.reject(VoiceCaptureError()); return }
    let frames = (bytes.count - 44) / 2
    buffer.frameLength = AVAudioFrameCount(frames)
    bytes.withUnsafeBytes { raw in
      let data = raw.bindMemory(to: UInt8.self)
      for index in 0..<frames {
        let sample = Int16(bitPattern: UInt16(data[44+index*2]) | UInt16(data[45+index*2]) << 8)
        output[0][index] = Float(sample) / 32768
      }
    }
    nextClip += 1
    let clip = nextClip, started = playbackGeneration
    queuedPlayback[clip] = promise
    // AVAudioPlayerNode concatenates untimed scheduled buffers. Keep it running
    // between clips and stop only on cancellation or after the entire queue.
    player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
      DispatchQueue.main.async { [weak self] in
        guard let self, self.playbackGeneration == started else { return }
        self.queuedPlayback.removeValue(forKey: clip)?.resolve(nil)
        if self.queuedPlayback.isEmpty, let finish = self.queueFinisher {
          self.queueFinisher = nil; self.player.stop(); finish.resolve(nil)
        }
      }
    }
    if !player.isPlaying { player.play() }
  }
}

private final class VoiceCaptureError: Exception { override var reason: String { "Voice capture could not start. Check microphone permission and audio settings." } }
